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
This app needs a persistent Node process for the HTTP proxy and webhook receiver. A purely static Netlify deployment will serve the Vue frontend but will not provide persistent webhook endpoints without moving the backend to functions or another Node host.

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
