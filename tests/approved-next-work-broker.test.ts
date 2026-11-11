import assert from "node:assert/strict";
import test, { describe, type TestContext } from "node:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

const repositoryRoot=fileURLToPath(new URL("../",import.meta.url));
const evidenceMarker="explicit-predecessor-fixture-only-not-real-product-evidence";
const records=(active:unknown[],kind:string)=>active.filter((x):x is Record<string,unknown>=>!!x&&typeof x==="object"&&(x as {kind?:unknown}).kind===kind);
async function fixture(t:TestContext){
  const root=mkdtempSync(join(tmpdir(),"approved-next-http-")),compassPath=join(root,"compass.sqlite");mkdirSync(join(root,"state"));
  // Restricted verifier source snapshots intentionally have no .git. The
  // disposable Broker owns a real tiny repository instead of borrowing the
  // implementation checkout's metadata. Assertions below are unchanged.
  const executionRoot=join(root,"repository");mkdirSync(join(executionRoot,"src"),{recursive:true});
  writeFileSync(join(executionRoot,"src/owner-context.ts"),"export const fixture = true;\n");
  const git=(args:string[])=>execFileSync("git",args,{cwd:executionRoot,stdio:["ignore","pipe","pipe"],
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,NODE_ENV:"test",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null",GIT_TERMINAL_PROMPT:"0"}});
  git(["init","-q"]);git(["add","src/owner-context.ts"]);
  git(["-c","user.name=Next work fixture","-c","user.email=fixture@example.invalid","-c",`core.hooksPath=${process.platform==="win32"?"NUL":"/dev/null"}`,"commit","-qm","Controlled fixture baseline"]);
  const db=new CompassStore(compassPath);
  const predecessor=db.setGoal({title:"Issue1219 bounded prior fixture",description:"Issue1219 bounded prior fixture",successCriteria:["Explicit fixture criterion"],constraints:["No real credentials or product acceptance"]});
  const predecessorId=goalWorkStateId(compassGoalToLoopGoal(predecessor));
  const work:WorkState={goalId:predecessorId,objective:predecessor.description,definitionOfDone:[{id:"criterion-1",description:"Explicit fixture criterion",required:true}],
    currentState:"waiting for fixture verification",status:"VERIFYING",riskClass:"R1",constraints:["No real credentials or product acceptance"],decisions:[],artifacts:[],
    verificationResults:[],childWorkItems:[],blockers:[],nextAction:"fixture verification pending",updatedAt:new Date().toISOString()};
  await new CompassWorkStateStoreAdapter(db).put(work);
  // A Human Gate prevents startup from accidentally executing this test fixture
  // before the test explicitly commits its completion through the State adapter.
  await new CompassWorkRunStore(db).put({...createQueuedWorkRun(predecessorId),phase:"HUMAN_GATE"});
  db.updateState({status:"IN_PROGRESS",blockers:[]});db.close();
  const socket=createServer();socket.listen(0,"127.0.0.1");await once(socket,"listening");const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
  const url=`http://127.0.0.1:${port}/api/jarvis/admin`,owner="approved-next-http-test-owner";
  const headers={Authorization:`Bearer ${owner}`,"content-type":"application/json"};
  // This fixed public test token creates no real credential. No inherited
  // Builder/model/profile/authentication settings reach the disposable Broker.
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,
    NODE_ENV:"test",JARVIS_BROKER_HOST:"127.0.0.1",JARVIS_BROKER_PORT:String(port),JARVIS_OWNER_TOKEN:owner,JARVIS_DB_PATH:join(root,"broker.sqlite"),JARVIS_COMPASS_DB_PATH:compassPath,
    JARVIS_PUBLIC_BROKER_URL:"",JARVIS_WORKER_INSTALL_URL:"",JARVIS_WORKER_APK_PATH:"",XDG_STATE_HOME:join(root,"state")};
  let child:ChildProcess|undefined,diagnostics="";
  const stop=async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){
      const done=once(child,"exit");child.kill();
      let timeout:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([done,new Promise<void>(resolveStop=>{timeout=setTimeout(resolveStop,3000);})]);}
      finally{clearTimeout(timeout);}
      if(child.exitCode===null)child.kill("SIGKILL");
    }
    child=undefined;
  };
  t.after(async()=>{await stop();rmSync(root,{recursive:true,force:true});});
  const wait=async(label:string,check:()=>Promise<boolean>,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(child?.exitCode!==null&&child?.exitCode!==undefined)assert.fail(label+": "+diagnostics);if(await check())return;await delay(50);}assert.fail(label+": "+diagnostics);};
  const start=async()=>{child=spawn(process.execPath,[join(repositoryRoot,"scripts/jarvis-broker.ts")],{cwd:executionRoot,env,stdio:["ignore","ignore","pipe"]});child.stderr?.on("data",c=>{diagnostics=(diagnostics+String(c)).slice(-12000);});
    await wait("Broker readiness",async()=>{try{return(await fetch(url+"/bridge/events",{headers,signal:AbortSignal.timeout(500)})).ok;}catch{return false;}});};
  const request=(overrides:Record<string,unknown>={})=>({afterGoalId:predecessorId,taskScopeId:"issue:1218",text:"Issue1218: inspect the owner-local login utility source and current acceptance gaps",goalContract:{successCriteria:["Inspect authorized local context for the existing owner utility"],constraints:["Read-only source context; no credential or production mutation"]},idempotencyKey:"fixture-owner-approved-next",expiresAt:new Date(Date.now()+60000).toISOString(),...overrides});
  const post=(body:unknown,authenticated=true)=>fetch(url+"/work",{method:"POST",headers:authenticated?headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const list=async()=>{const response=await fetch(url+"/work-successors",{headers,signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return (await response.json() as {successors:Array<{id:string;status:string;targetGoalId:string}>}).successors;};
  const read=async()=>{const c=new CompassStore(compassPath);try{return {goal:c.getGoal(),state:c.getState(),priorWork:await new CompassWorkStateStoreAdapter(c).get(predecessorId),priorRun:await new CompassWorkRunStore(c).getByGoal(predecessorId)};}finally{c.close();}};
  const complete=async()=>{const c=new CompassStore(compassPath);try{const completed:WorkState={...work,status:"COMPLETED",currentState:"explicit fixture completed",nextAction:null,verificationResults:[{itemId:"criterion-1",passed:true,evidence:{kind:evidenceMarker}}]};await new CompassWorkStateStoreAdapter(c).put(completed);await new CompassWorkRunStore(c).put({...createQueuedWorkRun(predecessorId),phase:"COMPLETED"});c.updateState({status:"COMPLETED",verificationSummary:evidenceMarker,blockers:[]});return completed;}finally{c.close();}};
  return {root,compassPath,predecessor,predecessorId,url,headers,start,stop,wait,post,list,read,complete,request};
}

// Each fixture owns its repository, stores, server port and Broker processes.
describe("isolated approved-next Broker fixtures", { concurrency: process.platform === "linux" ? 2 : 1 }, () => {
test("Owner-approved next work starts once after verified completion, including duplicate and Broker restart",{timeout:45000},async t=>{
  const f=await fixture(t);await f.start();const body=f.request();
  assert.equal((await f.post(body,false)).status,401);
  assert.equal((await fetch(f.url+"/work-successors")).status,401);
  const response=await f.post(body);assert.equal(response.status,202);
  const accepted=await response.json() as {action:string;successorId:string;targetGoalId:string};assert.equal(accepted.action,"QUEUED_SUCCESSOR");assert.match(accepted.successorId,/^[a-f0-9]{64}$/);assert.notEqual(accepted.targetGoalId,f.predecessorId);
  assert.equal((await f.list()).length,1);assert.equal((await f.list())[0]?.status,"QUEUED");assert.deepEqual((await f.read()).goal,f.predecessor);
  const completed=await f.complete();
  // No second Owner request: startup/worker/timer drain must submit normal intake.
  await f.wait("queued next work automatically starts",async()=>{const rows=await f.list();return rows[0]?.status==="STARTED";});
  await f.wait("normal successor worker records its own progress",async()=>{const c=new CompassStore(f.compassPath);try{const run=await new CompassWorkRunStore(c).getByGoal(accepted.targetGoalId);const state=await new CompassWorkStateStoreAdapter(c).get(accepted.targetGoalId);return !!run&&run.phase!=="QUEUED"&&state!==null;}finally{c.close();}});
  const after=await f.read();assert.equal(after.goal?.title,body.text);assert.equal(after.priorRun?.phase,"COMPLETED");assert.deepEqual(after.priorWork,completed);
  const archive=records(after.state.active,"gai-retired-goal");assert.equal(archive.length,1);assert.deepEqual(archive[0]?.record,f.predecessor);assert.equal(archive[0]?.goalId,f.predecessorId);
  const c=new CompassStore(f.compassPath);try{
    const nextRun=await new CompassWorkRunStore(c).getByGoal(accepted.targetGoalId);assert.ok(nextRun);assert.notEqual(nextRun.runId,after.priorRun?.runId);
    const context=records(c.getState().active,"goriq-goal-execution-context").flatMap(x=>x.records as Array<{goalId:string;context:unknown[]}>).find(x=>x.goalId===accepted.targetGoalId);assert.ok(context);assert.ok(JSON.stringify(context.context).includes(body.text));
    const nextState=await new CompassWorkStateStoreAdapter(c).get(accepted.targetGoalId);assert.ok(nextState);assert.equal(nextState.goalId,accepted.targetGoalId);assert.equal(JSON.stringify(nextState.verificationResults).includes(evidenceMarker),false);
  }finally{c.close();}
  assert.notEqual(after.state.verificationSummary,evidenceMarker);
  const duplicate=await f.post(body);assert.equal(duplicate.status,202);const again=await duplicate.json() as {successorId:string;targetGoalId:string};assert.equal(again.successorId,accepted.successorId);assert.equal(again.targetGoalId,accepted.targetGoalId);
  await f.stop();await f.start();await delay(300);
  assert.equal((await f.list()).length,1);assert.equal((await f.list())[0]?.status,"STARTED");assert.equal((await f.read()).goal?.title,body.text);assert.equal(records((await f.read()).state.active,"gai-retired-goal").length,1);
});

test("expired and mismatched next instructions cannot create or replace a Goal",{timeout:20000},async t=>{
  const f=await fixture(t);await f.start();
  for(const body of [f.request({afterGoalId:"goal-other-fixture",idempotencyKey:"wrong-prior"}),f.request({expiresAt:new Date(Date.now()-1000).toISOString(),idempotencyKey:"expired"})]){
    const response=await f.post(body);assert.ok(response.status>=400,"Unbound/expired instruction rejected");
  }
  assert.deepEqual(await f.list(),[]);assert.deepEqual((await f.read()).goal,f.predecessor);
});

test("a queued instruction expiring before predecessor completion stays inert across restart",{timeout:30000},async t=>{
  const f=await fixture(t);await f.start();const body=f.request({expiresAt:new Date(Date.now()+2000).toISOString(),idempotencyKey:"expires-while-held"});
  assert.equal((await f.post(body)).status,202);assert.equal((await f.list())[0]?.status,"QUEUED");
  await delay(Math.max(0,Date.parse(body.expiresAt)-Date.now()+100));await f.stop();await f.complete();await f.start();await delay(5500);
  assert.deepEqual((await f.read()).goal,f.predecessor);assert.equal((await f.list())[0]?.status,"QUEUED");assert.equal(records((await f.read()).state.active,"gai-retired-goal").length,0);
});

test("successor envelope cannot dispatch a standalone device action",{timeout:20000},async t=>{
  const f=await fixture(t);await f.start();
  const snapshot=async()=>{const response=await fetch(f.url+"/state",{headers:f.headers});assert.equal(response.status,200);return await response.json() as {tasks:unknown[]};};
  const before=await snapshot();assert.deepEqual(before.tasks,[]);
  const response=await f.post(f.request({text:"wake",idempotencyKey:"not-a-goal-device-command"}));
  assert.equal(response.status,409);assert.equal((await response.json() as {accepted:boolean}).accepted,false);
  assert.deepEqual((await snapshot()).tasks,before.tasks);assert.deepEqual(await f.list(),[]);assert.deepEqual((await f.read()).goal,f.predecessor);
});
});
