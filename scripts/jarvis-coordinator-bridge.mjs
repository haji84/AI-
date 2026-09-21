import { createServer } from "node:http";

const host=process.env.JARVIS_COORDINATOR_BRIDGE_HOST?.trim()||"127.0.0.1";
const port=Number(process.env.JARVIS_COORDINATOR_BRIDGE_PORT||8792);
const primary=process.env.JARVIS_COORDINATOR_PRIMARY_URL?.trim().replace(/\/$/,"")||"";
const shadow=process.env.JARVIS_COORDINATOR_SHADOW_URL?.trim().replace(/\/$/,"")||"";
const mode=(process.env.JARVIS_COORDINATOR_BRIDGE_MODE?.trim().toUpperCase()||"LEGACY");
const canaries=new Set((process.env.JARVIS_COORDINATOR_CANARY_IDS||"").split(",").map(x=>x.trim()).filter(Boolean));

function validTarget(raw){
  if(!raw)return false;const u=new URL(raw);
  if(u.username||u.password||u.hash)return false;
  return u.protocol==="https:"||(u.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(u.hostname));
}
if(!validTarget(primary))throw new Error("JARVIS_COORDINATOR_PRIMARY_URL must be loopback HTTP or HTTPS");
if(shadow&&!validTarget(shadow))throw new Error("JARVIS_COORDINATOR_SHADOW_URL must be loopback HTTP or HTTPS");
if(host!=="127.0.0.1"&&host!=="::1"&&process.env.JARVIS_ALLOW_NON_LOOPBACK!=="1")throw new Error("Coordinator bridge refuses non-loopback bind without explicit private-ingress override");

function targetFor(req){
  const id=String(req.headers["x-jarvis-node-id"]||"");
  if(mode==="PRIMARY")return shadow||primary;
  if(mode==="CANARY"&&id&&canaries.has(id))return shadow||primary;
  return primary;
}
async function bodyOf(req,limit=2*1024*1024){
  const chunks=[];let total=0;
  for await(const part of req){const b=Buffer.isBuffer(part)?part:Buffer.from(part);total+=b.length;if(total>limit)throw new Error("request body too large");chunks.push(b);}
  return Buffer.concat(chunks);
}
function headers(req){
  const out={};for(const [k,v] of Object.entries(req.headers)){if(v===undefined||["host","connection","content-length"].includes(k))continue;out[k]=Array.isArray(v)?v.join(","):v;}return out;
}
async function proxy(req,res){
  const raw=await bodyOf(req);const upstream=targetFor(req);
  const response=await fetch(upstream+(req.url||"/"),{method:req.method,headers:headers(req),body:["GET","HEAD"].includes(req.method||"GET")?undefined:raw,redirect:"manual",signal:AbortSignal.timeout(30_000)});
  res.statusCode=response.status;for(const [k,v] of response.headers){if(["content-encoding","transfer-encoding","connection"].includes(k.toLowerCase()))continue;res.setHeader(k,v);}
  const data=Buffer.from(await response.arrayBuffer());res.setHeader("content-length",String(data.length));res.end(data);
  if(mode==="SHADOW"&&shadow&&["GET","HEAD"].includes(req.method||"GET")){
    void fetch(shadow+(req.url||"/"),{method:req.method,headers:headers(req),redirect:"manual",signal:AbortSignal.timeout(10_000)}).then(async s=>{
      const sb=Buffer.from(await s.arrayBuffer());const same=s.status===response.status&&Buffer.compare(sb,data)===0;
      if(!same)console.warn("[coordinator-bridge] shadow divergence",{path:req.url,primary:response.status,shadow:s.status});
    }).catch(error=>console.warn("[coordinator-bridge] shadow failed",error instanceof Error?error.message:"unknown"));
  }
}
const server=createServer((req,res)=>{
  if(req.method==="GET"&&req.url==="/health"){res.setHeader("content-type","application/json");res.end(JSON.stringify({ok:true,service:"jarvis-coordinator-compat-bridge",mode,primary,shadowConfigured:Boolean(shadow),canaries:canaries.size}));return;}
  proxy(req,res).catch(error=>{res.statusCode=502;res.setHeader("content-type","application/json");res.end(JSON.stringify({message:error instanceof Error?error.message:"bridge failure"}));});
});
server.listen(port,host,()=>console.log(`[coordinator-bridge] listening http://${host}:${port} mode=${mode}`));
function shutdown(){server.close(()=>process.exit(0));}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
