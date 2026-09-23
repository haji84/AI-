import {Buffer} from "node:buffer";
import {URL} from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CompassStore} from '../src/compass/store.ts';
import {OwnerRequirementIntake} from '../src/orchestrator/owner-requirement-intake.ts';
import {loadCanonicalBundle} from '../scripts/jarvis-owner-spec-sync.mjs';
import {requirementFingerprint} from '../scripts/jarvis-requirement-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('typed specification publisher exists and requires connected GitHub authorization before network',async()=>{
 const url=new URL('../scripts/jarvis-spec-publisher.mjs',import.meta.url);
 assert.ok(existsSync(url),'bounded specification publisher missing');
 const {createSpecificationPublisher}=await import(url.href);
 const db=new CompassStore(':memory:');try{
  const intake=new OwnerRequirementIntake(db),bundle=loadCanonicalBundle(root);
  const record=intake.capture(intake.prepare('request','publisher-test',{decision:'accept',statement:'同期結果を表示する',canonicalIds:['CORE-015']}),'goal',bundle.matrix.requirements);
  const review={sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[{id:'CORE-015',baseFingerprint:requirementFingerprint(bundle.matrix.requirements.find(r=>r.id==='CORE-015'))}]};
  let calls=0;
  const publisher=createSpecificationPublisher({root,intake,token:'',fetchImpl:async()=>{calls++;throw Error('must not call');}});
  await assert.rejects(()=>publisher.publish(record.id,review),/github_write_unavailable/);
  assert.equal(calls,0);assert.equal(intake.list()[0].state,'ACCEPTED_REQUIREMENT');
 }finally{db.close();}
});

