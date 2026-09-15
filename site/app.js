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

nav.addEventListener("click", () => {
  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
});

function selectTool(name) {
  toolTabs.forEach((tab) => {
    const active = tab.dataset.tool === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  const configurations = {
    HTTP: { method: "GET", endpoint: "https://jsonplaceholder.typicode.com/todos/1", button: "Send" },
    Webhook: { method: "POST", endpoint: "https://httpbin.org/post", button: "Deliver" },
    WebSocket: { method: "GET", endpoint: "wss://echo.websocket.org", button: "Connect" }
  };
  const next = configurations[name];
  methodSelect.value = next.method;
  endpointInput.value = next.endpoint;
  sendButton.firstChild.textContent = `${next.button} `;
  bodyInput.value = name === "Webhook" ? '{\n  "event": "message.created",\n  "data": { "id": "evt_001" }\n}' : "";
  responseOutput.textContent = name === "WebSocket" ? "// Connection events will appear here." : "// Response body will appear here.";
  deliveryNote.hidden = name !== "Webhook";
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

function runWebSocket(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url);
    const started = performance.now();
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
      socket.close();
      resolve({ elapsed, payload: { event: "open", url, protocol: socket.protocol || null } });
    });
    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error("The WebSocket connection could not be opened."));
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  sendButton.disabled = true;
  statusCode.textContent = "WORKING";
  responseOutput.textContent = "// Waiting for a response…";
  const started = performance.now();

  try {
    const tool = activeTool();

    if (tool === "WebSocket") {
      const result = await runWebSocket(endpointInput.value);
      responseOutput.textContent = JSON.stringify(result.payload, null, 2);
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
let authClient;
let signedIn = false;

async function initializeAuth() {
  try {
    authClient = await auth0.createAuth0Client({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      authorizationParams: { redirect_uri: window.location.origin }
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
      authLabel.textContent = user?.name || user?.email || "Sign out";
      authButton.title = "Sign out of MDH-API";
      authButton.classList.add("signed-in");
    } else {
      authLabel.textContent = "Sign in";
      authButton.title = "Sign in to MDH-API";
    }
    authButton.disabled = false;
  } catch (error) {
    console.error("Auth0 initialization failed:", error);
    authLabel.textContent = "Sign in unavailable";
    authButton.title = error.message;
  }
}

authButton.addEventListener("click", async () => {
  if (!authClient) return;
  authButton.disabled = true;
  if (signedIn) {
    await authClient.logout({ logoutParams: { returnTo: window.location.origin } });
    return;
  }
  await authClient.loginWithRedirect({
    appState: { returnTo: window.location.pathname + window.location.hash }
  });
});

initializeAuth();
