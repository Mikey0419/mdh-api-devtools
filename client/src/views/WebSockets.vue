<script setup>
import { onBeforeUnmount, ref } from 'vue'
const url=ref('wss://echo.websocket.events')
const headers=ref([{key:'',value:''}])
const message=ref('{"type":"ping"}')
const messages=ref([]), status=ref('disconnected'), sessionId=ref('')
let source=null
function log(direction,data){messages.value.unshift({direction,data,time:new Date().toLocaleTimeString()})}
function addHeader(){headers.value.push({key:'',value:''})}
async function connect(){
  await disconnect(false); status.value='connecting'; messages.value=[]
  try{
    const r=await fetch('/api/ws/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.value,headers:Object.fromEntries(headers.value.filter(h=>h.key).map(h=>[h.key,h.value]))})})
    const d=await r.json(); if(!r.ok) throw new Error(d.error||'Connection failed')
    sessionId.value=d.id
    source=new EventSource(`/api/ws/${d.id}/events`)
    source.onmessage=e=>{const evt=JSON.parse(e.data); if(evt.type==='open')status.value='connected'; if(evt.type==='close')status.value='disconnected'; log(evt.direction||'system',evt.data||evt.type)}
    source.onerror=()=>{ if(status.value!=='disconnected') log('system','Event stream interrupted') }
  }catch(e){status.value='disconnected';log('system',e.message)}
}
async function send(){if(!sessionId.value)return; await fetch(`/api/ws/${sessionId.value}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:message.value})})}
async function disconnect(callServer=true){source?.close();source=null;if(callServer&&sessionId.value)await fetch(`/api/ws/${sessionId.value}`,{method:'DELETE'}).catch(()=>{});sessionId.value='';status.value='disconnected'}
onBeforeUnmount(()=>disconnect())
</script>
<template><section class="mx-auto max-w-7xl px-5 py-10"><div class="mb-8"><div class="badge">WebSockets</div><h1 class="mt-3 text-3xl font-bold">WebSocket Client</h1><p class="mt-2 text-slate-400">Connect through the MDH-API server so you can include headers as well as inspect real-time traffic.</p></div><div class="panel p-5"><div class="flex gap-2"><input v-model="url" class="input mono"><button @click="connect" class="btn-primary">Connect</button><button v-if="status!=='disconnected'" @click="disconnect()" class="btn-secondary">Disconnect</button></div><div class="mt-3"><span class="badge">{{status}}</span></div><div class="mt-6 grid gap-6 lg:grid-cols-2"><div><div class="mb-2 flex justify-between"><h3 class="font-semibold">Connection headers</h3><button @click="addHeader" class="text-sm text-cyan-300">+ Add</button></div><div v-for="(h,i) in headers" :key="i" class="mb-2 grid grid-cols-2 gap-2"><input v-model="h.key" class="input" placeholder="Authorization"><input v-model="h.value" class="input" placeholder="Bearer …"></div><h3 class="mb-2 mt-6 font-semibold">Send message</h3><textarea v-model="message" class="input mono min-h-40"></textarea><button @click="send" :disabled="status!=='connected'" class="btn-primary mt-3 disabled:opacity-40">Send</button></div><div><h3 class="mb-2 font-semibold">Message log</h3><div class="h-[420px] overflow-auto rounded-xl border border-white/10 bg-black/20 p-3"><div v-if="!messages.length" class="p-6 text-center text-sm text-slate-500">No messages yet.</div><div v-for="(m,i) in messages" :key="i" class="mb-2 rounded-lg bg-white/[.04] p-3 text-xs"><div class="mb-1 flex justify-between"><span :class="m.direction==='in'?'text-emerald-300':m.direction==='out'?'text-cyan-300':'text-slate-400'">{{m.direction}}</span><span class="text-slate-600">{{m.time}}</span></div><div class="mono break-all text-slate-300">{{m.data}}</div></div></div></div></div></div></section></template>
