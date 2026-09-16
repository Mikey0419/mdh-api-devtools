/**
 * MDH-API — request lab (HTTP / Webhook / WebSocket tools).
 *
 * Loaded only on workspace.html. Depends on app.js (Auth0 + nav) and
 * sync.js (window.MDHSync) already having run.
 */

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

function recordRequest() {
  window.MDHSync?.record({
    method: methodSelect.value,
    endpoint: endpointInput.value,
    tool: activeTool()
  });
}

const saveRequestButton = document.querySelector("#save-request");
saveRequestButton?.addEventListener("click", async () => {
  if (!endpointInput.value.trim()) return;
  const name = window.prompt("Name this request", endpointInput.value);
  if (!name) return;
  let headers = {};
  try { headers = parseHeaders(); } catch { /* Save it anyway; headers just won't prefill next time. */ }
  saveRequestButton.disabled = true;
  try {
    await window.MDHSync.saveCollection({
      name,
      method: methodSelect.value,
      endpoint: endpointInput.value,
      headers,
      body: bodyInput.value
    });
  } finally {
    saveRequestButton.disabled = false;
  }
});

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
        // A TypeError here is the browser refusing the request outright — almost
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
    recordRequest();
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
  responseTime.textContent = "— ms";
  responseOutput.textContent = "// Imported. Press send to run it.";
  copyButton.disabled = true;

  const labels = { curl: "curl command", fetch: "fetch() call", httpie: "HTTPie command", url: "URL", handoff: "request" };
  const summary = `Imported ${labels[parsed.format] || parsed.format}: ${parsed.method || methodSelect.value} ${parsed.url}`;
  announceImport(parsed.warnings.length ? `${summary} — ${parsed.warnings.join(" ")}` : summary, parsed.warnings.length ? "warn" : "ok");
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

/* ------------------------------------------------------- cross-page handoff */
// Dashboard's "load saved request" and Inbox's "replay in workspace" both
// hand off a request here (they can't just fill these fields directly —
// this is a different page). Sender writes mdh-workspace-handoff to
// sessionStorage and navigates to workspace.html; this applies it once.
// tools.html and index.html instead link straight into a specific tool
// (workspace.html?tool=Webhook), since data-select-tool only works within a
// page — the handoff takes priority if somehow both are present.
(function applyIncomingRequest() {
  const raw = sessionStorage.getItem("mdh-workspace-handoff");
  if (raw) {
    sessionStorage.removeItem("mdh-workspace-handoff");
    try {
      const handoff = JSON.parse(raw);
      selectTool(handoff.tool || "HTTP");
      applyImport({
        format: "handoff",
        method: handoff.method,
        // Falls back to whatever selectTool() just defaulted the field to —
        // a captured inbox payload has no destination endpoint of its own.
        url: handoff.endpoint || endpointInput.value,
        headers: handoff.headers || {},
        body: handoff.body ?? null,
        warnings: []
      });
    } catch {
      /* Malformed handoff payload — leave the form at its defaults. */
    }
    return;
  }

  const tool = new URLSearchParams(window.location.search).get("tool");
  if (!tool || !toolTabs.some((tab) => tab.dataset.tool === tool)) return;
  selectTool(tool);
  history.replaceState({}, document.title, window.location.pathname);
})();
