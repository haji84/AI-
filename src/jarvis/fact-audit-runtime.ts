import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FactVerificationEngine } from './fact-verification.ts';
type Source={title:string;passage:string;url?:string};
type Input={text:string;sources:Source[]};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function parseInput(value:unknown):Input {
 if(!value||typeof value!=='object')throw Error('Input');const p=value as Input;
 if(!text(p.text,12000)||!Array.isArray(p.sources)||p.sources.length>12)throw Error('Input');
 const sources=p.sources.map(s=>{
  if(!s||!text(s.title,160)||!text(s.passage,3000))throw Error('Source');let url:string|undefined;
  if(s.url){if(!text(s.url,1000))throw Error('URL');const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('URL');url=u.href;}
  return {title:s.title,passage:s.passage,...(url?{url}:{})};
 });return {text:p.text,sources};
}
export async function runFactAudit(input:Input) {
 const now=new Date().toISOString();
 const engine=new FactVerificationEngine(undefined,async claim=>input.sources.map((s,i)=>({id:`source-${i+1}`,originId:'owner-supplied-unverified',publisher:s.title,sourceType:'secondary' as const,retrievedAt:now,passage:s.passage,supports:[claim.id]})));
 const result=await engine.verifyText(input.text);
 const audits=result.audits.map(a=>({...a,status:a.status==='SUPPORTED'||a.status==='VERIFIED'?'INFERRED' as const:a.status,reasons:[...a.reasons,'Source authenticity and semantic entailment require independent validation.']}));
 return {version:1,id:randomUUID(),createdAt:now,authority:'DATA_ONLY' as const,sourceTrust:'UNVERIFIED' as const,audits,graph:engine.evidenceGraph(audits),citations:input.sources.map((s,i)=>({id:`source-${i+1}`,...s,retrievedByServer:false})),complete:false as const};
}
type SavedAudit=Awaited<ReturnType<typeof runFactAudit>>;
export class FactAuditStore {
 readonly directory:string;
 constructor(directory:string){this.directory=resolve(directory);}
 list():SavedAudit[]{
  mkdirSync(this.directory,{recursive:true});const names=readdirSync(this.directory).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));if(names.length>200)throw Error('Capacity');
  return names.map(name=>{
   const path=join(this.directory,name);if(statSync(path).size>512000)throw Error('Corrupt');const {digest,record}=JSON.parse(readFileSync(path,'utf8'));
   if(!record||record.id+'.json'!==name||record.version!==1||record.authority!=='DATA_ONLY'||!Array.isArray(record.audits)||!Array.isArray(record.citations)||digest!==createHash('sha256').update(JSON.stringify(record)).digest('hex'))throw Error('Corrupt');
   return record as SavedAudit;
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 save(record:SavedAudit){
  mkdirSync(this.directory,{recursive:true});const lock=join(this.directory,'.lock');const fd=openSync(lock,'wx');
  try{
   if(this.list().length>=200)throw Error('Capacity');const content=JSON.stringify({digest:createHash('sha256').update(JSON.stringify(record)).digest('hex'),record});if(Buffer.byteLength(content)>512000)throw Error('Capacity');
   const target=join(this.directory,record.id+'.json'),temp=target+'.tmp';const out=openSync(temp,'wx');try{writeFileSync(out,content);fsyncSync(out);}finally{closeSync(out);}renameSync(temp,target);
  }finally{closeSync(fd);unlinkSync(lock);}
 }
}
export function factAuditStore(){const configured=process.env.JARVIS_FACT_AUDIT_PATH?.trim();if(process.env.VERCEL&&!configured)throw Error('Durable storage unavailable');return new FactAuditStore(configured||resolve('.jarvis/fact-audits'));}
export async function factAuditRequest(request:Request,deps:{authorize:()=>Promise<boolean>;store:()=>FactAuditStore}):Promise<Response>{
 const headers={'Cache-Control':'no-store'};
 if(!await deps.authorize())return Response.json({message:'Owner authentication required'},{status:401,headers});
 if(request.method==='GET'){try{return Response.json({audits:deps.store().list()},{headers});}catch{return Response.json({message:'Audit storage unavailable'},{status:503,headers});}}
 if(request.method!=='POST')return new Response(null,{status:405,headers});
 const origin=request.headers.get('origin');if(origin){try{const u=new URL(origin);if(u.origin!==origin||!['https:','http:'].includes(u.protocol)||u.host!==(request.headers.get('host')||new URL(request.url).host))throw Error('Origin');}catch{return Response.json({message:'Origin rejected'},{status:403,headers});}}
 let input:Input;
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('JSON');const reader=request.body?.getReader();if(!reader)throw Error('Body');let size=0;const chunks:Uint8Array[]=[];
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>64000){await reader.cancel();throw Error('Size');}chunks.push(r.value);}
  input=parseInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{return Response.json({message:'Invalid audit input'},{status:400,headers});}
 try{const result=await runFactAudit(input);deps.store().save(result);return Response.json(result,{status:201,headers});}catch{return Response.json({message:'Audit could not be persisted'},{status:503,headers});}
}
