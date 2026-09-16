/**
 * MDH-API — auth for the team chat room.
 *
 * Mints a short-lived Ably token for the single site-wide chat room, but only
 * for a caller who presents a valid Auth0 access token for this app's API
 * audience — the same token dashboard.js already gets from
 * `getTokenSilently({ audience: "https://api.mdh-api.com" })` and sends to
 * /api/user-data. Chat identity is the verified `sub` claim, never anything
 * the client sends, so it can't be spoofed independently of signing in.
 *
 * If your Auth0 tenant doesn't have that API audience enabled yet, this
 * fails the same way /api/user-data does ("Cross-device sync is not
 * configured yet" in app.js) — see chat.js for the matching client message.
 *
 * Environment variables:
 *   ABLY_API_KEY   Ably key as "appId.keyId:keySecret" (Ably dashboard -> API Keys)
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import jwt from "jsonwebtoken";

const AUTH0_DOMAIN = "dev-k8fshtox4w7pm3ah.us.auth0.com";
const AUTH0_AUDIENCE = "https://api.mdh-api.com";
const JWKS = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));

// One shared room for the whole team. Not user-chosen: this endpoint always
// grants exactly this room, nothing else.
const ROOM_NAME = "chat:workspace";
const ROOM_CAPABILITIES = ["publish", "subscribe", "presence", "history"];

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async function handler(request) {
  const authHeader = request.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer (.+)$/i);
  if (!bearerMatch) {
    return json(401, { error: "Sign in to MDH-API to use chat." });
  }

  let sub;
  try {
    const { payload } = await jwtVerify(bearerMatch[1], JWKS, {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });
    sub = payload.sub;
  } catch {
    return json(401, { error: "Your session has expired. Sign in again to use chat." });
  }
  if (!sub) {
    return json(401, { error: "Your session has expired. Sign in again to use chat." });
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey || !apiKey.includes(":")) {
    console.error("ABLY_API_KEY is missing or malformed.");
    return json(500, { error: "Chat is not configured on this deployment yet." });
  }
  const [keyName, keySecret] = apiKey.split(":");

  const token = jwt.sign(
    {
      "x-ably-capability": JSON.stringify({ [ROOM_NAME]: ROOM_CAPABILITIES }),
      "x-ably-clientId": sub,
    },
    keySecret,
    { algorithm: "HS256", keyid: keyName, expiresIn: "1h" }
  );

  return new Response(token, { headers: { "Content-Type": "text/plain" } });
}

export const config = {
  path: "/api/chat-token",
};
