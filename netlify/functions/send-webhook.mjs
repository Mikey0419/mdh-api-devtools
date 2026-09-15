/**
 * MDH-API — server-side webhook sender.
 *
 * The browser cannot deliver a webhook to an arbitrary third-party endpoint:
 * cross-origin requests are subject to CORS, and webhook receivers almost
 * never send back Access-Control-Allow-Origin. This function performs the
 * delivery server-side and returns the upstream response to the page.
 *
 * An open HTTP proxy is a liability, so the request is constrained:
 *   - HTTPS targets only, no credentials in the URL
 *   - every resolved IP must be publicly routable (blocks SSRF into
 *     loopback, RFC1918, link-local, CGNAT, and cloud metadata addresses)
 *   - redirects are not followed (a 3xx is reported, not chased)
 *   - request and response bodies are capped, as is the header set
 *   - a 10s timeout and a per-IP rate limit
 *   - optional host allowlist and shared-secret token via env vars
 *
 * Environment variables (all optional):
 *   WEBHOOK_ALLOWED_HOSTS  comma-separated hostnames; when set, only these
 *                          may be targeted (exact match, or ".example.com"
 *                          to allow a domain and its subdomains)
 *   WEBHOOK_PROXY_TOKEN    when set, callers must send a matching
 *                          x-mdh-proxy-token header
 */

import dns from "node:dns/promises";
import net from "node:net";

const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HEADERS = 25;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 2048;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Headers the caller may not set: hop-by-hop headers, anything that would let
// the caller lie about the origin of the request, and anything the runtime
// owns.
const BLOCKED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

// Response headers not worth relaying back to the page.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// Best-effort only: function instances are ephemeral and may run in parallel,
// so this slows down casual abuse rather than guaranteeing a hard ceiling.
const rateLimitBuckets = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;

  // Keep the map from growing without bound across a warm instance's life.
  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets) {
      if (now > v.resetAt) rateLimitBuckets.delete(k);
    }
  }

  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function ipv4ToInt(address) {
  return address
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function isBlockedIpv4(address) {
  const value = ipv4ToInt(address);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];

  // IPv4-mapped and IPv4-compatible addresses are judged as IPv4.
  const mapped = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (normalized === "::" || normalized === "::1") return true;

  const firstGroup = parseInt(normalized.split(":")[0] || "0", 16);
  if (Number.isNaN(firstGroup)) return true;

  if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((firstGroup & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (firstGroup === 0x0064) return true; // 64:ff9b::/96 NAT64
  if (firstGroup === 0x2001 || firstGroup === 0x2002) {
    // 2001::/23 protocol assignments (incl. Teredo) and 6to4 relays are used
    // to reach otherwise-blocked space.
    const secondGroup = parseInt(normalized.split(":")[1] || "0", 16);
    if (firstGroup === 0x2002) return true;
    if (!Number.isNaN(secondGroup) && secondGroup <= 0x01ff) return true;
  }

  return false;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true; // not a recognizable IP: refuse
}

function hostIsAllowed(hostname) {
  const raw = process.env.WEBHOOK_ALLOWED_HOSTS;
  if (!raw || !raw.trim()) return true; // no allowlist configured

  const host = hostname.toLowerCase();
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) =>
      entry.startsWith(".")
        ? host === entry.slice(1) || host.endsWith(entry)
        : host === entry
    );
}

class RequestError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function resolveWithDnsOverHttps(hostname) {
  const resolver = "https://cloudflare-dns.com/dns-query";
  const queries = ["A", "AAAA"].map(async (type) => {
    const url = new URL(resolver);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.Answer || [])
      .map((answer) => answer.data)
      .filter((address) => net.isIP(address));
  });

  const results = await Promise.allSettled(queries);
  return [...new Set(results.flatMap((result) => result.status === "fulfilled" ? result.value : []))];
}

async function validateTarget(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new RequestError(400, "A destination url is required.");
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new RequestError(400, "The destination url could not be parsed.");
  }

  if (url.protocol !== "https:") {
    throw new RequestError(
      400,
      "Only https:// destinations are allowed.",
      "Plain http and non-http schemes are refused so the proxy cannot be used to reach internal services."
    );
  }

  if (url.username || url.password) {
    throw new RequestError(
      400,
      "Credentials in the destination url are not allowed.",
      "Send authentication as a header instead."
    );
  }

  if (!hostIsAllowed(url.hostname)) {
    throw new RequestError(
      403,
      `${url.hostname} is not on this deployment's webhook allowlist.`
    );
  }

  const bareHost = url.hostname.replace(/^\[|\]$/g, "");

  let addresses;
  if (net.isIP(bareHost)) {
    addresses = [bareHost];
  } else {
    try {
      const resolved = await dns.lookup(bareHost, { all: true, verbatim: true });
      addresses = resolved.map((entry) => entry.address);
    } catch {
      addresses = await resolveWithDnsOverHttps(bareHost);
      if (!addresses.length) {
        throw new RequestError(400, `The host ${url.hostname} could not be resolved.`);
      }
    }
  }

  if (!addresses.length) {
    throw new RequestError(400, `The host ${url.hostname} resolved to no addresses.`);
  }

  const blocked = addresses.filter(isBlockedAddress);
  if (blocked.length) {
    throw new RequestError(
      403,
      `${url.hostname} resolves to a non-public address.`,
      "Private, loopback, link-local, and cloud metadata addresses are refused."
    );
  }

  return { url, addresses };
}

