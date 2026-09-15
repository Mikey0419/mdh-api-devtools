(function () {
  "use strict";

  const connection = document.querySelector("#system-connection");
  if (!connection) return;

  const fields = {
    appUptime: document.querySelector("#system-app-uptime"),
    cpu: document.querySelector("#system-cpu"),
    memory: document.querySelector("#system-memory"),
    disk: document.querySelector("#system-disk"),
    hostUptime: document.querySelector("#system-host-uptime"),
    updated: document.querySelector("#system-updated"),
  };
  let socket = null;
  let retryTimer = null;
  let retryDelay = 1000;

  function duration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function bytes(value) {
    if (!Number.isFinite(value)) return "—";
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  function render(status) {
    fields.appUptime.textContent = duration(status.appUptimeSeconds);
    fields.cpu.textContent = `${status.cpu.load1} / ${status.cpu.cores} cores`;
    fields.memory.textContent = `${status.memory.usedPercent}% · ${bytes(status.memory.usedBytes)}`;
    fields.disk.textContent = status.disk ? `${status.disk.usedPercent}% · ${bytes(status.disk.usedBytes)}` : "Unavailable";
    fields.hostUptime.textContent = duration(status.systemUptimeSeconds);
    fields.updated.textContent = new Date(status.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setConnection(label, live) {
    connection.lastChild.textContent = ` ${label}`;
    connection.classList.toggle("live", live);
  }

  function connect() {
    clearTimeout(retryTimer);
    setConnection("Connecting…", false);
    socket = new WebSocket("wss://vps.mdh-api.com/ws/system");
    socket.addEventListener("open", () => { retryDelay = 1000; setConnection("Live", true); });
    socket.addEventListener("message", (event) => {
      try { render(JSON.parse(event.data)); } catch { /* Ignore malformed frames. */ }
    });
    socket.addEventListener("close", () => {
      setConnection("Reconnecting…", false);
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    });
    socket.addEventListener("error", () => socket.close());
  }

  window.addEventListener("mdh:authenticated", connect, { once: true });
  window.addEventListener("pagehide", () => {
    clearTimeout(retryTimer);
    if (socket) socket.close();
  });
})();
