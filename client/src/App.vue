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
        <a
          href="https://github.com/Mikey0419/mdh-api-devtools"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-secondary !px-3"
          aria-label="View MDH-API on GitHub"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true" fill="currentColor">
            <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" />
          </svg>
          <span>GitHub</span>
        </a>
      </div>
    </header>
    <main><RouterView /></main>
    <footer class="mx-auto max-w-7xl px-5 py-10 text-sm text-slate-500">MDH-API · Build. Send. Inspect.</footer>
  </div>
</template>
