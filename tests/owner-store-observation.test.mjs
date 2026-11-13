import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { collectOwnerStoreEvidence, attachOwnerStoreEvidence } from '../scripts/goriq-owner-store-observation.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const goalText = {title:'PRIVATE GOAL DO NOT EXPORT', description:'PRIVATE DESCRIPTION'};
const goalId = 'goal-' + hash(JSON.stringify(goalText)).slice(0,16);
const jobId = 'job-selected-1';
const selection = {goalId,jobId};
const denied = {status:'HOLD',reason:'GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND',brokerAuthenticated:true,
  readFailure:{kind:'HTTP',httpStatus:404},writeAuthorized:false,mergeAuthorized:false};
function fixture(t, options = {}) {
  const home = mkdtempSync(join(tmpdir(),'goriq-store-observe-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const cwd=join(home,'runtime'); mkdirSync(join(cwd,'scripts'),{recursive:true});
  const source=join(cwd,'scripts','jarvis-broker.ts');
  writeFileSync(source,'// source fixture\n');
  const store=join(home,'canonical'); mkdirSync(store);
  const dbPath=join(store,'compass.db');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE goal(id INTEGER,title TEXT,description TEXT);CREATE TABLE state(project_id TEXT,active TEXT,status TEXT);');
  if(options.goal!==false)db.prepare('INSERT INTO goal VALUES(1,?,?)').run(goalText.title,goalText.description);
  const runs=options.runs??[{goalId,phase:'VERIFYING',privatePayload:'DO NOT EXPORT'}];
  const active=[{kind:'jarvis-work-runs',version:1,runs}];
  db.prepare('INSERT INTO state VALUES(?,?,?)').run('default',JSON.stringify(active),options.state??'PAUSED');db.close();
  mkdirSync(join(store,'self-development'));
  const jobs=join(store,'self-development','jobs.json');
  writeFileSync(jobs,JSON.stringify({version:1,jobs:[{goalId,jobId,phase:'VERIFYING',privateSecret:'DO NOT EXPORT'}]}));
  const before=hash(readFileSync(dbPath));let listCalls=0;
  const calls=[];
  const runCommand=(file,args)=>{
    calls.push([file,...args]);
    assert.ok(!args.some(x=>String(x).includes('PRIVATE')));
    if(file==='/usr/sbin/lsof'){
      if(args.includes('-iTCP:8787')){listCalls++;return options.listenerChanged&&listCalls>1?'p999\nn127.0.0.1:8787\n':'p321\nn127.0.0.1:8787\n';}
      if(args.includes('cwd'))return 'p321\nn'+cwd+'\n';
      return 'p321\nn'+dbPath+'\n'+(options.duplicate?'n'+source+'\n':'');
    }
    if(file==='/bin/ps'){
      if(args.includes('uid='))return String(options.foreign?userInfo().uid+1:userInfo().uid);
      if(args.includes('lstart='))return 'FIXED_START';
      if(args.includes('args='))return '/usr/local/bin/node scripts/jarvis-broker.ts';
    }
    if(file==='/usr/bin/git')return 'a'.repeat(40);
    throw Error('UNEXPECTED COMMAND');
  };
  return {home,cwd,source,dbPath,jobs,before,calls,
    inspectOptions:{platform:'darwin',home,ownerUid:userInfo().uid,runCommand,
      referenceBrokerPath:source,config:{JARVIS_COMPASS_DB_PATH:dbPath}}};
}

test('only authenticated selected Goal HTTP404 activates inspection',async()=>{
  let calls=0;const output=await attachOwnerStoreEvidence(denied,{...selection,mode:'broker'},async()=>{calls++;return {status:'OBSERVED',executionAuthorized:false};});
  assert.equal(calls,1);assert.equal(output.status,'HOLD');assert.equal(output.sourceObservation.status,'OBSERVED');
  assert.equal(output.writeAuthorized,false);assert.equal(output.mergeAuthorized,false);
  assert.equal(denied.sourceObservation,undefined);
});
for(const [name,result,request] of [
  ['no authenticated owner',{...denied,brokerAuthenticated:false},{...selection,mode:'broker'}],
  ['unselected generic check',denied,{mode:'broker'}],
  ['success',{...denied,status:'BROKER_AUTHENTICATED_READONLY'},{...selection,mode:'broker'}],
  ['wrong endpoint failure',{...denied,reason:'OWNER_AUTHENTICATION_NOT_VERIFIED'},{...selection,mode:'broker'}],
  ['non404',{...denied,readFailure:{kind:'HTTP',httpStatus:503}},{...selection,mode:'broker'}],
  ['builder-only',denied,{...selection,mode:'builder'}],
])test('no disk inspection for '+name,async()=>{
  assert.deepEqual(await attachOwnerStoreEvidence(result,request,async()=>assert.fail('not authorized')),result);
});
test('inspection exceptions never publish arbitrary exception data',async()=>{
  const r=await attachOwnerStoreEvidence(denied,{...selection,mode:'broker'},async()=>{throw Error('SECRET_TOKEN');});
  assert.equal(r.status,'HOLD');assert.equal(r.sourceObservation.status,'INSPECTION_UNAVAILABLE');
  assert.ok(!JSON.stringify(r).includes('SECRET_TOKEN'));
});
test('live-listener-bound source and real SQLite selected records are projected without writes',async t=>{
  const f=fixture(t),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.status,'NATIVE_OBSERVATION_ONLY');assert.equal(r.loadedSourceVerified,false);
  assert.equal(r.entryFileMatchesCheckout,true);assert.equal(r.configuredCompassOpenByListener,true);
  assert.equal(r.openCompassObservation.currentGoalPresent,true);
  assert.equal(r.openCompassObservation.selectedGoalMatchesCurrent,true);
  assert.equal(r.openCompassObservation.selectedWorkRunCount,1);
  assert.equal(r.openCompassObservation.stopStatus,'PAUSED');
  assert.equal(r.derivedJobObservation.selectedJobMatchCount,1);
  assert.equal(r.executionAuthorized,false);assert.equal(hash(readFileSync(f.dbPath)),f.before);
  for(const secret of [f.home,'PRIVATE GOAL','PRIVATE DESCRIPTION','DO NOT EXPORT'])assert.ok(!JSON.stringify(r).includes(secret));
});
test('existing different Goal is not silently substituted or claimed missing',async t=>{
  const f=fixture(t),r=await collectOwnerStoreEvidence({goalId:'goal-other-id',jobId},f.inspectOptions);
  assert.equal(r.openCompassObservation.currentGoalPresent,true);
  assert.equal(r.openCompassObservation.selectedGoalMatchesCurrent,false);
  assert.equal(r.openCompassObservation.selectedWorkRunCount,0);
  assert.equal(r.derivedJobObservation.selectedJobMatchCount,0);
  assert.equal(hash(readFileSync(f.dbPath)),f.before);
});
test('missing selected WorkRun remains distinct from a missing Goal',async t=>{
  const f=fixture(t,{runs:[]}),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.openCompassObservation.selectedGoalMatchesCurrent,true);
  assert.equal(r.openCompassObservation.selectedWorkRunCount,0);
});
test('no Goal row is reported without inventing owner state',async t=>{
  const f=fixture(t,{goal:false}),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.openCompassObservation.currentGoalPresent,false);
  assert.equal(r.openCompassObservation.selectedGoalMatchesCurrent,null);
});
test('foreign listener is rejected before any source or DB inspection',async t=>{
  const f=fixture(t,{foreign:true}),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.status,'LISTENER_OWNER_NOT_CONFIRMED');assert.equal(r.openCompassObservation,undefined);
  assert.equal(f.calls.length,2);
});
test('changed listener invalidates native observation rather than accepting it',async t=>{
  const f=fixture(t,{listenerChanged:true}),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.status,'PROCESS_CHANGED_OBSERVATIONS_NOT_BOUND');assert.equal(r.executionAuthorized,false);
});
test('unsupported host is an explicit non-execution, not a request for a Mac',async()=>{
  const r=await collectOwnerStoreEvidence(selection,{platform:'linux',runCommand:()=>assert.fail('must not run')});
  assert.equal(r.status,'NATIVE_INSPECTION_NOT_SUPPORTED');assert.equal(r.executionAuthorized,false);
});
for(const value of ['../goal','abc\nsecret','',null])test('invalid selectors prevent all native operations: '+JSON.stringify(value),async()=>{
  const r=await collectOwnerStoreEvidence({goalId:value,jobId},{platform:'darwin',runCommand:()=>assert.fail('must not run')});
  assert.equal(r.status,'SELECTION_INVALID');assert.equal(r.executionAuthorized,false);
});
test('wrong configured path cannot be claimed as the actual open Compass',async t=>{
  const f=fixture(t);f.inspectOptions.config.JARVIS_COMPASS_DB_PATH=join(f.home,'missing.sqlite');
  const r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.notEqual(r.configuredCompassOpenByListener,true);
  assert.equal(r.openCompassObservation.selectedWorkRunCount,1);
});

