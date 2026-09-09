<script setup>
import { computed, ref } from 'vue'
import CodeBlock from '../components/CodeBlock.vue'

const method=ref('GET'), url=ref('https://httpbin.org/anything'), headers=ref([{key:'Accept',value:'application/json'}]), params=ref([{key:'',value:''}]), body=ref(''), response=ref(null), loading=ref(false), tab=ref('curl')
const importOpen=ref(false), importText=ref(''), importError=ref(''), importSuccess=ref('')
const finalUrl=computed(()=>{ try { const u=new URL(url.value); params.value.filter(x=>x.key).forEach(x=>u.searchParams.set(x.key,x.value)); return u.toString() } catch { return url.value } })
const headerObject=computed(()=>Object.fromEntries(headers.value.filter(x=>x.key).map(x=>[x.key,x.value])))
const curl=computed(()=>{ let s=`curl -X ${method.value} '${finalUrl.value}'`; headers.value.filter(x=>x.key).forEach(h=>s+=` \\\n  -H '${h.key}: ${h.value}'`); if(body.value && !['GET','HEAD'].includes(method.value)) s+=` \\\n  --data '${body.value.replaceAll("'","'\\''")}'`; return s })
const fetchCode=computed(()=>`const response = await fetch('${finalUrl.value}', {\n  method: '${method.value}',\n  headers: ${JSON.stringify(headerObject.value,null,2)}${body.value && !['GET','HEAD'].includes(method.value) ? `,\n  body: ${JSON.stringify(body.value)}`:''}\n});\n\nconst data = await response.text();\nconsole.log(data);`)
const pythonCode=computed(()=>`import requests\n\nresponse = requests.${method.value.toLowerCase()}(\n    '${finalUrl.value}',\n    headers=${JSON.stringify(headerObject.value,null,2).replace(/true/g,'True').replace(/false/g,'False').replace(/null/g,'None')}${body.value && !['GET','HEAD'].includes(method.value) ? `,\n    data=${JSON.stringify(body.value)}`:''}\n)\nprint(response.status_code)\nprint(response.text)`)
const generated=computed(()=>tab.value==='curl'?curl.value:tab.value==='fetch'?fetchCode.value:pythonCode.value)
function add(arr){ arr.push({key:'',value:''}) }
async function send(){ loading.value=true; response.value=null; try { const r=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:method.value,url:finalUrl.value,headers:headerObject.value,body:body.value})}); response.value=await r.json() } catch(e){ response.value={error:e.message} } finally{loading.value=false} }

function tokenizeShell(value){
  const tokens=[]
  const normalized=value.replace(/\\\r?\n/g,' ')
  const pattern=/"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g
  let match
  while((match=pattern.exec(normalized))) tokens.push((match[1]??match[2]??match[3]).replace(/\\"/g,'"'))
  return tokens
}

function parseCurl(value){
  const tokens=tokenizeShell(value.trim())
  if(tokens[0]?.toLowerCase()!=='curl') throw new Error('Paste a cURL command or a JSON request object.')
  const request={method:'GET',headers:[],body:'',url:''}
  for(let i=1;i<tokens.length;i++){
    const token=tokens[i]
    if(token==='-X'||token==='--request') request.method=(tokens[++i]||'GET').toUpperCase()
    else if(token.startsWith('-X')&&token.length>2) request.method=token.slice(2).toUpperCase()
    else if(token==='-H'||token==='--header') request.headers.push(tokens[++i]||'')
    else if(token.startsWith('-H')&&token.length>2) request.headers.push(token.slice(2))
    else if(['-d','--data','--data-raw','--data-binary'].includes(token)){ request.body=tokens[++i]||''; if(request.method==='GET') request.method='POST' }
    else if(token==='--url') request.url=tokens[++i]||''
    else if(token==='-G'||token==='--get') request.method='GET'
    else if(/^https?:\/\//i.test(token)) request.url=token
  }
  request.headers=request.headers.map(line=>{ const index=line.indexOf(':'); return index<0?{key:line,value:''}:{key:line.slice(0,index).trim(),value:line.slice(index+1).trim()} }).filter(item=>item.key)
  if(!request.url) throw new Error('The cURL command does not include an HTTP or HTTPS URL.')
  return request
}

function parseJsonRequest(value){
  const parsed=JSON.parse(value)
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object') throw new Error('The JSON import must be a request object.')
  const importedHeaders=Array.isArray(parsed.headers)
    ? parsed.headers
    : Object.entries(parsed.headers||{}).map(([key,val])=>({key,value:String(val)}))
  return {
    method:String(parsed.method||'GET').toUpperCase(),
    url:parsed.url||parsed.endpoint||'',
    headers:importedHeaders,
    params:parsed.params||parsed.query||{},
    body:typeof parsed.body==='string'?parsed.body:parsed.body==null?'':JSON.stringify(parsed.body,null,2)
  }
}

function applyImportedRequest(request){
  if(!request.url) throw new Error('The imported request needs a URL.')
  const importedUrl=new URL(request.url)
  const importedParams=Array.from(importedUrl.searchParams.entries()).map(([key,value])=>({key,value}))
  importedUrl.search=''
  const extraParams=Array.isArray(request.params)
    ? request.params
    : Object.entries(request.params||{}).map(([key,value])=>({key,value:String(value)}))
  method.value=request.method||'GET'
  url.value=importedUrl.toString()
  headers.value=request.headers?.length?request.headers.map(item=>({key:item.key||'',value:item.value||''})):[{key:'',value:''}]
  params.value=[...importedParams,...extraParams]
  if(!params.value.length) params.value=[{key:'',value:''}]
  body.value=request.body||''
  response.value=null
}

function importRequest(){
  importError.value=''; importSuccess.value=''
  try{
    const source=importText.value.trim()
    if(!source) throw new Error('Paste an example request first.')
    applyImportedRequest(source.startsWith('{')?parseJsonRequest(source):parseCurl(source))
    importSuccess.value='Request imported. Review the fields, then send it.'
  }catch(error){ importError.value=error.message }
}

function loadExample(){
  importText.value=`curl -X POST 'https://httpbin.org/anything?source=example' \\
  -H 'Accept: application/json' \\
  -H 'Content-Type: application/json' \\
  --data '{"name":"Mike","active":true}'`
  importError.value=''; importSuccess.value=''
}
</script>
<template>
<section class="mx-auto max-w-7xl px-5 py-10">
  <div class="mb-8 flex flex-wrap items-end justify-between gap-5">
    <div><div class="badge">HTTP</div><h1 class="mt-3 text-3xl font-bold">Request Builder</h1><p class="mt-2 text-slate-400">Build manually or import a working example, then send it through MDH-API.</p></div>
    <button @click="importOpen=!importOpen" class="btn-secondary">{{importOpen?'Close importer':'Import request'}}</button>
  </div>
  <div v-if="importOpen" class="panel mb-6 p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 class="font-bold">Import an example request</h2><p class="mt-1 text-sm text-slate-400">Paste cURL or JSON with method, URL, headers, query parameters, and body.</p></div>
      <button @click="loadExample" class="text-sm font-semibold text-cyan-300 hover:text-cyan-200">Load example</button>
    </div>
    <textarea v-model="importText" class="input mono mt-4 min-h-40" placeholder="curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' --data '{&quot;name&quot;:&quot;Mike&quot;}'"></textarea>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <button @click="importRequest" class="btn-primary">Import into builder</button>
      <span v-if="importSuccess" class="text-sm text-emerald-300">{{importSuccess}}</span>
      <span v-if="importError" class="text-sm text-red-300">{{importError}}</span>
    </div>
  </div>
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
