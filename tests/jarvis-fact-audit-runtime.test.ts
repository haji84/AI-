import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factAuditRequest, FactAuditStore } from '../src/jarvis/fact-audit-runtime.ts';
const input={text:'The device has 8 GB memory.',sources:[{title:'Provided note',passage:'The device has 8 GB memory.',url:'https://example.com/spec'}]};
const req=(body:unknown)=>new Request('https://jarvis.test/api/jarvis/facts',{method:'POST',headers:{'content-type':'application/json',origin:'https://jarvis.test'},body:JSON.stringify(body)});
test('authenticated audit persists provenance and never certifies owner supplied claims',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fact-audit-'));try{
 const deps={authorize:async()=>true,store:()=>new FactAuditStore(dir)};
 const response=await factAuditRequest(req(input),deps);assert.equal(response.status,201);
 const result=await response.json();assert.equal(result.authority,'DATA_ONLY');assert.ok(result.audits.every((a:{status:string})=>a.status!=='VERIFIED'&&a.status!=='SUPPORTED'));
 const restored=new FactAuditStore(dir).list();assert.equal(restored[0].id,result.id);assert.equal(restored[0].citations[0].title,'Provided note');assert.equal(result.graph.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('auth and origin fail before touching storage',async()=>{
 let calls=0;const store=()=>{calls++;throw Error('storage');};
 assert.equal((await factAuditRequest(req(input),{authorize:async()=>false,store})).status,401);
 const foreign=new Request(req(input),{headers:{'content-type':'application/json',origin:'https://evil.test'}});
 assert.equal((await factAuditRequest(foreign,{authorize:async()=>true,store})).status,403);assert.equal(calls,0);
});
test('invalid, oversized, credential-bearing citation URLs and unconfigured store fail visibly',async()=>{
 const deps={authorize:async()=>true,store:()=>{throw Error('unavailable');}};
 assert.equal((await factAuditRequest(req({...input,sources:[{...input.sources[0],url:'http://127.0.0.1/secret?token=x'}]}),deps)).status,400);
 assert.equal((await factAuditRequest(req({...input,text:'x'.repeat(70000)}),deps)).status,400);
 assert.equal((await factAuditRequest(req(input),deps)).status,503);
});
import {runFactAudit} from '../src/jarvis/fact-audit-runtime.ts';
test('supplied evidence order cannot hide a later matching source',async()=>{
 const match={title:'match',passage:'The device has 8 GB memory.'},other={title:'other',passage:'The sky is blue.'};
 const a=await runFactAudit({text:input.text,sources:[other,match]}),b=await runFactAudit({text:input.text,sources:[match,other]});
 assert.equal(a.audits[0].status,b.audits[0].status);assert.equal(a.audits[0].status,'INFERRED');
});
import {writeFileSync,readdirSync} from 'node:fs';
test('storage corruption and writer lock cannot silently return success',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fact-corrupt-'));try{
 const deps={authorize:async()=>true,store:()=>new FactAuditStore(dir)};
 assert.equal((await factAuditRequest(req(input),deps)).status,201);
 const filename=readdirSync(dir).find(n=>n.endsWith('.json'))!;writeFileSync(join(dir,filename),'broken');
 assert.equal((await factAuditRequest(new Request('https://jarvis.test/api/jarvis/facts'),deps)).status,503);
 assert.equal((await factAuditRequest(req(input),deps)).status,503);
 }finally{rmSync(dir,{recursive:true,force:true});}
 const locked=mkdtempSync(join(tmpdir(),'fact-lock-'));try{writeFileSync(join(locked,'.lock'),'');assert.equal((await factAuditRequest(req(input),{authorize:async()=>true,store:()=>new FactAuditStore(locked)})).status,503);}finally{rmSync(locked,{recursive:true,force:true});}
});
