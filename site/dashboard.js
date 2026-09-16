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

  // The saved/recent request lives on this page, but "open" it means filling
  // in workspace.html's form on a different page — hand it off via
  // sessionStorage and navigate there. workspace.js picks this up on load.
  function openInWorkspace(request) {
    sessionStorage.setItem("mdh-workspace-handoff", JSON.stringify(request));
    window.location.href = "workspace.html";
  }

  function render(data) {
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
        openInWorkspace({ tool: "HTTP", method: item.method, endpoint: item.endpoint, headers: item.headers, body: item.body });
      });
      li.querySelector(".collection-delete").addEventListener("click", async () => {
        await window.MDHSync.deleteCollection(item.id);
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

  window.addEventListener("mdh:data", (event) => {
    syncState.textContent = event.detail.status;
    render(event.detail.data);
  });
})();
