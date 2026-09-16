const form = document.querySelector("#request-form");
const endpointInput = document.querySelector("#endpoint");
const methodSelect = document.querySelector("#method");
const headersInput = document.querySelector("#headers");
const bodyInput = document.querySelector("#body");
const responseOutput = document.querySelector("#response-output");
const statusCode = document.querySelector("#status-code");
const responseTime = document.querySelector("#response-time");
const copyButton = document.querySelector("#copy-response");
const sendButton = document.querySelector(".send-button");
const toolTabs = [...document.querySelectorAll(".tool-tabs button")];
const deliveryNote = document.querySelector("#delivery-note");
const requestFields = document.querySelector("#request-fields");
const websocketControls = document.querySelector("#websocket-controls");
const websocketMessage = document.querySelector("#websocket-message");
const websocketSend = document.querySelector("#websocket-send");
const websocketDisconnect = document.querySelector("#websocket-disconnect");
const websocketClear = document.querySelector("#websocket-clear");
const websocketState = document.querySelector("#websocket-state");
const websocketDot = document.querySelector("#websocket-dot");
const websocketEventCount = document.querySelector("#websocket-event-count");
let activeSocket = null;
let websocketLog = [];

const importPanel = document.querySelector("#import-panel");
const importInput = document.querySelector("#import-input");
const importButton = document.querySelector("#import-button");
const importStatus = document.querySelector("#import-status");

// Requests are proxied by netlify/functions/send-webhook.mjs so the destination
// is contacted server-side, out of reach of browser CORS. Webhook deliveries
// always go this way; HTTP requests fall back to it when the browser is blocked.
const PROXY_ENDPOINT = "/api/send-webhook";

document.querySelector("#year").textContent = new Date().getFullYear();

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector("nav");
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  nav.classList.toggle("open", !open);
});

nav.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
});

function selectTool(name) {
  if (activeSocket && name !== "WebSocket") disconnectWebSocket("Tool changed");
  toolTabs.forEach((tab) => {
    const active = tab.dataset.tool === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  const configurations = {
    HTTP: { method: "GET", endpoint: "https://jsonplaceholder.typicode.com/todos/1", button: "Send" },
    Webhook: { method: "POST", endpoint: "https://httpbin.org/post", button: "Deliver" },
    WebSocket: { method: "GET", endpoint: "wss://ws.postman-echo.com/raw", button: "Connect" }
  };
  const next = configurations[name];
  methodSelect.value = next.method;
  endpointInput.value = next.endpoint;
  sendButton.firstChild.textContent = `${next.button} `;
  bodyInput.value = name === "Webhook" ? '{\n  "event": "message.created",\n  "data": { "id": "evt_001" }\n}' : "";
  responseOutput.textContent = name === "WebSocket" ? "// Connection events will appear here." : "// Response body will appear here.";
  deliveryNote.hidden = name !== "Webhook";
  requestFields.hidden = name === "WebSocket";
  importPanel.hidden = name === "WebSocket";
  websocketControls.hidden = name !== "WebSocket";
  statusCode.textContent = "READY";
  responseTime.textContent = "— ms";
  copyButton.disabled = true;
}

toolTabs.forEach((tab) => tab.addEventListener("click", () => selectTool(tab.dataset.tool)));
document.querySelectorAll("[data-select-tool]").forEach((link) => link.addEventListener("click", () => selectTool(link.dataset.selectTool)));

function parseHeaders() {
  if (!headersInput.value.trim()) return {};
  return JSON.parse(headersInput.value);
}

function activeTool() {
  return document.querySelector(".tool-tabs button.active").dataset.tool;
}

async function sendViaProxy({ url, method, headers, body }) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method, headers, body })
    });
  } catch {
    throw new Error("The webhook service could not be reached. If you are running the site from a plain static server, start it with `netlify dev` so the function is available.");
  }

  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(
      response.status === 404
        ? "The webhook function is not deployed at " + PROXY_ENDPOINT + ". Run `netlify dev` locally, or redeploy the site with netlify/functions/send-webhook.mjs in place."
        : "The webhook service returned an unexpected response (" + response.status + ")."
    );
  }

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(result.error || "The webhook service responded with " + response.status + ".");
    error.detail = result.detail;
    throw error;
  }

  return result;
}

function renderProxyResult(result, prefixLines = []) {
  const rendered = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
  const lines = [...prefixLines];
  if (result.note) lines.push(`// ${result.note}`);
  if (result.truncated) lines.push("// Response truncated at 256 KB.");
  lines.push(rendered || "// Empty response body");

  responseOutput.textContent = lines.join("\n");
  statusCode.textContent = `${result.status} ${result.ok ? "OK" : "ERROR"}`;
  responseTime.textContent = `${result.durationMs} ms`;
}

