
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { acquireCognitiveLease } from "../src/gai/cognitive-lease.ts";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { LocalFileCapability } from "../src/orchestrator/local-file-capability.ts";
import { CognitiveLocalWorkCatalog } from "../src/gai/cognitive-local-work.ts";

test("identified lock survives live contention and is reclaimed after its actual process exits", async () => {
 const root=await mkdtemp(join(tmpdir(),"goriq-lease-recovery-"));
 try {
  const path=join(root,"lock"), mod=new URL("../src/gai/cognitive-lease.ts",import.meta.url).href;
  const child=spawn(process.execPath,["--input-type=module","-e",`import {acquireCognitiveLease} from ${JSON.stringify(mod)}; await acquireCognitiveLease(${JSON.stringify(path)});`],{stdio:"pipe"});
  const [exit]=await once(child,"exit"); assert.equal(exit,0);
  const old=JSON.parse(await readFile(path,"utf8"));assert.equal(old.host,hostname());
  const release=await acquireCognitiveLease(path);assert.notEqual(JSON.parse(await readFile(path,"utf8")).nonce,old.nonce);
  await assert.rejects(acquireCognitiveLease(path),/EEXIST/);
  await release();
  for(const value of ["unknown-writer",JSON.stringify({version:1,host:"other-host",pid:process.pid,nonce:randomUUID()})]){
   await writeFile(path,value);
   await assert.rejects(acquireCognitiveLease(path),/EEXIST/);assert.equal(await readFile(path,"utf8"),value);
   await rm(path);
  }
 } finally { await rm(root,{recursive:true,force:true}); }
});
test("authority write failure recovers an independently verified file without repeating create",async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-authority-recovery-"));
 const originalPut=CompassWorkStateStoreAdapter.prototype.put,originalCreate=LocalFileCapability.prototype.createBytes;
 try {
  const dbPath=join(root,"compass.db"),stateRoot=join(root,"state"),dataRoot=join(root,"data"),manifestPath=join(root,"plan.json");
  await mkdir(dataRoot);
  const db=new CompassStore(dbPath);const record=db.setGoal({title:"Persist local result through authority recovery",successCriteria:["File contains 42"]});db.close();
  const goalId=goalWorkStateId(compassGoalToLoopGoal(record));
  await writeFile(manifestPath,JSON.stringify({version:1,goalId,steps:[{id:"save",operation:"create",path:"result.txt",text:"42",expectedSha256:createHash("sha256").update("42").digest("hex"),criteria:["criterion-1"]}]}));
  let creates=0,failed=false;
  LocalFileCapability.prototype.createBytes=async function(...args){creates++;return originalCreate.apply(this,args);};
  CompassWorkStateStoreAdapter.prototype.put=async function(state){if(!failed&&state.verificationResults.length){failed=true;throw Error("injected authority storage failure");}return originalPut.call(this,state);};
  const service=new CognitiveService(dbPath,{stateRoot,localWork:{manifestPath,dataRoot}});
  await assert.rejects(service.continue(goalId),/injected authority/);
  const store=new CognitiveStateStore(stateRoot,{tenantId:"local",principalId:"owner"});
  const before=await store.get(goalId);assert.ok(before?.pending_action);assert.equal(before?.attempts.length,0);
  assert.equal(await readFile(join(dataRoot,"result.txt"),"utf8"),"42");
  CompassWorkStateStoreAdapter.prototype.put=originalPut;
  const resumed=await service.continue(goalId);
  assert.equal(resumed.stopReason,"goal_complete");assert.equal(resumed.goalEvaluation?.achieved,true);assert.equal(creates,1);
  const after=await store.get(goalId);assert.equal(after?.pending_action,null);assert.equal(after?.attempts.length,1);
  const reopened=new CompassStore(dbPath);try{
   const work=await new CompassWorkStateStoreAdapter(reopened).get(goalId);
   assert.ok(work?.childWorkItems.length);assert.ok(work?.childWorkItems.every(c=>c.status==="COMPLETED"));
  }finally{reopened.close();}
 }finally{CompassWorkStateStoreAdapter.prototype.put=originalPut;LocalFileCapability.prototype.createBytes=originalCreate;await rm(root,{recursive:true,force:true});}
});
test("Windows cross-volume and UNC paths fail before any I/O", {skip:process.platform!=="win32"}, async()=>{
 const root=resolve(tmpdir(),"goriq-path-boundary");
 const goal={title:"safe file",successCriteria:["42"],constraints:[]};
 for(const path of ["D:\\outside.txt","\\\\outside-host\\share\\result.txt"]){
  assert.throws(()=>new CognitiveLocalWorkCatalog(root,{version:1,goalId:"g",steps:[{id:"read",operation:"read",path,expectedSha256:"a".repeat(64),criteria:["criterion-1"]}]},"g",goal),/scope/);
  await assert.rejects(new LocalFileCapability(root).readBytes(path),/escapes/);
 }
});


