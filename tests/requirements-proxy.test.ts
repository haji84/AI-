import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequirementsProxy} from '../src/orchestrator/requirements-proxy.ts';
test('owner browser publisher proxy authenticates and fixes target without request authority',async()=>{
 let calls=0;
 const proxy=createRequirementsProxy(async()=>true,async(path,init)=>{
  calls++;assert.equal(path,'/api/jarvis/admin/requirements/publish');
  assert.deepEqual(JSON.parse(String(init?.body)),{decisionId:'owner-intake-'+'a'.repeat(32),review:{sourceRef:'x'}});
  return Response.json({status:'DRAFT_OPEN',canonicalSynced:false});
 });
 const req=(v:unknown)=>new Request('http://localhost/api/jarvis/requirements',{method:'POST',body:JSON.stringify(v)});
 assert.equal((await proxy.POST(req({token:'bad',decisionId:'x'}))).status,400);assert.equal(calls,0);
 const ok=await proxy.POST(req({decisionId:'owner-intake-'+'a'.repeat(32),review:{sourceRef:'x'}}));assert.equal(ok.status,200);assert.equal((await ok.json()).canonicalSynced,false);
 const denied=createRequirementsProxy(async()=>false,async()=>{throw Error('must not fetch');});
 assert.equal((await denied.POST(req({}))).status,401);assert.equal((await denied.GET()).status,401);
});
test('browser proxy bounds streamed inputs and hides upstream transport details',async()=>{
 let calls=0;
 const proxy=createRequirementsProxy(async()=>true,async()=>{calls++;throw Error('secret upstream detail');});
 const tooBig=new Request('http://localhost/api/jarvis/requirements',{method:'POST',body:'x'.repeat(32769)});
 assert.equal((await proxy.POST(tooBig)).status,400);assert.equal(calls,0);
 const response=await proxy.GET();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret upstream/);
});