function setWebSocketState(label, state) {
  websocketState.textContent = label;
  websocketDot.dataset.state = state;
  const connected = state === "open";
  websocketSend.disabled = !connected;
  websocketDisconnect.disabled = !activeSocket || activeSocket.readyState > WebSocket.OPEN;
}

function appendWebSocketEvent(direction, data, detail = {}) {
  websocketLog.push({
    time: new Date().toLocaleTimeString(),
    direction,
    data,
    ...detail
  });
  websocketLog = websocketLog.slice(-100);
  responseOutput.textContent = websocketLog.map((entry) => {
    const marker = { connected: "●", sent: "→", received: "←", closed: "○", error: "!" }[entry.direction] || "·";
    const meta = entry.code ? ` (${entry.code}${entry.reason ? `: ${entry.reason}` : ""})` : "";
    return `[${entry.time}] ${marker} ${entry.direction.toUpperCase()}${meta}\n${entry.data || ""}`;
  }).join("\n\n");
  websocketEventCount.textContent = `${websocketLog.length} event${websocketLog.length === 1 ? "" : "s"}`;
  responseOutput.scrollTop = responseOutput.scrollHeight;
  copyButton.disabled = false;
}

function disconnectWebSocket(reason = "User disconnected") {
  if (!activeSocket) return;
  if (activeSocket.readyState === WebSocket.CONNECTING || activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.close(1000, reason);
  }
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    activeSocket = socket;
    const started = performance.now();
    websocketLog = [];
    websocketEventCount.textContent = "0 events";
    setWebSocketState("Connecting…", "connecting");
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error("Connection timed out after 8 seconds."));
      }
    }, 8000);

    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const elapsed = Math.round(performance.now() - started);
      setWebSocketState("Connected", "open");
      appendWebSocketEvent("connected", url, { protocol: socket.protocol || undefined });
      resolve({ elapsed });
    });
    socket.addEventListener("message", async (event) => {
      let data = event.data;
      if (data instanceof Blob) data = await data.text();
      appendWebSocketEvent("received", String(data));
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      const isCurrentSocket = activeSocket === socket;
      if (isCurrentSocket) {
        activeSocket = null;
        setWebSocketState("Disconnected", "closed");
        statusCode.textContent = "CLOSED";
      }
      appendWebSocketEvent("closed", "Connection closed", { code: event.code, reason: event.reason });
      if (!settled) {
        settled = true;
        reject(new Error(`The WebSocket closed before connecting (code ${event.code}).`));
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      appendWebSocketEvent("error", "The WebSocket reported a connection error.");
      if (!settled) {
        settled = true;
        reject(new Error("The WebSocket connection could not be opened."));
      }
    });
  });
}

websocketSend.addEventListener("click", () => {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  const message = websocketMessage.value;
  activeSocket.send(message);
  appendWebSocketEvent("sent", message);
  websocketMessage.select();
});

websocketMessage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    websocketSend.click();
  }
});

websocketDisconnect.addEventListener("click", () => disconnectWebSocket());
websocketClear.addEventListener("click", () => {
  websocketLog = [];
  websocketEventCount.textContent = "0 events";
  responseOutput.textContent = "// Event log cleared. The connection remains active.";
  copyButton.disabled = true;
});
window.addEventListener("pagehide", () => disconnectWebSocket("Page closed"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  sendButton.disabled = true;
  statusCode.textContent = "WORKING";
  responseOutput.textContent = "// Waiting for a response…";
  const started = performance.now();

  try {
    const tool = activeTool();

    if (tool === "WebSocket") {
      disconnectWebSocket("Reconnecting");
      const result = await connectWebSocket(endpointInput.value);
      statusCode.textContent = "OPEN";
      responseTime.textContent = `${result.elapsed} ms`;
    } else if (tool === "Webhook") {
      renderProxyResult(await sendViaProxy({
        url: endpointInput.value,
        method: methodSelect.value,
        headers: parseHeaders(),
        body: bodyInput.value.trim()
      }));
    } else {
      const method = methodSelect.value;
      const options = { method, headers: parseHeaders() };
      if (!["GET", "DELETE"].includes(method) && bodyInput.value.trim()) options.body = bodyInput.value;

      let response;
      try {
        response = await fetch(endpointInput.value, options);
      } catch (directError) {
        // A TypeError here is the browser refusing the request outright \u2014 almost
        // always CORS. The endpoint may be perfectly healthy, so retry it
        // server-side rather than dead-ending on "Failed to fetch".
        if (!(directError instanceof TypeError)) throw directError;

        renderProxyResult(
          await sendViaProxy({
            url: endpointInput.value,
            method,
            headers: parseHeaders(),
            body: ["GET", "DELETE"].includes(method) ? "" : bodyInput.value.trim()
          }),
          ["// The browser blocked this request (CORS). Retried server-side."]
        );
        copyButton.disabled = false;
        sendButton.disabled = false;
        return;
      }
      const text = await response.text();
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* Keep plain text. */ }
      responseOutput.textContent = formatted || "// Empty response body";
      statusCode.textContent = `${response.status} ${response.ok ? "OK" : "ERROR"}`;
      responseTime.textContent = `${Math.round(performance.now() - started)} ms`;
    }
    copyButton.disabled = false;
  } catch (error) {
    statusCode.textContent = "FAILED";
    responseTime.textContent = `${Math.round(performance.now() - started)} ms`;
    const hint = activeTool() === "Webhook"
      ? "Webhooks are delivered server-side. Check that the destination is reachable over https and that the payload is valid JSON."
      : "The endpoint may block browser requests or require different headers.";
    responseOutput.textContent = JSON.stringify({ error: error.message, detail: error.detail, hint }, null, 2);
    copyButton.disabled = false;
  } finally {
    sendButton.disabled = false;
  }
});

