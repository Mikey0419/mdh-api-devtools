(function () {
  "use strict";

  const root = document.querySelector("#dashboard");
  if (!root) return;

  const syncState = root.querySelector("#sync-state");
  const collectionCount = root.querySelector("#collection-count");
  const historyCount = root.querySelector("#history-count");
  const notificationCount = root.querySelector("#notification-count");
  const recentList = root.querySelector("#recent-history");
  const collectionList = root.querySelector("#collection-list");
  const notificationList = root.querySelector("#notification-list");
  const saveRequest = root.querySelector("#save-current-request");
  let token = null;
  let data = { settings: {}, collections: [], history: [], notifications: [] };

  async function api(action) {
    if (!token) throw new Error("Cross-device sync needs the Auth0 API to be enabled.");
    const response = await fetch("/api/user-data", {
      method: action ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      body: action ? JSON.stringify(action) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Sync failed.");
    return payload;
  }

  function empty(label) {
    const item = document.createElement("li");
    item.className = "dashboard-empty";
    item.textContent = label;
    return item;
  }

  function requestLabel(item) {
    try { return new URL(item.endpoint).host + new URL(item.endpoint).pathname; }
    catch { return item.endpoint || "No endpoint"; }
  }

  function render() {
    collectionCount.textContent = data.collections.length;
    historyCount.textContent = data.history.length;
    notificationCount.textContent = data.notifications.filter((item) => !item.read).length;

    recentList.textContent = "";
    if (!data.history.length) recentList.append(empty("No synced requests yet."));
    data.history.slice(0, 5).forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `<b>${item.method}</b><span></span><time></time>`;
      li.querySelector("span").textContent = requestLabel(item);
      li.querySelector("time").textContent = new Date(item.createdAt).toLocaleDateString();
      recentList.append(li);
    });

    collectionList.textContent = "";
    if (!data.collections.length) collectionList.append(empty("Save a request to start a collection."));
    data.collections.slice(0, 6).forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button" class="collection-load"><b></b><span></span></button><button type="button" class="collection-delete" aria-label="Delete saved request">×</button>`;
      li.querySelector("b").textContent = item.name;
      li.querySelector("span").textContent = `${item.method} · ${requestLabel(item)}`;
      li.querySelector(".collection-load").addEventListener("click", () => {
        document.querySelector("#method").value = item.method;
        document.querySelector("#endpoint").value = item.endpoint;
        document.querySelector("#headers").value = JSON.stringify(item.headers || {}, null, 2);
        document.querySelector("#body").value = item.body || "";
        document.querySelector("#workspace").scrollIntoView({ behavior: "smooth" });
      });
      li.querySelector(".collection-delete").addEventListener("click", async () => {
        data = await api({ action: "deleteCollection", id: item.id });
        render();
      });
      collectionList.append(li);
    });

    notificationList.textContent = "";
    if (!data.notifications.length) notificationList.append(empty("You’re all caught up."));
    data.notifications.slice(0, 5).forEach((item) => {
      const li = document.createElement("li");
      li.className = item.read ? "" : "unread";
      li.textContent = item.message;
      notificationList.append(li);
    });
  }

  saveRequest.addEventListener("click", async () => {
    const endpoint = document.querySelector("#endpoint").value;
    if (!endpoint) return;
    const name = window.prompt("Name this request", requestLabel({ endpoint }));
    if (!name) return;
    let headers = {};
    try { headers = JSON.parse(document.querySelector("#headers").value || "{}"); } catch {}
    try {
      data = await api({
        action: "saveCollection",
        collection: {
          name,
          method: document.querySelector("#method").value,
          endpoint,
          headers,
          body: document.querySelector("#body").value,
        },
      });
      syncState.textContent = "Synced";
      render();
    } catch (error) {
      syncState.textContent = error.message;
    }
  });

  window.addEventListener("mdh:authenticated", async (event) => {
    token = event.detail.token;
    if (!token) {
      syncState.textContent = "Auth0 API setup required";
      render();
      return;
    }
    try {
      data = await api();
      syncState.textContent = "Synced across devices";
      window.dispatchEvent(new CustomEvent("mdh:synced-settings", { detail: data.settings }));
      render();
      setInterval(async () => {
        if (document.hidden) return;
        try { data = await api(); render(); } catch {}
      }, 10000);
    } catch (error) {
      syncState.textContent = error.message;
      render();
    }
  });

  window.MDHDashboard = {
    async record(request) {
      if (!token || !data.settings.saveHistory) return;
      try {
        data = await api({ action: "recordHistory", request });
        render();
      } catch {}
    },
    async saveSettings(settings) {
      if (!token) return;
      try {
        data = await api({ action: "saveSettings", settings });
        render();
      } catch {}
    },
    async clearHistory() {
      if (!token) return;
      try {
        data = await api({ action: "clearHistory" });
        render();
      } catch {}
    },
  };
})();
