import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import WebSocket, { WebSocketServer } from 'ws'

const app=express(); const PORT=process.env.PORT||8002
const hooks=new Map(), streams=new Map(), wsSessions=new Map(), wsStreams=new Map(), hookSockets=new Map()
app.use(cors())
app.use(express.json({limit:'2mb'}))
app.use(express.urlencoded({extended:true,limit:'2mb'}))
app.use(express.text({type:['text/*','application/xml'],limit:'2mb'}))

app.post('/api/request', async (req,res)=>{
  const {method='GET',url,headers={},body=''}=req.body||{}
  if(!url) return res.status(400).json({error:'URL is required'})
  const started=Date.now()
  try{
    const opts={method,headers,redirect:'follow'}
    if(body && !['GET','HEAD'].includes(method.toUpperCase())) opts.body=body
    const r=await fetch(url,opts)
    const raw=await r.text(); let parsed=raw
    try{parsed=JSON.parse(raw)}catch{}
    res.json({status:r.status,statusText:r.statusText,durationMs:Date.now()-started,headers:Object.fromEntries(r.headers.entries()),body:parsed})
  }catch(e){res.status(502).json({error:e.message,durationMs:Date.now()-started})}
})

function publicOrigin(req){return process.env.PUBLIC_ORIGIN||`${req.protocol}://${req.get('host')}`}
function createHook(req,res){
  const id=randomUUID().replaceAll('-','').slice(0,12)
  hooks.set(id,{events:[],createdAt:new Date().toISOString(),response:{status:200,contentType:'application/json',body:'{"ok":true,"received":true}'}})
  streams.set(id,new Set());hookSockets.set(id,new Set())
  const hook=hooks.get(id)
  res.status(201).json({id,path:`/hooks/${id}`,url:`${publicOrigin(req)}/hooks/${id}`,createdAt:hook.createdAt,expiresAt:null,response:hook.response})
}
app.post('/api/webhooks',createHook)
app.post('/api/hooks',createHook)
app.get('/api/hooks/:id',(req,res)=>{
  const hook=hooks.get(req.params.id);if(!hook)return res.status(404).json({error:'This endpoint does not exist.'})
  res.json({id:req.params.id,url:`${publicOrigin(req)}/hooks/${req.params.id}`,createdAt:hook.createdAt,expiresAt:null,total:hook.events.length,response:hook.response})
})
app.get('/api/hooks/:id/events',(req,res)=>{
  const hook=hooks.get(req.params.id);if(!hook)return res.status(404).json({error:'This endpoint does not exist.'})
  let events=hook.events
  if(req.query.since){const index=events.findIndex(event=>event.id===req.query.since);if(index>0)events=events.slice(0,index);else if(index===0)events=[]}
  res.json({id:req.params.id,total:hook.events.length,events,expiresAt:null})
})
app.delete('/api/hooks/:id/events',(req,res)=>{
  const hook=hooks.get(req.params.id);if(!hook)return res.status(404).json({error:'This endpoint does not exist.'})
  hook.events=[];res.json({id:req.params.id,cleared:true})
})
app.put('/api/hooks/:id/response',(req,res)=>{
  const hook=hooks.get(req.params.id);if(!hook)return res.status(404).json({error:'This endpoint does not exist.'})
  const status=Number(req.body?.status??200);if(!Number.isInteger(status)||status<100||status>599)return res.status(400).json({error:'status must be between 100 and 599.'})
  hook.response={status,contentType:String(req.body?.contentType||'application/json'),body:String(req.body?.body??'')};res.json({id:req.params.id,response:hook.response})
})
app.get('/api/webhooks/:id/events',(req,res)=>{
  const {id}=req.params;if(!hooks.has(id))return res.sendStatus(404)
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders()
  streams.get(id).add(res);req.on('close',()=>streams.get(id)?.delete(res))
})
app.all('/hooks/:id',(req,res)=>{
  const {id}=req.params;const hook=hooks.get(id);if(!hook)return res.status(404).json({error:'Unknown webhook endpoint'})
  const rawBody=typeof req.body==='string'?req.body:JSON.stringify(req.body??'')
  const event={id:randomUUID(),endpointId:id,receivedAt:new Date().toISOString(),method:req.method,path:req.originalUrl,headers:req.headers,query:req.query,body:rawBody,json:typeof req.body==='object'?req.body:null,truncated:false,bytes:Buffer.byteLength(rawBody),ip:req.ip}
  hook.events.unshift(event);if(hook.events.length>100)hook.events.length=100
  for(const client of streams.get(id)||[]) client.write(`data: ${JSON.stringify(event)}\n\n`)
  const message=JSON.stringify({type:'webhook.received',event,total:hook.events.length})
  for(const client of hookSockets.get(id)||[])if(client.readyState===WebSocket.OPEN)client.send(message)
  const configured=hook.response||{};res.status(configured.status||200).type(configured.contentType||'application/json').send(configured.body??'')
})