/* ---------------------------------------------------------------- import */

function announceImport(message, tone = "ok") {
  importStatus.textContent = message;
  importStatus.dataset.tone = tone;
  if (tone === "ok") setTimeout(() => { if (importStatus.textContent === message) importStatus.textContent = ""; }, 6000);
}

function applyImport(parsed) {
  if (parsed.method) {
    if (![...methodSelect.options].some((option) => option.value === parsed.method)) {
      methodSelect.add(new Option(parsed.method, parsed.method));
    }
    methodSelect.value = parsed.method;
  }

  endpointInput.value = parsed.url;

  if (Object.keys(parsed.headers).length) {
    headersInput.value = JSON.stringify(parsed.headers, null, 2);
  }
  if (parsed.body !== null && parsed.body !== undefined) {
    bodyInput.value = parsed.body;
  }

  statusCode.textContent = "READY";
  responseTime.textContent = "\u2014 ms";
  responseOutput.textContent = "// Imported. Press send to run it.";
  copyButton.disabled = true;

  const labels = { curl: "curl command", fetch: "fetch() call", httpie: "HTTPie command", url: "URL" };
  const summary = `Imported ${labels[parsed.format] || parsed.format}: ${parsed.method || methodSelect.value} ${parsed.url}`;
  announceImport(parsed.warnings.length ? `${summary} \u2014 ${parsed.warnings.join(" ")}` : summary, parsed.warnings.length ? "warn" : "ok");
}

function runImport(text) {
  const parsed = window.MDHImport ? window.MDHImport.parseRequestSnippet(text) : null;
  if (!parsed) {
    announceImport("That did not look like a curl command, a fetch() call, an HTTPie command, or a URL.", "error");
    return false;
  }
  applyImport(parsed);
  return true;
}

importButton.addEventListener("click", () => {
  if (runImport(importInput.value)) importInput.value = "";
});

importInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    importButton.click();
  }
});

// Pasting a whole command into the endpoint field is the fastest path, so
// intercept it: anything richer than a bare URL fills the form instead.
endpointInput.addEventListener("paste", (event) => {
  const text = (event.clipboardData || window.clipboardData)?.getData("text") || "";
  if (!text.trim() || !window.MDHImport) return;

  const parsed = window.MDHImport.parseRequestSnippet(text);
  if (!parsed || parsed.format === "url") return;

  event.preventDefault();
  importPanel.open = true;
  applyImport(parsed);
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(responseOutput.textContent);
  const original = copyButton.textContent;
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = original; }, 1400);
});


/* ------------------------------------------------------------------ Auth0 */
const AUTH0_DOMAIN = "dev-k8fshtox4w7pm3ah.us.auth0.com";
const AUTH0_CLIENT_ID = "QwA1u0OF6OVAjQvUs8CxusnaOTtIekq9";
const authButton = document.querySelector("#auth-button");
const authLabel = document.querySelector("#auth-label");
const authGate = document.querySelector("#auth-gate");
const appShell = document.querySelector("#app-shell");
const authLoading = document.querySelector("#auth-loading");
const authLoginView = document.querySelector("#auth-login-view");
const authErrorView = document.querySelector("#auth-error-view");
const authError = document.querySelector("#auth-error");
const accountControl = document.querySelector(".account-control");
const accountName = document.querySelector("#account-name");
const accountEmail = document.querySelector("#account-email");
const profileDialog = document.querySelector("#profile-dialog");
let authClient;
let signedIn = false;
let currentUser;
let userSettings = { displayName: "", theme: "default", saveHistory: false };

