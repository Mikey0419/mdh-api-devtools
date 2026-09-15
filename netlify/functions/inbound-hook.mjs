/**
 * MDH-API — webhook receiver.
 *
 * Catches any request to /hooks/:id, records it, and replies with whatever
 * response that endpoint is configured to return. This is the half a static
 * page cannot do for itself: a real URL a third-party service can POST to.
 *
 * Requests to an unknown or expired id get a 404, so the inbox cannot be used
 * as an open write target for arbitrary ids.
 */

import {
  readEndpoint,
  writeEndpoint,
  eventsStore,
  isValidEndpointId,
  MAX_EVENTS_PER_ENDPOINT,
  MAX_STORED_BODY_BYTES,
  json,
} from "./_hooks-store.mjs";

// Headers that say more about Netlify's edge than about the sender.
const NOISE_HEADERS = new Set([
  "x-nf-request-id",
  "x-nf-account-id",
  "x-nf-site-id",
  "x-nf-client-connection-ip",
  "x-country",
  "x-language",
  "x-forwarded-proto",
  "x-bb-ip",
  "x-bb-client-request-uuid",
  "cdn-loop",
]);

export default async function handler(request, context) {
  const url = new URL(request.url);
  const id = url.pathname.replace(/^\/hooks\//, "").replace(/\/+$/, "");

  if (!isValidEndpointId(id)) {
    return json(404, { error: "Unknown webhook endpoint." });
  }

  const endpoint = await readEndpoint(id);
  if (!endpoint) {
    return json(404, {
      error: "This webhook endpoint does not exist or has expired.",
      detail: "Endpoints are kept for 24 hours. Create a new one from the MDH-API inbox.",
    });
  }

  // --- capture --------------------------------------------------------------

  const raw = await request.text();
  const truncated = raw.length > MAX_STORED_BODY_BYTES;
  const body = truncated ? raw.slice(0, MAX_STORED_BODY_BYTES) : raw;

  const headers = {};
  for (const [name, value] of request.headers) {
    if (!NOISE_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }

  let parsedBody = null;
  try {
    parsedBody = body ? JSON.parse(body) : null;
  } catch {
    // not JSON; the raw text is kept either way
  }

  const receivedAt = new Date().toISOString();
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const event = {
    id: eventId,
    endpointId: id,
    receivedAt,
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    json: parsedBody,
    truncated,
    bytes: raw.length,
    ip: request.headers.get("x-nf-client-connection-ip") || null,
    country: context?.geo?.country?.code || null,
  };

  const store = eventsStore();
  await store.setJSON(`${id}/${eventId}`, event);

  // Keep only the most recent events; drop the overflow so an endpoint cannot
  // grow without bound.
  const eventIds = [eventId, ...(endpoint.eventIds || [])];
  const keep = eventIds.slice(0, MAX_EVENTS_PER_ENDPOINT);
  const drop = eventIds.slice(MAX_EVENTS_PER_ENDPOINT);

  await writeEndpoint(id, { ...endpoint, eventIds: keep, lastEventAt: receivedAt });
  await Promise.all(drop.map((old) => store.delete(`${id}/${old}`).catch(() => {})));

  // --- reply ----------------------------------------------------------------

  const configured = endpoint.response || {};
  return new Response(configured.body ?? "", {
    status: configured.status || 200,
    headers: {
      "Content-Type": configured.contentType || "application/json",
      "Cache-Control": "no-store",
      "X-MDH-Event-Id": eventId,
    },
  });
}

export const config = {
  path: "/hooks/:id",
};
