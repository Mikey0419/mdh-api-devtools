<script setup>
import { computed, ref } from 'vue'
import CodeBlock from '../components/CodeBlock.vue'

const method=ref('GET'), url=ref('https://httpbin.org/anything'), headers=ref([{key:'Accept',value:'application/json'}]), params=ref([{key:'',value:''}]), body=ref(''), response=ref(null), loading=ref(false), tab=ref('curl')
const finalUrl=computed(()=>{ try { const u=new URL(url.value); params.value.filter(x=>x.key).forEach(x=>u.searchParams.set(x.key,x.value)); return u.toString() } catch { return url.value } })
const headerObject=computed(()=>Object.fromEntries(headers.value.filter(x=>x.key).map(x=>[x.key,x.value])))
const curl=computed(()=>{ let s=`curl -X ${method.value} '${finalUrl.value}'`; headers.value.filter(x=>x.key).forEach(h=>s+=` \\\n  -H '${h.key}: ${h.value}'`); if(body.value && !['GET','HEAD'].includes(method.value)) s+=` \\\n  --data '${body.value.replaceAll("'","'\\''")}'`; return s })
const fetchCode=computed(()=>`const response = await fetch('${finalUrl.value}', {\n  method: '${method.value}',\n  headers: ${JSON.stringify(headerObject.value,null,2)}${body.value && !['GET','HEAD'].includes(method.value) ? `,\n  body: ${JSON.stringify(body.value)}`:''}\n});\n\nconst data = await response.text();\nconsole.log(data);`)
const pythonCode=computed(()=>`import requests\n\nresponse = requests.${method.value.toLowerCase()}(\n    '${finalUrl.value}',\n    headers=${JSON.stringify(headerObject.value,null,2).replace(/true/g,'True').replace(/false/g,'False').replace(/null/g,'None')}${body.value && !['GET','HEAD'].includes(method.value) ? `,\n    data=${JSON.stringify(body.value)}`:''}\n)\nprint(response.status_code)\nprint(response.text)`)
const generated=computed(()=>tab.value==='curl'?curl.value:tab.value==='fetch'?fetchCode.value:pythonCode.value)
function add(arr){ arr.push({key:'',value:''}) }
async function send(){ loading.value=true; response.value=null; try { const r=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:method.value,url:finalUrl.value,headers:headerObject.value,body:body.value})}); response.value=await r.json() } catch(e){ response.value={error:e.message} } finally{loading.value=false} }
</script>
<template>
<section class="mx-auto max-w-7xl px-5 py-10">
  <div class="mb-8"><div class="badge">HTTP</div><h1 class="mt-3 text-3xl font-bold">Request Builder</h1><p class="mt-2 text-slate-400">Build the request visually, send it through MDH-API, then copy working code.</p></div>
  <div class="panel p-5">
    <div class="flex gap-2"><select v-model="method" class="input !w-32"><option v-for="m in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']">{{m}}</option></select><input v-model="url" class="input mono" placeholder="https://api.example.com/users"><button @click="send" class="btn-primary min-w-24">{{ loading?'Sending…':'Send' }}</button></div>
    <div class="mt-6 grid gap-6 lg:grid-cols-2">
      <div><div class="mb-2 flex justify-between"><h3 class="font-semibold">Query parameters</h3><button @click="add(params)" class="text-sm text-cyan-300">+ Add</button></div><div v-for="(p,i) in params" :key="i" class="mb-2 grid grid-cols-2 gap-2"><input v-model="p.key" class="input" placeholder="key"><input v-model="p.value" class="input" placeholder="value"></div></div>
      <div><div class="mb-2 flex justify-between"><h3 class="font-semibold">Headers</h3><button @click="add(headers)" class="text-sm text-cyan-300">+ Add</button></div><div v-for="(h,i) in headers" :key="i" class="mb-2 grid grid-cols-2 gap-2"><input v-model="h.key" class="input" placeholder="Authorization"><input v-model="h.value" class="input" placeholder="Bearer …"></div></div>
    </div>
    <div class="mt-6"><h3 class="mb-2 font-semibold">Body</h3><textarea v-model="body" class="input mono min-h-40" placeholder='{"name":"Mike"}'></textarea></div>
  </div>
  <div class="mt-6 grid gap-6 lg:grid-cols-2">
    <div class="panel p-5"><div class="mb-4 flex items-center justify-between"><h2 class="font-bold">Generated request</h2><div class="flex gap-1"><button v-for="t in ['curl','fetch','python']" :key="t" @click="tab=t" :class="['rounded-sm border border-transparent px-2.5 py-1 text-xs',tab===t?'border-cyan-300/20 bg-cyan-300/[.06] text-white':'text-slate-500']">{{t}}</button></div></div><CodeBlock :code="generated" /></div>
    <div class="panel p-5"><h2 class="mb-4 font-bold">Response</h2><div v-if="!response" class="grid min-h-56 place-items-center text-sm text-slate-500">Send a request to inspect the response.</div><div v-else><div class="mb-3 flex gap-2"><span class="badge">{{response.status || 'Error'}}</span><span v-if="response.durationMs" class="badge">{{response.durationMs}} ms</span></div><CodeBlock :code="JSON.stringify(response.body ?? response,null,2)" /></div></div>
  </div>
</section>
</template>