function settingsKey() {
  return currentUser?.sub ? `mdh-api.settings.${currentUser.sub}` : null;
}

function historyKey() {
  return currentUser?.sub ? `mdh-api.history.${currentUser.sub}` : null;
}

function applySettings() {
  document.documentElement.dataset.theme = userSettings.theme || "default";
  const name = userSettings.displayName.trim() || currentUser?.name || currentUser?.nickname || currentUser?.email || "Account";
  authLabel.textContent = name;
  accountName.textContent = name;
}

function loadSettings() {
  const key = settingsKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    userSettings = { ...userSettings, ...saved };
  } catch {
    localStorage.removeItem(key);
  }
  applySettings();
}

function recordRequest() {
  if (!userSettings.saveHistory || !historyKey()) return;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch {}
  history.unshift({
    method: methodSelect.value,
    endpoint: endpointInput.value,
    tool: activeTool(),
    createdAt: new Date().toISOString()
  });
  localStorage.setItem(historyKey(), JSON.stringify(history.slice(0, 25)));
  window.MDHDashboard?.record({
    method: methodSelect.value,
    endpoint: endpointInput.value,
    tool: activeTool()
  });
}

function showLogin() {
  authLoading.hidden = true;
  authErrorView.hidden = true;
  authLoginView.hidden = false;
  authGate.hidden = false;
  appShell.hidden = true;
}

function showWorkspace() {
  authGate.hidden = true;
  appShell.hidden = false;
}

function showAuthError(message) {
  authLoading.hidden = true;
  authLoginView.hidden = true;
  authError.textContent = message;
  authErrorView.hidden = false;
  authGate.hidden = false;
  appShell.hidden = true;
}

