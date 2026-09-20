import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeachingStore, replayTeaching, type DeviceProfile } from '../src/jarvis/teaching.ts';
import { teachingLibraryResponse } from '../src/jarvis/teaching-learning.ts';

const profile: DeviceProfile = {deviceId:'android-a',platform:'android',model:'test',osVersion:'8',app:'settings',appVersion:'1'};
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'jarvis-learning-'));
 const file=join(root,'teaching.json'); const store=new TeachingStore(file);
 const v=store.start({goal:'Navigate home',scope:'device',profile,sessionId:'session'});
 store.append(v.id,{action:{kind:'key',key:'HOME'},before:'before',after:'after',gate:false});
 store.finish(v.id,'home visible','after');
 return {root,file,store,id:v.id};
}
async function verify(store:TeachingStore,id:string,device=profile,fail=false) {
 let screen='before';
 return replayTeaching(store,id,{authorize(){},async observe(){return {signature:screen,profile:device,targets:[],protectedScreen:false};},async execute(){if(fail)throw Error('simulated disconnect');screen='after';}},'verify');
}

test('learning endpoint denies unauthenticated reads before opening the store',async()=>{
 let reads=0;
 const r=await teachingLibraryResponse(async()=>false,()=>{reads++;throw Error('must not read');});
 assert.equal(r.status,401);assert.equal(reads,0);
 assert.equal(r.headers.get('cache-control'),'no-store');
});

test('real durable observations generate bounded non-executable candidates and survive restart',async()=>{
 const f=fixture();try{
 const before=readFileSync(f.file,'utf8');
 const r=await teachingLibraryResponse(async()=>true,()=>f.store);const b=await r.json();
 assert.equal(r.status,200);assert.equal(b.learningCandidates.length,1);
 const c=b.learningCandidates[0];assert.equal(c.state,'OBSERVED');assert.equal(c.executable,false);
 assert.equal(c.variantId,f.id);assert.equal(c.workflow.steps.length,1);
 assert.equal(c.correctionState,'UNKNOWN');assert.equal(c.verifiedRunIds.length,0);
 assert.equal(readFileSync(f.file,'utf8'),before);
 const restored=await (await teachingLibraryResponse(async()=>true,()=>new TeachingStore(f.file))).json();
 assert.deepEqual(restored.learningCandidates,b.learningCandidates);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('validation requires independent same-profile runs and never grants automatic execution',async()=>{
 const f=fixture();try{
 for(let i=0;i<3;i++)assert.equal((await verify(f.store,f.id)).status,'PASSED');
 let b=await (await teachingLibraryResponse(async()=>true,()=>f.store)).json();
 assert.equal(b.learningCandidates[0].state,'VALIDATED');
 assert.equal(b.learningCandidates[0].verifiedRunIds.length,3);
 assert.equal(b.learningCandidates[0].executable,false);
 await verify(f.store,f.id,profile,true);
 b=await (await teachingLibraryResponse(async()=>true,()=>f.store)).json();
 assert.equal(b.learningCandidates[0].state,'NEEDS_VALIDATION');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('manual/gated instructions cannot become inferred executable rules or disclose raw notes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jarvis-learning-manual-'));try{
 const store=new TeachingStore(join(root,'store.json'));
 store.manual({goal:'Example',scope:'device',profile,instructions:'private-note-123',completion:'done'});
 const b=await (await teachingLibraryResponse(async()=>true,()=>store)).json();
 assert.equal(b.learningCandidates[0].state,'NEEDS_VALIDATION');
 assert.equal(b.learningCandidates[0].workflow.steps.length,0);
 assert.ok(!JSON.stringify(b.learningCandidates).includes('private-note-123'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('store errors fail visibly without leaking filesystem or secret details',async()=>{
 const r=await teachingLibraryResponse(async()=>true,()=>{throw Error('secret path');});
 assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret path'));
});
import { teachingLearningCandidate } from '../src/jarvis/teaching-learning.ts';
import { profileKey } from '../src/jarvis/teaching.ts';

test('other devices/profiles/variants and repeated run IDs cannot certify a candidate',()=>{
 const f=fixture();try{
 const v=f.store.get(f.id);v.status='VERIFIED';v.verifiedRunId='r0';
 const make=(id:string)=>({id,variantId:f.id,deviceId:profile.deviceId,profileKey:profileKey(profile),mode:'verify' as const,status:'PASSED' as const,nextStep:1,startedAt:'2026-01-01',finishedAt:'2026-01-02'});
 const base=[make('r0'),make('r1'),make('r2')];
 for(const rows of [base.map(r=>({...r,deviceId:'other'})),base.map(r=>({...r,profileKey:'other'})),base.map(r=>({...r,variantId:'other'})),base.map(r=>({...r,id:'r0'})),base.map(r=>({...r,mode:'execute' as const})),base.map(r=>({...r,nextStep:0})),base.map(r=>({...r,pendingStep:0}))]){
  assert.notEqual(teachingLearningCandidate(v,rows).state,'VALIDATED');
 }
 v.steps[0].gate=true;assert.equal(teachingLearningCandidate(v,base).state,'NEEDS_VALIDATION');
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('actual route uses authenticated projection and candidate view does not offer replay',()=>{
 const route=readFileSync(new URL('../src/app/api/jarvis/teaching/route.ts',import.meta.url),'utf8');
 assert.match(route,/GET\(\)\{return teachingLibraryResponse\(requireJarvisOwner,teachingStore,/);
 const ui=readFileSync(new URL('../src/app/jarvis/teach/page.tsx',import.meta.url),'utf8');
 assert.match(ui,/setCandidates\(b.learningCandidates\|\|\[\]\)/);
 assert.match(ui,/候補は自動実行の許可ではありません/);
});
