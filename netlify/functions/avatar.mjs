import { getStore } from "@netlify/blobs";
import { requireUser } from "./_auth.mjs";

const MAX_BYTES = 500 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DATA_URL_PATTERN = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function markAvatarState(sub, hasAvatar) {
  const store = getStore({ name: "mdh-user-data", consistency: "strong" });
  const key = encodeURIComponent(sub);
  const current = (await store.get(key, { type: "json" })) || { settings: {}, collections: [], history: [], notifications: [], updatedAt: null };
  const next = {
    ...current,
    settings: { ...current.settings, hasAvatar, avatarUpdatedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
  await store.setJSON(key, next);
}

export default async function handler(request) {
  let user;
  try {
    user = await requireUser(request);
  } catch {
    return json(401, { error: "A valid Auth0 access token is required." });
  }

  const store = getStore({ name: "mdh-avatars", consistency: "strong" });
  const key = encodeURIComponent(user.sub);

  if (request.method === "GET") {
    const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!result) return json(404, { error: "No avatar uploaded." });
    return new Response(result.data, {
      status: 200,
      headers: {
        "Content-Type": result.metadata?.contentType || "application/octet-stream",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (request.method === "DELETE") {
    await store.delete(key);
    await markAvatarState(user.sub, false);
    return json(200, { ok: true });
  }

  if (request.method !== "POST") return json(405, { error: "Use GET, POST, or DELETE." });

  let input;
  try {
    input = await request.json();
  } catch {
    return json(400, { error: "The request body must be valid JSON." });
  }

  const match = DATA_URL_PATTERN.exec(String(input.dataUrl || ""));
  if (!match) return json(400, { error: "Expected a base64 image data URL." });

  const [, contentType, base64] = match;
  if (!ALLOWED_TYPES.has(contentType)) {
    return json(400, { error: "Only PNG, JPEG, or WEBP images are allowed." });
  }

  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return json(400, { error: "Could not decode the image data." });
  }
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return json(400, { error: `Image must be under ${Math.floor(MAX_BYTES / 1024)}KB.` });
  }

  await store.set(key, bytes, { metadata: { contentType } });
  await markAvatarState(user.sub, true);

  return json(200, { ok: true });
}

export const config = { path: "/api/avatar" };
