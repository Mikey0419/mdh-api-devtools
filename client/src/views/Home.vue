<script setup>
import { RouterLink } from 'vue-router'
const cards = [
  { title:'HTTP Request Builder', text:'Build, send, inspect, and export API requests without fighting syntax.', to:'/http', icon:'→' },
  { title:'Webhook Tester', text:'Create a temporary endpoint, capture payloads, inspect headers, and replay requests.', to:'/webhooks', icon:'↙' },
  { title:'WebSocket Client', text:'Connect to ws:// or wss:// endpoints and inspect real-time message traffic.', to:'/websockets', icon:'↔' },
  { title:'OpenAPI Import', text:'Paste an OpenAPI or Swagger spec and turn endpoints into fill-in-the-blank request forms.', to:'/openapi', icon:'{}' },
  { title:'Developer Tools', text:'Format JSON, decode JWTs, encode URLs, convert Base64, and check HTTP status codes.', to:'/tools', icon:'⌘' }
]
</script>
<template>
  <section class="mx-auto max-w-7xl px-5 py-20 md:py-28">
    <div class="max-w-4xl">
      <div class="badge mb-6">Developer network tools without the clutter</div>
      <h1 class="text-5xl font-black tracking-[-.04em] text-white md:text-7xl">Build. Send.<br><span class="text-cyan-300">Inspect.</span></h1>
      <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-400">MDH-API helps you figure out what an endpoint needs, build the request, send it, and understand exactly what came back.</p>
      <div class="mt-8 flex flex-wrap gap-3"><RouterLink to="/http" class="btn-primary">Build a request →</RouterLink><RouterLink to="/webhooks" class="btn-secondary">Create webhook endpoint</RouterLink></div>
    </div>
    <div class="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <RouterLink v-for="card in cards" :key="card.to" :to="card.to" class="panel group p-6 transition hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/[0.055]">
        <div class="mb-10 text-2xl text-cyan-300">{{ card.icon }}</div><h2 class="text-lg font-bold text-white">{{ card.title }}</h2><p class="mt-2 text-sm leading-6 text-slate-400">{{ card.text }}</p><div class="mt-6 text-sm font-semibold text-cyan-300">Open tool →</div>
      </RouterLink>
    </div>
  </section>
</template>