function pushWs(id,event){for(const client of wsStreams.get(id)||[]) client.write(`data: ${JSON.stringify(event)}\n\n`)}
app.post('/api/ws/connect',(req,res)=>{
  const {url,headers={}}=req.body||{}; if(!url)return res.status(400).json({error:'WebSocket URL is required'})
  let socket; try{socket=new WebSocket(url,{headers})}catch(e){return res.status(400).json({error:e.message})}
  const id=randomUUID().replaceAll('-','').slice(0,12); wsSessions.set(id,socket); wsStreams.set(id,new Set())
  socket.on('open',()=>pushWs(id,{type:'open',direction:'system',data:'Connected'}))
  socket.on('message',data=>pushWs(id,{type:'message',direction:'in',data:data.toString()}))
  socket.on('error',err=>pushWs(id,{type:'error',direction:'system',data:err.message}))
  socket.on('close',(code,reason)=>{pushWs(id,{type:'close',direction:'system',data:`Disconnected (${code}) ${reason}`});setTimeout(()=>{wsSessions.delete(id);wsStreams.delete(id)},5000)})
  res.json({id})
})
app.get('/api/ws/:id/events',(req,res)=>{
  const {id}=req.params;if(!wsSessions.has(id))return res.sendStatus(404)
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();wsStreams.get(id).add(res)
  const socket=wsSessions.get(id); if(socket.readyState===WebSocket.OPEN) res.write(`data: ${JSON.stringify({type:'open',direction:'system',data:'Connected'})}\n\n`)
  req.on('close',()=>wsStreams.get(id)?.delete(res))
})
app.post('/api/ws/:id/send',(req,res)=>{const socket=wsSessions.get(req.params.id);if(!socket||socket.readyState!==WebSocket.OPEN)return res.status(409).json({error:'WebSocket is not connected'});const msg=String(req.body?.message??'');socket.send(msg);pushWs(req.params.id,{type:'message',direction:'out',data:msg});res.json({sent:true})})
app.delete('/api/ws/:id',(req,res)=>{wsSessions.get(req.params.id)?.close();res.status(204).send()})

const __dirname=path.dirname(fileURLToPath(import.meta.url)); const dist=path.join(__dirname,'../dist')
app.use(express.static(dist))
app.use((req,res,next)=>{if(req.path.startsWith('/api/')||req.path.startsWith('/hooks/'))return next();res.sendFile(path.join(dist,'index.html'))})
const server=createServer(app)
const hookWss=new WebSocketServer({noServer:true})
hookWss.on('connection',(socket,request,id)=>{
  hookSockets.get(id).add(socket)
  socket.send(JSON.stringify({type:'ready',endpointId:id,total:hooks.get(id).events.length}))
  socket.on('close',()=>hookSockets.get(id)?.delete(socket))
})
server.on('upgrade',(request,socket,head)=>{
  let match
  try{match=new URL(request.url,'http://localhost').pathname.match(/^\/ws\/hooks\/([a-z0-9]{12})$/)}catch{}
  const id=match?.[1]
  if(!id||!hooks.has(id)){socket.write('HTTP/1.1 404 Not Found\r\n\r\n');socket.destroy();return}
  hookWss.handleUpgrade(request,socket,head,client=>hookWss.emit('connection',client,request,id))
})
server.listen(PORT,()=>console.log(`MDH-API running on http://localhost:${PORT}`))
