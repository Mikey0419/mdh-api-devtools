/**
 * MDH-API — webhook inbox.
 *
 * Creates a public endpoint, polls it for captured requests, and renders them.
 * Talks to netlify/functions/hooks-api.mjs; the endpoint itself is served by
 * netlify/functions/inbound-hook.mjs.
 */
(function () {
  "use strict";

  const root = document.querySelector("#inbox");
  if (!root) return;

  const createButton = root.querySelector("#inbox-create");
  const forgetButton = root.querySelector("#inbox-forget");
  const clearButton = root.querySelector("#inbox-clear");
  const idle = root.querySelector("#inbox-idle");
  const live = root.querySelector("#inbox-live");
  const urlField = root.querySelector("#inbox-url");
  const copyButton = root.querySelector("#inbox-copy");
  const expiryLabel = root.querySelector("#inbox-expiry");
  const countLabel = root.querySelector("#inbox-count");
  const pulse = root.querySelector("#inbox-pulse");
  const list = root.querySelector("#inbox-events");
  const empty = root.querySelector("#inbox-empty");
  const errorLabel = root.querySelector("#inbox-error");
  const statusInput = root.querySelector("#inbox-status-code");
  const bodyInput = root.querySelector("#inbox-response-body");
  const saveResponse = root.querySelector("#inbox-save-response");
  const responseStatus = root.querySelector("#inbox-response-status");

  const STORAGE_KEY = "mdh-api.inbox.endpoint";
  const API_ORIGIN = "https://api.mdh-api.com";
  const POLL_INTERVAL_MS = 15000;
  let serviceOrigin = API_ORIGIN;

  let endpointId = null;
  let newestEventId = null;
  let seen = 0;
  let timer = null;
  let socket = null;
  const liveState = root.querySelector("#inbox-live-state");

  /* ------------------------------------------------------------- storage */

  function remember(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  }
  function recall() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }
  function forget() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------ helpers */

  function showError(message) {
    errorLabel.textContent = message || "";
    errorLabel.hidden = !message;
  }

  function relativeTime(iso) {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function prettyBody(event) {
    if (event.json !== null && event.json !== undefined) return JSON.stringify(event.json, null, 2);
    return event.body || "(empty body)";
  }

  async function api(path, options) {
    const nextOptions = { ...(options || {}) };
    nextOptions.headers = { ...(nextOptions.headers || {}) };
    if (window.MDHAccessToken) nextOptions.headers.Authorization = `Bearer ${window.MDHAccessToken}`;
    let response;
    try {
      response = await fetch(`${serviceOrigin}${path}`, nextOptions);
    } catch (error) {
      if (serviceOrigin !== API_ORIGIN) throw error;
    }
    if ((!response || response.status === 404) && serviceOrigin === API_ORIGIN) {
      serviceOrigin = location.origin;
      response = await fetch(`${serviceOrigin}${path}`, nextOptions);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        response.status === 404
          ? "The inbox functions are not deployed yet. Run `netlify dev` locally, or redeploy the site."
          : `The inbox service returned an unexpected response (${response.status}).`
      );
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  /* -------------------------------------------------------------- render */

  function renderEvent(event) {
    const item = document.createElement("details");
    item.className = "inbox-event";
    item.dataset.eventId = event.id;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="inbox-method" data-method="${event.method}">${event.method}</span>
      <span class="inbox-when">${relativeTime(event.receivedAt)}</span>
      <span class="inbox-size">${formatBytes(event.bytes)}</span>
      <span class="inbox-from">${event.ip ? event.ip : "unknown source"}</span>
    `;
    item.append(summary);

    const detail = document.createElement("div");
    detail.className = "inbox-detail";

    const queryKeys = Object.keys(event.query || {});
    detail.innerHTML = `
      <h4>Headers</h4>
      <pre><code>${escapeHtml(JSON.stringify(event.headers, null, 2))}</code></pre>
      ${queryKeys.length ? `<h4>Query</h4><pre><code>${escapeHtml(JSON.stringify(event.query, null, 2))}</code></pre>` : ""}
      <h4>Body${event.truncated ? " (truncated at 64 KB)" : ""}</h4>
      <pre><code>${escapeHtml(prettyBody(event))}</code></pre>
    `;

    const actions = document.createElement("div");
    actions.className = "inbox-event-actions";

    const replay = document.createElement("button");
    replay.type = "button";
    replay.textContent = "Load into sender";
    replay.addEventListener("click", () => loadIntoSender(event));

    const copyEvent = document.createElement("button");
    copyEvent.type = "button";
    copyEvent.className = "ghost";
    copyEvent.textContent = "Copy JSON";
    copyEvent.addEventListener("click", async () => {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      copyEvent.textContent = "Copied";
      setTimeout(() => { copyEvent.textContent = "Copy JSON"; }, 1400);
    });

    actions.append(replay, copyEvent);
    detail.append(actions);
    item.append(detail);
    return item;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }

  // Captured requests come from whoever called the endpoint, so they are data.
  // Nothing here is inserted as markup without escaping, and the sender form is
  // populated through value assignment only.
  function loadIntoSender(event) {
    const endpoint = document.querySelector("#endpoint");
    const method = document.querySelector("#method");
    const headers = document.querySelector("#headers");
    const body = document.querySelector("#body");
    if (!endpoint || !method || !headers || !body) return;

    const webhookTab = document.querySelector('.tool-tabs button[data-tool="Webhook"]');
    if (webhookTab) webhookTab.click();

    if (![...method.options].some((option) => option.value === event.method)) {
      method.add(new Option(event.method, event.method));
    }
    method.value = event.method;

    const forwarded = { ...event.headers };
    delete forwarded.host;
    delete forwarded.Host;
    delete forwarded["content-length"];
    delete forwarded["Content-Length"];
    headers.value = JSON.stringify(forwarded, null, 2);
    body.value = prettyBody(event);

    document.querySelector("#workspace")?.scrollIntoView({ behavior: "smooth" });
  }

  function renderEvents(events) {
    if (!events.length) return;
    const fragment = document.createDocumentFragment();
    const fresh = events.filter((event) => !list.querySelector(`[data-event-id="${CSS.escape(event.id)}"]`));
    fresh.forEach((event) => fragment.append(renderEvent(event)));
    if (!fresh.length) return;
    list.prepend(fragment);
    empty.hidden = true;

    pulse.classList.remove("flash");
    void pulse.offsetWidth;
    pulse.classList.add("flash");
  }

  /* ---------------------------------------------------------------- poll */

  async function poll() {
    if (!endpointId || document.hidden) return;
    try {
      const query = newestEventId ? `?since=${encodeURIComponent(newestEventId)}` : "";
      const payload = await api(`/api/hooks/${endpointId}/events${query}`);

      if (payload.events.length) {
        newestEventId = payload.events[0].id;
        renderEvents(payload.events);
      }

      seen = payload.total;
      countLabel.textContent = seen === 1 ? "1 request" : `${seen} requests`;
      expiryLabel.textContent = payload.expiresAt ? `expires ${new Date(payload.expiresAt).toLocaleString()}` : "active until server restart";
      showError("");
    } catch (error) {
      if (/expired|does not exist/i.test(error.message)) {
        stop();
        forget();
        live.hidden = true;
        idle.hidden = false;
      }
      showError(error.message);
    }
  }

  function start() {
    stop();
    timer = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    connectLiveStream();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (socket) socket.close(1000, "Inbox paused");
    socket = null;
  }

  function connectLiveStream() {
    if (!endpointId || document.hidden) return;
    if (serviceOrigin !== API_ORIGIN) {
      liveState.textContent = "Polling fallback";
      return;
    }
    const wsOrigin = serviceOrigin.replace(/^http/, "ws");
    liveState.textContent = "Connecting live stream…";
    socket = new WebSocket(`${wsOrigin}/ws/hooks/${endpointId}`);
    socket.addEventListener("open", () => { liveState.textContent = "Live"; showError(""); });
    socket.addEventListener("message", (message) => {
      let payload;
      try { payload = JSON.parse(message.data); } catch { return; }
      if (payload.type !== "webhook.received" || !payload.event) return;
      newestEventId = payload.event.id;
      seen = Number(payload.total || seen + 1);
      countLabel.textContent = seen === 1 ? "1 request" : `${seen} requests`;
      renderEvents([payload.event]);
    });
    socket.addEventListener("close", () => {
      if (endpointId && !document.hidden) liveState.textContent = "Polling fallback";
    });
    socket.addEventListener("error", () => { liveState.textContent = "Polling fallback"; });
  }

  document.addEventListener("visibilitychange", () => {
    if (!endpointId) return;
    if (document.hidden) stop();
    else start();
  });

  /* -------------------------------------------------------------- attach */

  async function attach(id, meta) {
    endpointId = id;
    remember(id);
    urlField.value = meta?.url || `${serviceOrigin}/hooks/${id}`;
    idle.hidden = true;
    live.hidden = false;
    list.textContent = "";
    empty.hidden = false;
    newestEventId = null;

    if (meta?.response) {
      statusInput.value = meta.response.status;
      bodyInput.value = meta.response.body;
    }
    start();
  }

  createButton.addEventListener("click", async () => {
    createButton.disabled = true;
    showError("");
    try {
      const created = await api("/api/hooks", { method: "POST" });
      await attach(created.id, created);
    } catch (error) {
      showError(error.message);
    } finally {
      createButton.disabled = false;
    }
  });

  forgetButton.addEventListener("click", () => {
    stop();
    forget();
    endpointId = null;
    live.hidden = true;
    idle.hidden = false;
    showError("");
  });

  clearButton.addEventListener("click", async () => {
    if (!endpointId) return;
    clearButton.disabled = true;
    try {
      await api(`/api/hooks/${endpointId}/events`, { method: "DELETE" });
      list.textContent = "";
      empty.hidden = false;
      newestEventId = null;
      seen = 0;
      countLabel.textContent = "0 requests";
    } catch (error) {
      showError(error.message);
    } finally {
      clearButton.disabled = false;
    }
  });

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(urlField.value);
    copyButton.textContent = "Copied";
    setTimeout(() => { copyButton.textContent = "Copy"; }, 1400);
  });

  saveResponse.addEventListener("click", async () => {
    if (!endpointId) return;
    saveResponse.disabled = true;
    responseStatus.textContent = "";
    try {
      await api(`/api/hooks/${endpointId}/response`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: Number(statusInput.value), body: bodyInput.value }),
      });
      responseStatus.textContent = "Saved.";
      setTimeout(() => { responseStatus.textContent = ""; }, 3000);
    } catch (error) {
      responseStatus.textContent = error.message;
    } finally {
      saveResponse.disabled = false;
    }
  });

  // Resume the endpoint from a previous visit, if it is still alive.
  const remembered = recall();
  if (remembered) {
    api(`/api/hooks/${remembered}`)
      .then((meta) => attach(remembered, meta))
      .catch(() => forget());
  }
})();