test('existing probe CLI actually invokes observation after authenticated targeted404 and retains exit2',async t=>{
  const {spawnSync}=await import('node:child_process');
  const {pathToFileURL,fileURLToPath}=await import('node:url');
  const root=mkdtempSync(join(tmpdir(),'goriq-probe-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const preload=join(root,'fixture.mjs');
  writeFileSync(preload,`Object.defineProperty(process,'platform',{value:'linux'});let calls=0;globalThis.fetch=async(url,init)=>{if(init.method!=='GET'||!String(url).startsWith('http://127.0.0.1:8787/'))throw Error('unexpected');calls++;return calls===1?Response.json({ok:true,service:'jarvis-broker'}):calls===2?Response.json({events:[]}):Response.json({message:'Work Runがありません'},{status:404});};`);
  const probe=fileURLToPath(new URL('../scripts/goriq-ai09-live-broker-builder-probe.mjs',import.meta.url));
  const child=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,probe],{encoding:'utf8',timeout:5000,
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,JARVIS_OWNER_TOKEN:'fixture-only-not-real',GORIQ_AI09_CONNECT_MODE:'broker',GORIQ_AI09_GOAL_ID:goalId,GORIQ_AI09_JOB_ID:jobId}});
  assert.equal(child.status,2,child.stderr);
  const line=child.stdout.trim();assert.ok(line.startsWith('AI09_LIVE_CONNECTION='));
  const result=JSON.parse(line.slice('AI09_LIVE_CONNECTION='.length));
  assert.equal(result.sourceObservation?.status,'NATIVE_INSPECTION_NOT_SUPPORTED');
  assert.equal(result.status,'HOLD');assert.equal(result.writeAuthorized,false);
  assert.ok(!child.stdout.includes('fixture-only-not-real'));
});

