<script setup>
import { onBeforeUnmount, ref } from 'vue'
import CodeBlock from '../components/CodeBlock.vue'
const endpoint=ref(''), events=ref([]), selected=ref(null); let source=null
async function create(){ const r=await fetch('/api/webhooks',{method:'POST'}); const d=await r.json(); endpoint.value=location.origin+d.path; connect(d.id) }
function connect(id){ const es=new EventSource(`/api/webhooks/${id}/events`); es.onmessage=e=>{ const item=JSON.parse(e.data); events.value.unshift(item); selected.value=item }; source=es }
async function copy(){ await navigator.clipboard.writeText(endpoint.value) }
onBeforeUnmount(()=>source?.close())
</script>
<template>
<section class="mx-auto max-w-7xl px-5 py-10"><div class="mb-8"><div class="badge">Webhooks</div><h1 class="mt-3 text-3xl font-bold">Webhook Tester</h1><p class="mt-2 text-slate-400">Generate an endpoint and watch requests arrive live.</p></div>
<div v-if="!endpoint" class="panel grid min-h-72 place-items-center p-8 text-center"><div><div class="text-5xl text-cyan-300">↙</div><h2 class="mt-5 text-xl font-bold">Create a temporary webhook endpoint</h2><p class="mt-2 text-sm text-slate-400">Incoming requests are stored in memory for this server session.</p><button @click="create" class="btn-primary mt-6">Create endpoint</button></div></div>
<div v-else><div class="panel p-5"><div class="text-xs uppercase tracking-wider text-slate-500">Your endpoint</div><div class="mt-2 flex gap-2"><input :value="endpoint" readonly class="input mono"><button @click="copy" class="btn-secondary">Copy</button></div></div>
<div class="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]"><div class="panel p-3"><div class="px-2 py-2 text-sm font-semibold">Incoming requests <span class="text-slate-500">({{events.length}})</span></div><div v-if="!events.length" class="p-6 text-center text-sm text-slate-500">Waiting for a request…</div><button v-for="e in events" :key="e.id" @click="selected=e" class="mb-2 w-full rounded-xl border border-white/5 bg-white/[.03] p-3 text-left hover:bg-white/[.07]"><div class="flex justify-between"><span class="font-bold text-cyan-300">{{e.method}}</span><span class="text-xs text-slate-500">{{new Date(e.receivedAt).toLocaleTimeString()}}</span></div><div class="mt-1 truncate text-xs text-slate-400">{{e.path}}</div></button></div>
<div class="panel p-5"><div v-if="!selected" class="grid min-h-64 place-items-center text-slate-500">Select a request.</div><div v-else><div class="mb-5 flex gap-2"><span class="badge">{{selected.method}}</span><span class="badge">{{new Date(selected.receivedAt).toLocaleString()}}</span></div><h3 class="mb-2 font-semibold">Headers</h3><CodeBlock :code="JSON.stringify(selected.headers,null,2)"/><h3 class="mb-2 mt-5 font-semibold">Body</h3><CodeBlock :code="typeof selected.body==='string'?selected.body:JSON.stringify(selected.body,null,2)"/></div></div></div></div>
</section>
</template>