function buildOutboundHeaders(input) {
  const headers = new Headers();

  if (input === undefined || input === null) return headers;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new RequestError(400, "headers must be a JSON object.");
  }

  const entries = Object.entries(input);
  if (entries.length > MAX_HEADERS) {
    throw new RequestError(400, `At most ${MAX_HEADERS} headers may be sent.`);
  }

  for (const [name, value] of entries) {
    const key = String(name).trim();
    const stringValue = String(value);

    if (!key || key.length > MAX_HEADER_NAME_LENGTH) {
      throw new RequestError(400, `Header name "${key}" is not valid.`);
    }
    if (stringValue.length > MAX_HEADER_VALUE_LENGTH) {
      throw new RequestError(400, `The value for "${key}" is too long.`);
    }
    if (BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      throw new RequestError(400, `The header "${key}" cannot be set through this proxy.`);
    }

    try {
      headers.set(key, stringValue);
    } catch {
      throw new RequestError(400, `The header "${key}" is not valid.`);
    }
  }

  return headers;
}

async function readCappedBody(response) {
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > MAX_RESPONSE_BODY_BYTES) {
      const keep = value.byteLength - (received - MAX_RESPONSE_BODY_BYTES);
      if (keep > 0) chunks.push(value.subarray(0, keep));
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
  }

  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "POST, OPTIONS",
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== "POST") {
    return json(405, { error: "This endpoint accepts POST requests only." });
  }

  const expectedToken = process.env.WEBHOOK_PROXY_TOKEN;
  if (expectedToken && request.headers.get("x-mdh-proxy-token") !== expectedToken) {
    return json(401, { error: "A valid x-mdh-proxy-token header is required." });
  }

  const clientKey =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  if (isRateLimited(clientKey)) {
    return json(429, {
      error: `Rate limit reached: ${RATE_LIMIT_MAX_REQUESTS} deliveries per minute.`,
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "The request body must be valid JSON." });
  }

  const method = String(payload?.method || "POST").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return json(400, {
      error: `${method} is not supported.`,
      detail: `Allowed methods: ${[...ALLOWED_METHODS].join(", ")}.`,
    });
  }

  let target;
  let outboundHeaders;
  try {
    target = await validateTarget(payload?.url);
    outboundHeaders = buildOutboundHeaders(payload?.headers);
  } catch (error) {
    if (error instanceof RequestError) {
      return json(error.status, { error: error.message, detail: error.detail });
    }
    throw error;
  }

  let body;
  if (!["GET", "DELETE"].includes(method) && payload?.body) {
    body = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body);

    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BODY_BYTES) {
      return json(413, {
        error: `The payload exceeds the ${Math.round(MAX_REQUEST_BODY_BYTES / 1024)} KB limit.`,
      });
    }

    if (!outboundHeaders.has("content-type")) {
      outboundHeaders.set("Content-Type", "application/json");
    }
  }

  if (!outboundHeaders.has("user-agent")) {
    outboundHeaders.set("User-Agent", "MDH-API-Webhook-Tester/1.0");
  }

  const started = Date.now();

  try {
    const upstream = await fetch(target.url, {
      method,
      headers: outboundHeaders,
      body,
      redirect: "manual", // following a redirect would re-open the SSRF hole
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const { text, truncated } = await readCappedBody(upstream);
    const durationMs = Date.now() - started;

    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
        responseHeaders[name] = value;
      }
    }

    let parsedBody = text;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      // leave it as text
    }

    const isRedirect = upstream.status >= 300 && upstream.status < 400;

    return json(200, {
      ok: upstream.ok,
      status: upstream.status,
      statusText: upstream.statusText,
      durationMs,
      target: target.url.toString(),
      headers: responseHeaders,
      body: parsedBody,
      truncated,
      note: isRedirect
        ? "The destination returned a redirect. Redirects are not followed; send the request to the final url instead."
        : undefined,
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";

    return json(timedOut ? 504 : 502, {
      error: timedOut
        ? `The destination did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
        : "The delivery could not be completed.",
      detail: timedOut ? undefined : error?.message,
      durationMs,
      target: target.url.toString(),
    });
  }
}

export const config = {
  path: "/api/send-webhook",
};

// Exported for local testing.
export const __test__ = { isBlockedAddress, validateTarget, hostIsAllowed };