test('different on-disk source is recorded as mismatch, never loaded-code proof',async t=>{
  const f=fixture(t),ref=join(f.home,'reference.ts');writeFileSync(ref,'// other checked source\n');
  const r=await collectOwnerStoreEvidence(selection,{...f.inspectOptions,referenceBrokerPath:ref});
  assert.equal(r.entryFileMatchesCheckout,false);assert.equal(r.loadedSourceVerified,false);
});
test('malformed stored active state is inconclusive, never an empty replacement',async t=>{
  const f=fixture(t),db=new DatabaseSync(f.dbPath);db.prepare("UPDATE state SET active=?").run('{not-json');db.close();
  const before=hash(readFileSync(f.dbPath)),r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.openCompassObservation.status,'READONLY_DB_INSPECTION_UNAVAILABLE');assert.equal(hash(readFileSync(f.dbPath)),before);
});
test('duplicate selected WorkRuns are counted and not treated as a unique match',async t=>{
  const f=fixture(t,{runs:[{goalId,phase:'RUNNING'},{goalId,phase:'VERIFYING'}]});
  const r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.openCompassObservation.selectedWorkRunCount,2);assert.equal(r.openCompassObservation.selectedWorkRunPhase,null);
});
test('missing Job file is reported without creating one or discarding the source observation',async t=>{
  const f=fixture(t);rmSync(f.jobs);
  const r=await collectOwnerStoreEvidence(selection,f.inspectOptions);
  assert.equal(r.derivedJobObservation.status,'DERIVED_JOB_FILE_NOT_CONFIRMED');
  assert.equal(r.openCompassObservation.selectedWorkRunCount,1);
});
