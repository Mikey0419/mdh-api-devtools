<script setup>
import { RouterLink, RouterView } from 'vue-router'
const nav = [
  ['HTTP', '/http'], ['Webhooks', '/webhooks'], ['WebSockets', '/websockets'], ['OpenAPI', '/openapi'], ['Tools', '/tools']
]
</script>

<template>
  <div class="min-h-screen">
    <header class="sticky top-0 z-50 border-b border-cyan-300/15 bg-[#07111f]/90 backdrop-blur-xl">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <RouterLink to="/" class="flex items-center gap-3" aria-label="MDH-API home">
          <div>
            <div class="brand-logo" aria-hidden="true">
              <span>MDH</span>
              <span class="brand-connector">
                <svg viewBox="0 0 32 24" role="img">
                  <path d="m10 5-6 7 6 7M22 5l6 7-6 7M12.5 12h7" />
                  <circle cx="11.5" cy="12" r="1.6" />
                  <circle cx="20.5" cy="12" r="1.6" />
                </svg>
              </span>
              <span>API</span>
            </div>
            <div class="text-[10px] uppercase tracking-[.22em] text-slate-500">Network Toolkit</div>
          </div>
        </RouterLink>
        <nav class="hidden items-center gap-1 md:flex">
          <RouterLink v-for="[label,path] in nav" :key="path" :to="path" class="rounded-sm border border-transparent px-3 py-2 text-sm text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white" active-class="!border-cyan-300/20 !bg-cyan-300/[.06] !text-white">{{ label }}</RouterLink>
        </nav>
        <a href="https://github.com" target="_blank" class="btn-secondary !px-3">GitHub</a>
      </div>
    </header>
    <main><RouterView /></main>
    <footer class="mx-auto max-w-7xl px-5 py-10 text-sm text-slate-500">MDH-API · Build. Send. Inspect.</footer>
  </div>
</template>