function fixture(options={}) {
 const db=new CompassStore(options.dbPath??':memory:'), intake=new OwnerRequirementIntake(db), bundle=loadCanonicalBundle(root);
 const record=intake.capture(intake.prepare('request','publisher-test',{decision:'accept',statement:options.statement??'同期結果を表示する',canonicalIds:['CORE-015']}),'goal',bundle.matrix.requirements);
 const review={sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[{id:'CORE-015',baseFingerprint:requirementFingerprint(bundle.matrix.requirements.find(r=>r.id==='CORE-015'))}]};
 const main='a'.repeat(40),tree='b'.repeat(40),commit='c'.repeat(40),branch='codex/spec-sync/'+record.id;
 const originals=[bundle.ledger,JSON.stringify(bundle.matrix,null,2)+'\n',JSON.stringify(bundle.decisions,null,2)+'\n',JSON.stringify(bundle.inventory,null,2)+'\n'];
 const paths=['docs/JARVIS_PRODUCT_SPEC.md','docs/jarvis-requirements.json','docs/jarvis-owner-decisions.json','docs/jarvis-additional-requirements.json'];
 const state={calls:[],ref:null,pr:null,posts:0,tree:null,main};
 const json=(v,status=200)=>new globalThis.Response(JSON.stringify(v),{status});
 const fetchImpl=async(url,init={})=>{
  assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer fixture-only');
  const p=new URL(url).pathname.replace('/repos/haji84/AI-',''),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;
  state.calls.push({p,method,body});
  if(options.hook){const r=await options.hook({p,method,body,state,intake,record,json});if(r)return r;}
  if(p==='/issues/1205')return json({number:1205,state:'open',user:{login:'haji84'}});
  if(p==='/git/ref/heads/main')return json({object:{sha:state.main}});
  if(p==='/git/commits/'+main||p==='/git/commits/'+state.main)return json({tree:{sha:tree}});
  if(p.startsWith('/contents/')) {const i=paths.indexOf(p.slice('/contents/'.length));assert.ok(i>=0);assert.ok([main,state.main].includes(new URL(url).searchParams.get('ref')));return json({type:'file',encoding:'base64',content:Buffer.from(originals[i]).toString('base64')});}
  if(p==='/git/trees'&&method==='POST'){state.tree=body;assert.equal(body.base_tree,tree);assert.deepEqual(body.tree.map(x=>x.path),paths);return json({sha:'d'.repeat(40)},201);}
  if(p==='/git/commits'&&method==='POST'){assert.deepEqual(body.parents,[main]);return json({sha:commit},201);}
  if(p==='/git/ref/heads/'+branch)return state.ref?json({object:{sha:state.ref}}):json({},404);
  if(p==='/git/refs'&&method==='POST'){assert.equal(body.ref,'refs/heads/'+branch);state.ref=body.sha;return json({ref:body.ref,object:{sha:body.sha}},201);}
  if(p==='/pulls'&&method==='GET')return json(state.pr?[state.pr]:[]);
  if(p==='/pulls'&&method==='POST'){
   assert.equal(body.draft,true);assert.equal(body.base,'main');assert.equal(body.head,branch);state.posts++;
   state.pr={number:12345,html_url:'https://github.com/haji84/AI-/pull/12345',draft:true,state:'open',head:{sha:commit,ref:branch,repo:{full_name:'haji84/AI-'}},base:{ref:'main',repo:{full_name:'haji84/AI-'}}};
   if(options.losePostResponse){options.losePostResponse=false;throw Error('lost response');}
   return json(state.pr,201);
  }
  throw Error('unexpected request: '+method+' '+p);
 };
 return {db,intake,record,review,state,fetchImpl};
}
test('creates only a draft with exact four-file tree; restart resumes lost PR response',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'spec-publish-')),dbPath=join(dir,'compass.sqlite');
 const f=fixture({dbPath,losePostResponse:true});
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 try {
  await assert.rejects(()=>createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,f.review),/github_transport_failure/);
  assert.equal(f.state.posts,1);assert.equal(f.intake.list()[0].state,'ACCEPTED_REQUIREMENT');f.db.close();
  const db=new CompassStore(dbPath);try {
   const intake=new OwnerRequirementIntake(db);
   const result=await createSpecificationPublisher({root,intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,f.review);
   assert.equal(result.status,'DRAFT_OPEN');assert.equal(result.canonicalSynced,false);assert.equal(f.state.posts,1);
   assert.equal(intake.list()[0].publication.prNumber,12345);
   assert.equal(intake.list()[0].state,'ACCEPTED_REQUIREMENT');
   assert.ok(f.state.calls.every(c=>c.method!=='PATCH'&&c.method!=='DELETE'));
  }finally{db.close();}
 }finally{try{f.db.close();}catch{ /* restart test may already close this handle */ }rmSync(dir,{recursive:true,force:true});}
});
test('rejects untrusted fields before network and stale remote canonical base before writes',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const f=fixture({hook:({p,json})=>p.startsWith('/contents/')?json({type:'file',encoding:'base64',content:Buffer.from('changed').toString('base64')}):null});
 try{
  const pub=createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl});
  await assert.rejects(()=>pub.publish(f.record.id,{...f.review,files:[]}),/invalid_specification_review/);
  assert.equal(f.state.calls.length,0);
  await assert.rejects(()=>pub.publish(f.record.id,f.review),/canonical_base_conflict/);
  assert.equal(f.state.calls.filter(c=>c.method==='POST').length,0);
 }finally{f.db.close();}
});
test('foreign branch cannot be overwritten and superseded receipt cannot continue publication',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 for(const mode of ['branch','superseded']){
  const f=fixture({hook:({p,method,intake,record,json})=>{
   if(mode==='branch'&&p.startsWith('/git/ref/heads/codex/'))return json({object:{sha:'e'.repeat(40)}});
   if(mode==='superseded'&&method==='POST'&&p==='/git/trees'){
    intake.capture(intake.prepare('correct','correct',{decision:'accept',statement:'訂正',canonicalIds:['CORE-015'],supersedes:record.id}),'goal',loadCanonicalBundle(root).matrix.requirements);
    return json({sha:'d'.repeat(40)},201);
   }
  }});
  try{
   await assert.rejects(()=>createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,f.review),mode==='branch'?/publication_branch_conflict/:/receipt_changed/);
   assert.equal(f.state.posts,0);assert.equal(f.state.ref,null);
  }finally{f.db.close();}
 }
});
test('response bytes, timeout and redirect failures are bounded without response/credential disclosure',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 for(const mode of ['oversized','timeout','redirect']){
  const f=fixture();
  try{
   const fetchImpl=mode==='oversized'?async()=>new globalThis.Response('x'.repeat(2097153)):mode==='redirect'?async()=>new globalThis.Response('sensitive response',{status:302}):async(_url,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('sensitive response')),{once:true}));
   const pub=createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl,timeoutMs:20});
   await assert.rejects(()=>pub.publish(f.record.id,f.review),e=>/github_(response_limit|transport_failure|status_302)/.test(e.message)&&!e.message.includes('sensitive')&&!e.message.includes('fixture-only'));
   assert.equal(f.intake.list()[0].publication,undefined);
  }finally{f.db.close();}
 }
});

