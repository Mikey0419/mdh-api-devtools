import { getStore } from "@netlify/blobs";
import { requireUser } from "./_auth.mjs";

const MAX_COLLECTIONS = 50;
const MAX_HISTORY = 100;
const MAX_NOTIFICATIONS = 50;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function freshData() {
  return { settings: {}, collections: [], history: [], notifications: [], updatedAt: null };
}

function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

export default async function handler(request) {
  let user;
  try {
    user = await requireUser(request);
  } catch {
    return json(401, { error: "A valid Auth0 access token is required." });
  }

  const store = getStore({ name: "mdh-user-data", consistency: "strong" });
  const key = encodeURIComponent(user.sub);
  const current = (await store.get(key, { type: "json" })) || freshData();

  if (request.method === "GET") return json(200, current);
  if (request.method !== "POST") return json(405, { error: "Use GET or POST." });

  let input;
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "The request body must be valid JSON." });
  }

  const now = new Date().toISOString();
  let next = { ...current };

  if (input.action === "saveCollection") {
    const item = {
      id: safeText(input.collection?.id, 80) || crypto.randomUUID(),
      name: safeText(input.collection?.name, 80) || "Untitled request",
      method: safeText(input.collection?.method, 10).toUpperCase() || "GET",
      endpoint: safeText(input.collection?.endpoint, 2000),
      headers: input.collection?.headers || {},
      body: safeText(input.collection?.body, 100_000),
      updatedAt: now,
    };
    next.collections = [item, ...current.collections.filter((entry) => entry.id !== item.id)].slice(0, MAX_COLLECTIONS);
  } else if (input.action === "deleteCollection") {
    next.collections = current.collections.filter((entry) => entry.id !== input.id);
  } else if (input.action === "recordHistory") {
    const item = {
      id: crypto.randomUUID(),
      method: safeText(input.request?.method, 10).toUpperCase(),
      endpoint: safeText(input.request?.endpoint, 2000),
      tool: safeText(input.request?.tool, 30),
      createdAt: now,
    };
    next.history = [item, ...current.history].slice(0, MAX_HISTORY);
  } else if (input.action === "clearHistory") {
    next.history = [];
  } else if (input.action === "saveSettings") {
    next.settings = {
      displayName: safeText(input.settings?.displayName, 50),
      theme: ["default", "cyan", "amber"].includes(input.settings?.theme) ? input.settings.theme : "default",
      saveHistory: Boolean(input.settings?.saveHistory),
    };
  } else if (input.action === "dismissNotification") {
    next.notifications = current.notifications.map((item) => item.id === input.id ? { ...item, read: true } : item);
  } else {
    return json(400, { error: "Unknown data action." });
  }

  next.updatedAt = now;
  await store.setJSON(key, next);
  return json(200, next);
}

export const config = { path: "/api/user-data" };
