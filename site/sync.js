/**
 * MDH-API — cross-device data sync.
 *
 * Owns the one /api/user-data connection (settings, collections, history,
 * notifications) so every page can read and mutate the same cached copy
 * without re-fetching. Pages that render this data (dashboard.js) listen
 * for the "mdh:data" event instead of talking to the API directly.
 */
(function () {
  "use strict";

  let token = null;
  let data = { settings: {}, collections: [], history: [], notifications: [] };
  let status = "Connecting secure sync…";

  function emit() {
    window.dispatchEvent(new CustomEvent("mdh:data", { detail: { data, status } }));
  }

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

  window.addEventListener("mdh:authenticated", async (event) => {
    token = event.detail.token;
    if (!token) {
      status = "Auth0 API setup required";
      emit();
      return;
    }
    try {
      data = await api();
      status = "Synced across devices";
      window.dispatchEvent(new CustomEvent("mdh:synced-settings", { detail: data.settings }));
      emit();
      setInterval(async () => {
        if (document.hidden) return;
        try {
          data = await api();
          emit();
        } catch {
          /* Keep the last good copy; the next tick will retry. */
        }
      }, 10000);
    } catch (error) {
      status = error.message;
      emit();
    }
  });

  window.MDHSync = {
    getData: () => data,
    getStatus: () => status,
    hasToken: () => Boolean(token),
    async record(request) {
      if (!token || !data.settings.saveHistory) return;
      try {
        data = await api({ action: "recordHistory", request });
        emit();
      } catch {
        /* History is best-effort; a failed sync just skips this entry. */
      }
    },
    async saveSettings(settings) {
      data = await api({ action: "saveSettings", settings });
      status = "Synced across devices";
      emit();
      return data;
    },
    async clearHistory() {
      data = await api({ action: "clearHistory" });
      emit();
    },
    async saveCollection(collection) {
      data = await api({ action: "saveCollection", collection });
      emit();
      return data;
    },
    async deleteCollection(id) {
      data = await api({ action: "deleteCollection", id });
      emit();
    },
    async dismissNotification(id) {
      data = await api({ action: "dismissNotification", id });
      emit();
    },
  };
})();
