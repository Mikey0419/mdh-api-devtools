/**
 * MDH-API — webhook inbox control plane.
 *
 *   POST   /api/hooks                  create an endpoint
 *   GET    /api/hooks/:id              endpoint metadata and current config
 *   GET    /api/hooks/:id/events       captured requests, newest first
 *                                      ?since=<eventId> returns only newer ones
 *   DELETE /api/hooks/:id/events       clear the inbox
 *   PUT    /api/hooks/:id/response     set the reply the endpoint sends back
 *
 * The page polls the events route. Server-Sent Events would be nicer, but a
 * Netlify Function cannot hold a connection open long enough to be worth it.
 */

import {
  readEndpoint,
  writeEndpoint,
  hooksStore,
  eventsStore,
  newEndpointId,
  defaultEndpoint,
  isValidEndpointId,
  ENDPOINT_TTL_MS,
  MAX_RESPONSE_BODY_BYTES,
  json,
} from "./_hooks-store.mjs";
import { requireUser } from "./_auth.mjs";

const CREATE_RATE_LIMIT = { windowMs: 60_000, max: 10 };
const createBuckets = new Map();

function rateLimited(key) {
  const now = Date.now();
  const bucket = createBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    createBuckets.set(key, { count: 1, resetAt: now + CREATE_RATE_LIMIT.windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > CREATE_RATE_LIMIT.max;
}

function endpointUrl(request, id) {
  return new URL(`/hooks/${id}`, request.url).toString();
}

async function loadEvents(id, since) {
  const endpoint = await readEndpoint(id);
  if (!endpoint) return null;

  let ids = endpoint.eventIds || [];
  if (since) {
    const index = ids.indexOf(since);
    ids = index === -1 ? ids : ids.slice(0, index);
  }

  const store = eventsStore();
  const events = await Promise.all(
    ids.map((eventId) => store.get(`${id}/${eventId}`, { type: "json" }).catch(() => null))
  );

  return { endpoint, events: events.filter(Boolean) };
}

export default async function handler(request) {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/hooks\/?/, "").split("/").filter(Boolean);
  const [id, resource] = segments;
  const user = await requireUser(request).catch(() => null);

  // --- create ---------------------------------------------------------------

  if (!id) {
    if (request.method !== "POST") {
      return json(405, { error: "Use POST /api/hooks to create an endpoint." });
    }

    const clientKey = request.headers.get("x-nf-client-connection-ip") || "unknown";
    if (rateLimited(clientKey)) {
      return json(429, { error: `At most ${CREATE_RATE_LIMIT.max} endpoints per minute.` });
    }

    const newId = newEndpointId();
    const endpoint = { ...defaultEndpoint(), ownerSub: user?.sub || null };
    await writeEndpoint(newId, endpoint);

    return json(201, {
      id: newId,
      url: endpointUrl(request, newId),
      createdAt: endpoint.createdAt,
      expiresAt: new Date(Date.now() + ENDPOINT_TTL_MS).toISOString(),
      response: endpoint.response,
    });
  }

  if (!isValidEndpointId(id)) {
    return json(400, { error: "That endpoint id is not valid." });
  }

  // --- events ---------------------------------------------------------------

  if (resource === "events") {
    if (request.method === "GET") {
      const result = await loadEvents(id, url.searchParams.get("since"));
      if (!result) return json(404, { error: "This endpoint does not exist or has expired." });

      return json(200, {
        id,
        url: endpointUrl(request, id),
        expiresAt: new Date(new Date(result.endpoint.createdAt).getTime() + ENDPOINT_TTL_MS).toISOString(),
        total: (result.endpoint.eventIds || []).length,
        events: result.events,
      });
    }

    if (request.method === "DELETE") {
      const endpoint = await readEndpoint(id);
      if (!endpoint) return json(404, { error: "This endpoint does not exist or has expired." });

      const store = eventsStore();
      await Promise.all(
        (endpoint.eventIds || []).map((eventId) => store.delete(`${id}/${eventId}`).catch(() => {}))
      );
      await writeEndpoint(id, { ...endpoint, eventIds: [] });

      return json(200, { id, cleared: true });
    }

    return json(405, { error: "Use GET or DELETE on this route." });
  }

  // --- configured response --------------------------------------------------

  if (resource === "response") {
    if (request.method !== "PUT") return json(405, { error: "Use PUT on this route." });

    const endpoint = await readEndpoint(id);
    if (!endpoint) return json(404, { error: "This endpoint does not exist or has expired." });

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "The request body must be valid JSON." });
    }

    const status = Number(payload?.status ?? 200);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return json(400, { error: "status must be an integer between 100 and 599." });
    }

    const body = typeof payload?.body === "string" ? payload.body : JSON.stringify(payload?.body ?? "");
    if (body.length > MAX_RESPONSE_BODY_BYTES) {
      return json(413, { error: `The configured response body must be under ${MAX_RESPONSE_BODY_BYTES / 1024} KB.` });
    }

    const response = {
      status,
      contentType: String(payload?.contentType || "application/json").slice(0, 120),
      body,
    };

    await writeEndpoint(id, { ...endpoint, response });
    return json(200, { id, response });
  }

  // --- metadata -------------------------------------------------------------

  if (!resource) {
    if (request.method === "DELETE") {
      const endpoint = await readEndpoint(id);
      if (endpoint) {
        const store = eventsStore();
        await Promise.all(
          (endpoint.eventIds || []).map((eventId) => store.delete(`${id}/${eventId}`).catch(() => {}))
        );
        await hooksStore().delete(id).catch(() => {});
      }
      return json(200, { id, deleted: true });
    }

    if (request.method !== "GET") return json(405, { error: "Use GET or DELETE on this route." });

    const endpoint = await readEndpoint(id);
    if (!endpoint) return json(404, { error: "This endpoint does not exist or has expired." });

    return json(200, {
      id,
      url: endpointUrl(request, id),
      createdAt: endpoint.createdAt,
      expiresAt: new Date(new Date(endpoint.createdAt).getTime() + ENDPOINT_TTL_MS).toISOString(),
      total: (endpoint.eventIds || []).length,
      lastEventAt: endpoint.lastEventAt || null,
      response: endpoint.response,
    });
  }

  return json(404, { error: "Unknown route." });
}

export const config = {
  path: ["/api/hooks", "/api/hooks/:id", "/api/hooks/:id/:resource"],
};