test('saved plans cannot be retargeted, generic writes preserve publication, and secrets never leave',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const f=fixture();try{
  await createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,f.review);
  const saved=f.intake.list()[0].publication;
  f.db.updateState({active:[]});assert.deepEqual(f.intake.list()[0].publication,saved);
  const before=f.state.calls.length;
  const changed={...f.review,bindings:[{id:'GOV-025',baseFingerprint:requirementFingerprint(loadCanonicalBundle(root).matrix.requirements.find(r=>r.id==='GOV-025'))}]};
  await assert.rejects(()=>createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,changed),/publication_plan_conflict/);
  assert.equal(f.state.calls.slice(before).filter(c=>c.method==='POST').length,0);
 }finally{f.db.close();}
 const secret=fixture({statement:'example credential: '+'ghp_'+'a'.repeat(40)});try{
  await assert.rejects(()=>createSpecificationPublisher({root,intake:secret.intake,token:'fixture-only',fetchImpl:secret.fetchImpl}).publish(secret.record.id,secret.review),/specification_secret_detected/);
  assert.equal(secret.state.calls.length,0);
 }finally{secret.db.close();}
});
test('stream stall is cancelled by deadline and closed or altered PR cannot be reported ready',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const stalled=fixture();try{
  const fetchImpl=async()=>new globalThis.Response(new globalThis.ReadableStream({start(c){c.enqueue(new globalThis.TextEncoder().encode('{'));}}));
  await assert.rejects(()=>createSpecificationPublisher({root,intake:stalled.intake,token:'fixture-only',fetchImpl,timeoutMs:25}).publish(stalled.record.id,stalled.review),/github_transport_failure/);
 }finally{stalled.db.close();}
 const f=fixture();try{
  const publisher=createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl});
  await publisher.publish(f.record.id,f.review);f.state.pr.state='closed';
  await assert.rejects(()=>publisher.publish(f.record.id,f.review),/publication_pr_conflict/);assert.equal(f.state.posts,1);
 }finally{f.db.close();}
});

test('lost response resumes the original draft after unrelated main advance',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const f=fixture({losePostResponse:true});try{
  const publisher=createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl});
  await assert.rejects(()=>publisher.publish(f.record.id,f.review),/github_transport_failure/);
  f.state.main='f'.repeat(40);
  const result=await publisher.publish(f.record.id,f.review);
  assert.equal(result.number,12345);assert.equal(f.state.posts,1);
  assert.equal(f.intake.list()[0].publication.baseSha,'a'.repeat(40));
 }finally{f.db.close();}
});
test('fine-grained credential pattern is stopped before GitHub reads or writes',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const f=fixture({statement:'Credential: '+'github_pat_'+'a'.repeat(82)});try{
  await assert.rejects(()=>createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,f.review),/specification_secret_detected/);
  assert.equal(f.state.calls.length,0);
 }finally{f.db.close();}
});

test('publisher serializes new allocation with its adopted source, while keeping evidence pending',async()=>{
 const {createSpecificationPublisher}=await import('../scripts/jarvis-spec-publisher.mjs');
 const {prepareOwnerPreview}=await import('../scripts/jarvis-requirement-workflow.mjs');
 const f=fixture({statement:'郵便を分類する一覧機能を追加して'});try{
  const preview=prepareOwnerPreview(f.record,loadCanonicalBundle(root),{mode:'new'},root,f.intake.list());
  const review={...preview.review,sourceRef:f.review.sourceRef};
  await createSpecificationPublisher({root,intake:f.intake,token:'fixture-only',fetchImpl:f.fetchImpl}).publish(f.record.id,review);
  const content=p=>JSON.parse(f.state.tree.tree.find(v=>v.path===p).content);
  const row=content('docs/jarvis-requirements.json').requirements.at(-1);
  assert.equal(row.id,'OWN-001');assert.equal(row.status,'MISSING');
  assert.equal(content('docs/jarvis-additional-requirements.json').allocations[0].decision_id,f.record.id);
  assert.equal(content('docs/jarvis-owner-decisions.json').decisions.at(-1).canonical[0].id,'OWN-001');
  assert.equal(f.intake.list()[0].state,'ACCEPTED_REQUIREMENT');
 }finally{f.db.close();}
});
