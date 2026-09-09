import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import WebSocket from 'ws'

const app=express(); const PORT=process.env.PORT||8002
const hooks=new Map(), streams=new Map(), wsSessions=new Map(), wsStreams=new Map()
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

app.post('/api/webhooks',(req,res)=>{
  const id=randomUUID().replaceAll('-','').slice(0,12); hooks.set(id,[]); streams.set(id,new Set())
  res.json({id,path:`/hooks/${id}`})
})
app.get('/api/webhooks/:id/events',(req,res)=>{
  const {id}=req.params;if(!hooks.has(id))return res.sendStatus(404)
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders()
  streams.get(id).add(res);req.on('close',()=>streams.get(id)?.delete(res))
})
app.all('/hooks/:id',(req,res)=>{
  const {id}=req.params;if(!hooks.has(id))return res.status(404).json({error:'Unknown webhook endpoint'})
  const event={id:randomUUID(),receivedAt:new Date().toISOString(),method:req.method,path:req.originalUrl,headers:req.headers,query:req.query,body:req.body}
  hooks.get(id).unshift(event);if(hooks.get(id).length>100)hooks.get(id).length=100
  for(const client of streams.get(id)||[]) client.write(`data: ${JSON.stringify(event)}\n\n`)
  res.status(200).json({received:true,id:event.id})
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
app.listen(PORT,()=>console.log(`MDH-API running on http://localhost:${PORT}`))
