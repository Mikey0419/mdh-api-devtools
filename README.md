# MDH-API Developer Network Toolkit

A Vue + Tailwind developer utility for building and testing HTTP requests, webhooks, WebSockets, and OpenAPI endpoints.

## Features
- HTTP request builder with query params, headers, body, response inspection, and cURL/fetch/Python export
- Server-side HTTP proxy to avoid browser CORS limitations while testing APIs
- Temporary webhook endpoints with live Server-Sent Events capture
- WebSocket client with message log
- OpenAPI / Swagger YAML or JSON parsing into fill-in-the-blank endpoint forms
- JSON formatter, JWT decoder, URL encode/decode, Base64 encode/decode, HTTP status lookup

## Local development
```bash
npm install
npm run dev
```
- Vue/Vite: http://localhost:5173
- Node API: http://localhost:8002

## Production build
```bash
npm install
npm run build
npm start
```
Then open http://localhost:8002.

## Deploying

### Netlify (the static landing page in `site/`)
`netlify.toml` publishes `site/` and builds the functions in `netlify/functions/`.

The landing page's Webhook tab delivers through `netlify/functions/send-webhook.mjs`,
exposed at `/api/send-webhook`. The browser cannot POST a webhook to a third-party
endpoint directly — the destination would need to return CORS headers, and webhook
receivers never do — so the function performs the delivery and relays the upstream
status, headers, and body back to the page.

Because an open HTTP proxy is a liability, the function enforces:

- HTTPS destinations only; no credentials in the URL
- every resolved IP must be publicly routable, which blocks SSRF into loopback,
  RFC1918, CGNAT, link-local, and cloud metadata (`169.254.169.254`) addresses
- redirects are reported, not followed
- 256 KB request and response caps, 25-header cap, hop-by-hop headers rejected
- a 10s timeout and a best-effort 30-requests-per-minute per-IP limit

Optional environment variables, set in the Netlify UI:

| Variable | Effect |
| --- | --- |
| `WEBHOOK_ALLOWED_HOSTS` | Comma-separated hosts. When set, only these may be targeted. Use `.example.com` to include subdomains. |
| `WEBHOOK_PROXY_TOKEN` | When set, callers must send a matching `x-mdh-proxy-token` header. |

Run it locally with `netlify dev` — a plain static server will 404 on
`/api/send-webhook`, and the page says so explicitly when that happens.

Note that the function only *sends* webhooks. Receiving them needs a persistent
process; that is what the Node server below is for.

### Self-hosted (the Vue app plus the Node server)
This app needs a persistent Node process for the HTTP proxy and the webhook receiver.

For a VPS / DreamHost VPS:
```bash
npm install
npm run build
pm2 start server/index.js --name mdh-api
pm2 save
```
Put Nginx or Apache in front of port 8002 and proxy `mdh-api.com` to it.

## Current webhook storage
Webhook events are intentionally in-memory for the MVP. Restarting the server clears them. For durable endpoints, add Redis/Postgres and endpoint ownership/authentication.