async function initializeAuth() {
  try {
    authClient = await auth0.createAuth0Client({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      authorizationParams: {
        redirect_uri: window.location.origin,
        scope: "openid profile email offline_access",
        // Must match the audience getTokenSilently() requests below. Without
        // it here, the refresh token gets minted for "no audience" at login
        // and later asking it for the api.mdh-api.com audience is a mismatch
        // that auth0-spa-js's rotating-refresh-token flow fails on Safari
        // with login_required (auth0/auth0-spa-js#469) instead of silently
        // refreshing.
        audience: "https://api.mdh-api.com"
      },
      // getTokenSilently defaults to a hidden-iframe SSO check, which Safari's
      // Intelligent Tracking Prevention blocks (it treats Auth0's domain as a
      // third party and won't let the iframe read its session cookie). That
      // silently drops the access token chat and cross-device sync need on
      // iOS/Safari. Refresh tokens avoid the iframe entirely.
      useRefreshTokens: true,
      cacheLocation: "localstorage"
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) {
      const message = params.get("error_description") || params.get("error");
      history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      throw new Error(message);
    }

    if (params.has("code") && params.has("state")) {
      const { appState } = await authClient.handleRedirectCallback();
      history.replaceState({}, document.title, appState?.returnTo || window.location.pathname);
    }

    signedIn = await authClient.isAuthenticated();
    if (signedIn) {
      const user = await authClient.getUser();
      currentUser = user;
      authLabel.textContent = user?.name || user?.email || "Account";
      authButton.title = "Open account menu";
      authButton.classList.add("signed-in");
      accountName.textContent = user?.name || user?.nickname || "MDH-API user";
      accountEmail.textContent = user?.email || "No email available";
      loadSettings();
      showWorkspace();
      let accessToken = null;
      try {
        accessToken = await authClient.getTokenSilently({
          authorizationParams: { audience: "https://api.mdh-api.com" }
        });
      } catch (error) {
        console.warn("Cross-device sync is not configured yet:", error.message);
      }
      window.MDHAccessToken = accessToken;
      window.dispatchEvent(new CustomEvent("mdh:authenticated", {
        detail: { user, token: accessToken }
      }));
    } else {
      authLabel.textContent = "Sign in";
      authButton.title = "Sign in to MDH-API";
      showLogin();
    }
    authButton.disabled = false;
  } catch (error) {
    console.error("Auth0 initialization failed:", error);
    authLabel.textContent = "Sign in unavailable";
    authButton.title = error.message;
    showAuthError(error.message || "Authentication could not be initialized.");
  }
}

async function beginLogin(screenHint) {
  if (!authClient) return;
  await authClient.loginWithRedirect({
    authorizationParams: {
      prompt: "select_account",
      ...(screenHint ? { screen_hint: screenHint } : {})
    },
    appState: { returnTo: window.location.pathname + window.location.hash }
  });
}

authButton.addEventListener("click", () => {
  const open = accountControl.classList.toggle("open");
  authButton.setAttribute("aria-expanded", String(open));
});

document.querySelector("#auth-logout").addEventListener("click", async () => {
  if (!authClient) return;
  await authClient.logout({ logoutParams: { returnTo: window.location.origin } });
});

document.querySelector("#profile-settings").addEventListener("click", () => {
  if (!currentUser) return;
  document.querySelector("#profile-name").textContent = currentUser.name || currentUser.nickname || "Not provided";
  document.querySelector("#profile-email").textContent = currentUser.email || "Not provided";
  document.querySelector("#profile-email-status").textContent = currentUser.email_verified ? "Verified" : "Not verified";
  const avatarImage = document.querySelector("#profile-avatar-image");
  const avatarFallback = document.querySelector("#profile-avatar-fallback");
  avatarFallback.textContent = (userSettings.displayName || currentUser.name || currentUser.email || "U").trim().charAt(0).toUpperCase();
  avatarFallback.hidden = Boolean(currentUser.picture);
  avatarImage.hidden = !currentUser.picture;
  if (currentUser.picture) {
    avatarImage.src = currentUser.picture;
    avatarImage.alt = `${currentUser.name || "User"} profile image`;
  }
  document.querySelector("#display-name").value = userSettings.displayName;
  document.querySelector("#interface-theme").value = userSettings.theme;
  document.querySelector("#save-history").checked = userSettings.saveHistory;
  document.querySelector("#settings-status").textContent = "";
  accountControl.classList.remove("open");
  authButton.setAttribute("aria-expanded", "false");
  profileDialog.showModal();
});



document.querySelector("#profile-avatar-image").addEventListener("error", (event) => {
  event.currentTarget.hidden = true;
  document.querySelector("#profile-avatar-fallback").hidden = false;
});


function previewSettings() {
  const displayName = document.querySelector("#display-name").value.trim();
  const theme = document.querySelector("#interface-theme").value;
  document.documentElement.dataset.theme = theme;
  const previewName = displayName || currentUser?.name || currentUser?.nickname || currentUser?.email || "Account";
  authLabel.textContent = previewName;
  accountName.textContent = previewName;
  document.querySelector("#profile-avatar-fallback").textContent = previewName.charAt(0).toUpperCase();
  document.querySelector("#settings-status").textContent = "Previewing unsaved changes.";
}

document.querySelector("#display-name").addEventListener("input", previewSettings);
document.querySelector("#interface-theme").addEventListener("change", previewSettings);

document.querySelector("#profile-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  userSettings = {
    displayName: document.querySelector("#display-name").value.trim(),
    theme: document.querySelector("#interface-theme").value,
    saveHistory: document.querySelector("#save-history").checked
  };
  localStorage.setItem(settingsKey(), JSON.stringify(userSettings));
  applySettings();
  window.MDHDashboard?.saveSettings(userSettings);
  document.querySelector("#settings-status").textContent = "Settings saved.";
});

document.querySelector("#clear-history").addEventListener("click", () => {
  if (historyKey()) localStorage.removeItem(historyKey());
  window.MDHDashboard?.clearHistory();
  document.querySelector("#settings-status").textContent = "Request history cleared.";
});

window.addEventListener("mdh:synced-settings", (event) => {
  if (!event.detail || !Object.keys(event.detail).length) return;
  userSettings = { ...userSettings, ...event.detail };
  localStorage.setItem(settingsKey(), JSON.stringify(userSettings));
  applySettings();
});

form.addEventListener("submit", recordRequest);

document.querySelector("#profile-close").addEventListener("click", () => profileDialog.close());
profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});
document.addEventListener("click", (event) => {
  if (!accountControl.contains(event.target)) {
    accountControl.classList.remove("open");
    authButton.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileDialog.open) {
    accountControl.classList.remove("open");
    authButton.setAttribute("aria-expanded", "false");
    authButton.focus();
  }
});

document.querySelector("#auth-login").addEventListener("click", () => beginLogin());
document.querySelector("#auth-signup").addEventListener("click", () => beginLogin("signup"));
document.querySelector("#auth-retry").addEventListener("click", () => window.location.assign(window.location.pathname));

initializeAuth();