test("crash while holding native recovery arbiter does not leave an anonymous reclamation lock",async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-arbiter-crash-"));
 try{
  const path=join(root,"lock");
  const script=`import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs'; const db=new DatabaseSync(${JSON.stringify(path)}+'.arbiter.sqlite');db.exec('BEGIN EXCLUSIVE');writeFileSync(${JSON.stringify(path)}+'.abandoned.tmp','');process.exit(0);`;
  const child=spawn(process.execPath,["--input-type=module","-e",script],{stdio:"pipe"});const[exit]=await once(child,"exit");assert.equal(exit,0);
  const release=await acquireCognitiveLease(path);await release();
 }finally{await rm(root,{recursive:true,force:true});}
});

test("unfinished child cannot persist Goal completion or completed learning metrics",async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-child-gate-"));
 try{
  const dbPath=join(root,"compass.db"),stateRoot=join(root,"state"),dataRoot=join(root,"data"),manifestPath=join(root,"plan.json");await mkdir(dataRoot);
  const db=new CompassStore(dbPath);const record=db.setGoal({title:"Finish all child work",successCriteria:["File contains 42"]});db.close();
  const goalId=goalWorkStateId(compassGoalToLoopGoal(record));
  await writeFile(manifestPath,JSON.stringify({version:1,goalId,steps:[{id:"save",operation:"create",path:"result.txt",text:"42",expectedSha256:createHash("sha256").update("42").digest("hex"),criteria:["criterion-1"]}]}));
  const {CompassGoalExecutionAdapter}=await import("../src/orchestrator/compass-goal-execution-adapter.ts");
  const options={useCore:true,stateRoot,localWork:{manifestPath,dataRoot}};
  await new CompassGoalExecutionAdapter(dbPath,{},options).run(goalId,{maxCycles:1});
  const opened=new CompassStore(dbPath);try{
   const store=new CompassWorkStateStoreAdapter(opened);const work=await store.get(goalId);assert.ok(work);
   work.childWorkItems.push({id:"unrelated-pending",objective:"remaining requirement",definitionOfDone:[],affectedScope:["local"],executionApproach:"review",verificationMethod:"readback",status:"IN_PROGRESS"});await store.put(work);
  }finally{opened.close();}
  const service=new CognitiveService(dbPath,options);const report=await service.continue(goalId);
  assert.notEqual(report.stopReason,"goal_complete");assert.equal(report.goalEvaluation?.achieved,false);
  const verify=new CompassStore(dbPath);try{assert.notEqual(verify.getState().status,"goal_complete");}finally{verify.close();}
  assert.equal((await service.status()).metrics.completedGoals,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("concurrent local file creations cannot overwrite the winning content",async()=>{
 const root=await mkdtemp(join(tmpdir(),"goriq-create-race-"));
 try{
  const file=new LocalFileCapability(root);
  const results=await Promise.all(Array.from({length:16},(_,i)=>file.createBytes("result.txt",Buffer.from(String(i)))));
  assert.equal(results.filter(r=>r.status==="created").length,1);assert.equal(results.filter(r=>r.status==="blocked").length,15);
  const index=results.findIndex(r=>r.status==="created");assert.equal(await readFile(join(root,"result.txt"),"utf8"),String(index));
 }finally{await rm(root,{recursive:true,force:true});}
});
