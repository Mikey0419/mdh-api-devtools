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
    if (activeTool() === "WebSocket") {
      const result = await runWebSocket(endpointInput.value);
      responseOutput.textContent = JSON.stringify(result.payload, null, 2);
      statusCode.textContent = "OPEN";
      responseTime.textContent = `${result.elapsed} ms`;
    } else {
      const method = methodSelect.value;
      const options = { method, headers: parseHeaders() };
      if (!["GET", "DELETE"].includes(method) && bodyInput.value.trim()) options.body = bodyInput.value;
      const response = await fetch(endpointInput.value, options);
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
    responseOutput.textContent = JSON.stringify({ error: error.message, hint: "The endpoint may block browser requests or require different headers." }, null, 2);
    copyButton.disabled = false;
  } finally {
    sendButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(responseOutput.textContent);
  const original = copyButton.textContent;
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = original; }, 1400);
});
