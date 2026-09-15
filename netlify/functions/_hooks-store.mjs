/**
 * Shared storage for the webhook inbox.
 *
 * Netlify Functions are ephemeral, so captured requests live in Netlify Blobs
 * rather than in process memory. Two stores are used:
 *
 *   mdh-hooks         one document per endpoint: its config and event index
 *   mdh-hook-events   one document per captured request
 *
 * Endpoints expire on their own: nothing is served past ENDPOINT_TTL_MS, and
 * an endpoint that is read after expiry is treated as gone. This keeps the
 * inbox from becoming indefinite storage for other people's payloads.
 */

import { getStore } from "@netlify/blobs";

export const ENDPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_EVENTS_PER_ENDPOINT = 100;
export const MAX_STORED_BODY_BYTES = 64 * 1024;
export const MAX_RESPONSE_BODY_BYTES = 8 * 1024;

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no look-alikes

export function newEndpointId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function isValidEndpointId(id) {
  return typeof id === "string" && /^[a-z0-9]{6,24}$/.test(id);
}

export function hooksStore() {
  return getStore({ name: "mdh-hooks", consistency: "strong" });
}

export function eventsStore() {
  return getStore({ name: "mdh-hook-events", consistency: "strong" });
}

export function isExpired(endpoint) {
  return !endpoint || Date.now() - new Date(endpoint.createdAt).getTime() > ENDPOINT_TTL_MS;
}

export async function readEndpoint(id) {
  if (!isValidEndpointId(id)) return null;
  const endpoint = await hooksStore().get(id, { type: "json" });
  if (!endpoint || isExpired(endpoint)) return null;
  return endpoint;
}

export async function writeEndpoint(id, endpoint) {
  await hooksStore().setJSON(id, endpoint);
}

export function defaultEndpoint() {
  return {
    createdAt: new Date().toISOString(),
    eventIds: [],
    response: {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, received: true }),
    },
  };
}

export function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
