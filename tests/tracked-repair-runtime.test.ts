import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createResidentReceiptWakes } from "../src/orchestrator/resident-receipt-wakes.ts";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTrackedRepairResidentRuntime, type TrackedRepairManifest } from "../src/orchestrator/tracked-repair-resident-runtime.ts";
import { residentDevelopmentGoalDigest } from "../src/orchestrator/resident-development-sequence.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { JsonFileDevelopmentJobStore } from "../src/orchestrator/development-job-store.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";
import { ResourceWaitError } from "../src/gai/development-resource-admission.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassWorkRunStore } from "../src/orchestrator/compass-work-run-store.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";
import { completionDigest } from "../src/orchestrator/completion-path.ts";

const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
// Published RFC8032 fixture, not a newly generated or trusted operator key.
const fixtureKey=createPrivateKey({key:Buffer.from("302e020100300506032b657004220420"+"9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60","hex"),format:"der",type:"pkcs8"});
const publicKey=createPublicKey(fixtureKey).export({format:"pem",type:"spki"}).toString();
const admit=async<T>(work:()=>Promise<T>)=>work();
function fixture(t:TestContext,bookkeeping=false,rows="valid"){
  const root=mkdtempSync(join(tmpdir(),"tracked-runtime-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,"repo"),workspace=join(root,"candidate"),baselineWorkspace=join(root,"baseline"),runtimeRoot=join(root,"runtime");
  mkdirSync(repo);mkdirSync(runtimeRoot);mkdirSync(join(repo,"scripts"));mkdirSync(join(repo,"tests"));
  writeFileSync(join(repo,"tests/.keep"),"keep\n");const before="export const answer = 0;\n";
  writeFileSync(join(repo,"scripts/logic.mjs"),before);
  const mapPath="docs/jarvis-reverse-traceability.json",map=JSON.stringify({schema_version:1,scope:"unchanged",padding:"x".repeat(276713),surfaces:[{path:"scripts/logic.mjs",sha256:hash(before),classification:"INTERNAL_IMPLEMENTATION_DETAIL",requirement_ids:["CORE-014"],reason:"unchanged"}]},null,2)+"\n";
  if(bookkeeping){mkdirSync(join(repo,"docs"));const doc=JSON.parse(map);if(rows==="missing")doc.surfaces=[];if(rows==="duplicate")doc.surfaces.push(structuredClone(doc.surfaces[0]));writeFileSync(join(repo,mapPath),JSON.stringify(doc,null,2)+"\n");}
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init");git("config","user.name","Runtime test");git("config","user.email","runtime@example.invalid");git("config","core.autocrlf","false");git("add",".");git("commit","-m","base");
  const base=git("rev-parse","HEAD");git("worktree","add","--detach",workspace,base);git("worktree","add","--detach",baselineWorkspace,base);
  const text="Repair the pinned frozen source regression",goal={title:text,description:text,successCriteria:["Frozen regression and the signed suite pass"],constraints:["Isolated artifacts only; no publication"]};
  const probeFile=join(root,"probe.mjs"),probe="import assert from 'node:assert/strict';\nimport {pathToFileURL} from 'node:url';\nimport {join} from 'node:path';\nconst {answer}=await import(pathToFileURL(join(process.cwd(),'scripts/logic.mjs')).href);\nassert.equal(answer,42);\n";
  writeFileSync(probeFile,probe);const publicKeyFile=join(root,"public.pem");writeFileSync(publicKeyFile,publicKey);
  const manifest:TrackedRepairManifest={version:1,profile:"tracked-source-repair-v1",sequence:{version:1,goalDigest:residentDevelopmentGoalDigest(goal),taskScopeId:"issue:1219",maxRisk:"low",completionMode:"verified-local-artifact",
    expiresAt:new Date(Date.now()+3600000).toISOString(),jobs:[{key:"repair",objective:"Repair answer to pass the frozen regression",criterionIds:["criterion-1"],targetFiles:["scripts/logic.mjs","tests/frozen.test.mjs"],baseRevision:base}]},
    workspace,baselineWorkspace,targetPath:"scripts/logic.mjs",trackedFiles:[{path:"scripts/logic.mjs",beforeSha256:hash(before)}],slots:[{id:1,path:"scripts/logic.mjs",before:"0"}],
    probe:{file:probeFile,sha256:hash(probe),targetPath:"tests/frozen.test.mjs",expectedRedText:"0 !== 42"},model:{endpoint:"http://127.0.0.1:11435/completion",id:"fixture-model",sha256:"a".repeat(64),nPredict:512,timeoutMs:5000},
    verifier:{publicKeyFile,publicKeySha256:hash(publicKey),receiptFile:join(root,"receipt.json")}};
  if(bookkeeping){Object.assign(manifest,{bookkeeping:{path:mapPath,beforeSha256:hash(readFileSync(join(repo,mapPath)))}});manifest.sequence.jobs[0]!.targetFiles.push(mapPath);}
  const manifestFile=join(root,"manifest.json");let bytes=JSON.stringify(manifest);writeFileSync(manifestFile,bytes);
  const env={GORIQ_TRACKED_REPAIR_MANIFEST_FILE:manifestFile,GORIQ_TRACKED_REPAIR_MANIFEST_SHA256:hash(bytes)};
  const compassPath=join(root,"state/compass.sqlite"),stateRoot=join(root,"state/self-development");
  let calls=0,templates=0;
  const fetchImpl:typeof fetch=async(url,options)=>{
    if(String(url).endsWith("/apply-template")){
      templates++;const prompt=JSON.parse(String(options?.body)).messages[1].content as string;
      assert.ok(prompt.includes("SOURCE scripts/logic.mjs\nexport const answer = 0;\n"));
      assert.ok(prompt.indexOf("SOURCE ")<prompt.indexOf("Objective: "));
      assert.ok(prompt.includes("Repair answer to pass the frozen regression"));
      assert.equal(prompt.includes("Objective: undefined"),false);
      return new Response(JSON.stringify({prompt:"<|im_start|>user\n"+prompt+"<|im_end|>\n<|im_start|>assistant\n"}));
    }
    calls++;assert.ok(existsSync(join(stateRoot,"tracked-repair")),"state exists before inference");
    return new Response(JSON.stringify({model:"fixture-model",stop:true,truncated:false,stop_type:"eos",content:JSON.stringify({edits:[{slot:1,after:"42"}]})}));
  };
  const create=(overrides:Partial<Parameters<typeof createTrackedRepairResidentRuntime>[0]>={})=>createTrackedRepairResidentRuntime({env,runtimeRoot,compassPath,goal,fetchImpl,resourceAdmission:admit,...overrides})!;
  return {root,workspace,baselineWorkspace,manifest,env,goal,goalId:goalWorkStateId(goal),compassPath,stateRoot,create,fetchImpl,
    counts:()=>({calls,templates}),jobs:()=>new JsonFileDevelopmentJobStore(join(stateRoot,"jobs.json")),
    changes:()=>new JsonFileDevelopmentChangeSetStore(join(stateRoot,"change-sets.json")),
    repin:()=>{bytes=JSON.stringify(manifest);writeFileSync(manifestFile,bytes);env.GORIQ_TRACKED_REPAIR_MANIFEST_SHA256=hash(bytes);}};
}

type RuntimeFixture = ReturnType<typeof fixture>;
function recoveryFixture(t:TestContext,bookkeeping=false){
  const f=fixture(t,bookkeeping),workspace=join(f.root,"repair-attempt-2"),receiptFile=join(f.root,"receipt-attempt-2.json");
  execFileSync("git",["worktree","add","--detach",workspace,f.manifest.sequence.jobs[0]!.baseRevision],{cwd:f.baselineWorkspace,stdio:"pipe"});
  Object.assign(f.manifest,{recoveryAttempts:[{workspace,receiptFile}]});f.repin();
  const prompts:string[]=[];let calls=0;
  const fetchImpl:typeof fetch=async(url,options)=>{
    if(String(url).endsWith("/apply-template")){
      prompts.push(JSON.parse(String(options?.body)).messages[1].content);
      return new Response(JSON.stringify({prompt:"<|im_start|>assistant\n"}));
    }
    calls++;
    return new Response(JSON.stringify({model:"fixture-model",stop:true,truncated:false,stop_type:"eos",
      content:JSON.stringify({edits:[{slot:1,after:calls===1?"41":"42"}]})}));
  };
  return {...f,recoveryWorkspace:workspace,recoveryReceipt:receiptFile,repairFetch:fetchImpl,prompts,repairCalls:()=>calls};
}
async function fixtureReceipt(f:RuntimeFixture,file:string,failed=false,amend?:(payload:SignedLocalVerifierPayload)=>void){
  const job=(await f.jobs().getByGoal(f.goalId))[0]!,change=(await f.changes().list()).find(c=>c.workItemId.endsWith(":implement")&&c.status!=="REJECTED")!;
  const at=new Date().toISOString(),payload:SignedLocalVerifierPayload={version:1,verifierId:"fixture-not-independent",goalId:f.goalId,
    jobId:job.jobId,changeSetId:change.changeSetId,builderId:change.deviceId,baseRevision:change.baseRevision,
    sourceRevision:change.candidateRevision,artifactDigest:change.artifactDigest,issuedAt:at,expiresAt:new Date(Date.now()+600000).toISOString(),
    checks:["lint","typecheck","unit","integration","security","build"].map(check=>({check:check as "lint",
      status:failed&&check==="unit"?"failed":"passed",outputDigest:hash("fixture:"+check),recordedAt:at}))};
  amend?.(payload);
  const bytes=JSON.stringify({payload,signatureBase64:sign(null,Buffer.from(canonicalLocalVerifierPayload(payload)),fixtureKey).toString("base64")});
  writeFileSync(file,bytes,{flag:"wx"});return {bytes,job,change};
}

test("tracked recovery consumes a signed failure with optional evidence, creates a distinct candidate after restart and preserves rejected evidence",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);
  const probeEnv:NodeJS.ProcessEnv={PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",NODE_ENV:"test"};
  const red=spawnSync(process.execPath,["--test",f.manifest.probe.targetPath],{cwd:f.workspace,env:probeEnv,encoding:"utf8"});
  assert.equal(red.status,1,red.stdout+red.stderr);
  const first=await fixtureReceipt(f,f.manifest.verifier.receiptFile,true,p=>{
    p.checks.push({check:"visual",status:"inconclusive",outputDigest:hash("optional visual"),recordedAt:p.issuedAt});
  });
  const firstRequest=readFileSync(f.manifest.verifier.receiptFile+".request.json");
  await f.create({fetchImpl:f.repairFetch}).run(input);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"RECOVERING");
  const journal=join(f.stateRoot,"tracked-repair"),before=new Map(readdirSync(journal).map(name=>[name,readFileSync(join(journal,name))]));
  await f.create({fetchImpl:f.repairFetch}).run(input);
  assert.equal(f.repairCalls(),2);
  assert.match(f.prompts[1]!,/check_not_passed:unit/);
  assert.match(f.prompts[1]!,/export const answer = 41/);
  assert.notEqual(f.prompts[0],f.prompts[1]);
  assert.equal(readFileSync(join(f.workspace,"scripts/logic.mjs"),"utf8"),"export const answer = 41;\n");
  assert.equal(readFileSync(join(f.recoveryWorkspace,"scripts/logic.mjs"),"utf8"),"export const answer = 42;\n");
  const green=spawnSync(process.execPath,["--test",f.manifest.probe.targetPath],{cwd:f.recoveryWorkspace,env:probeEnv,encoding:"utf8"});
  assert.equal(green.status,0,green.stdout+green.stderr);
  assert.deepEqual(readFileSync(f.manifest.verifier.receiptFile+".request.json"),firstRequest);
  assert.equal(readFileSync(f.manifest.verifier.receiptFile,"utf8"),first.bytes);
  for(const [name,bytes] of before)assert.deepEqual(readFileSync(join(journal,name)),bytes,name);
  const secondRequest=JSON.parse(readFileSync(f.recoveryReceipt+".request.json","utf8"));
  assert.equal(secondRequest.request.jobId,first.job.jobId);
  assert.notEqual(secondRequest.request.changeSetId,first.change.changeSetId);
  assert.notEqual(secondRequest.request.artifactDigest,first.change.artifactDigest);
  const second=await fixtureReceipt(f,f.recoveryReceipt);
  const noModel:typeof fetch=async()=>{assert.fail("receipt resume must not infer again");};
  const result=await f.create({fetchImpl:noModel}).run(input);
  assert.equal(result.goalEvaluation?.achieved,true);
  const jobs=await f.jobs().getByGoal(f.goalId);assert.equal(jobs.length,1);assert.equal(jobs[0]!.phase,"COMPLETED");
  assert.equal(jobs[0]!.attempts.length,1);assert.equal(f.repairCalls(),2);
  assert.equal((await f.changes().get(first.change.changeSetId))!.status,"REJECTED");
  assert.notEqual(second.change.changeSetId,first.change.changeSetId);
});

test("tracked recovery watches each pinned receipt and refuses path aliases before inference",t=>{
  const f=recoveryFixture(t);
  assert.deepEqual(createResidentReceiptWakes(f.env,process.cwd()).map(w=>w.path),[f.manifest.verifier.receiptFile,f.recoveryReceipt]);
  const attempts=(f.manifest as TrackedRepairManifest & {recoveryAttempts:Array<{workspace:string;receiptFile:string}>}).recoveryAttempts;
  attempts[0]!.receiptFile=f.root+"/alias/../receipt.json";f.repin();
  assert.throws(()=>f.create(),/OVERLAP/);assert.equal(f.repairCalls(),0);
});

test("tracked recovery never grants a second inference without a host-pinned attempt",async t=>{
  const f=fixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create().run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);await f.create().run(input);
  const report=await f.create({fetchImpl:async()=>{assert.fail("no attempt authority");}}).run(input);
  assert.ok(report.goalEvaluation?.blockers.includes("tracked_repair_attempt_limit"));
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.attempts.length,1);
});

test("tracked recovery refuses a previous candidate receipt at the new receipt path",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);const first=await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);await f.create({fetchImpl:f.repairFetch}).run(input);
  writeFileSync(f.recoveryReceipt,first.bytes);
  await assert.rejects(()=>f.create({fetchImpl:async()=>{assert.fail("stale receipt must not infer");}}).run(input),/SIGNED_VERIFIER_BINDING_INVALID/);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"VERIFYING");assert.equal(f.repairCalls(),2);
});

test("tracked recovery retains a consumed failure when its external receipt is replaced",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);const first=await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  writeFileSync(f.manifest.verifier.receiptFile,"{\"untrusted\":true}");
  await f.create({fetchImpl:f.repairFetch}).run(input);
  assert.equal(f.repairCalls(),2);
  const archived=readdirSync(join(f.stateRoot,"tracked-repair")).map(name=>readFileSync(join(f.stateRoot,"tracked-repair",name),"utf8"));
  assert.ok(archived.includes(first.bytes));
});

test("tracked recovery prepared output resumes partial materialization without another inference",async t=>{
  const f=recoveryFixture(t,true),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);const first=await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  const put=JsonFileDevelopmentChangeSetStore.prototype.put;let interrupted=false;
  JsonFileDevelopmentChangeSetStore.prototype.put=async function(value,now){
    if(value.workItemId.endsWith(":implement")&&value.changeSetId!==first.change.changeSetId&&!interrupted){interrupted=true;throw Error("second candidate checkpoint interrupted");}
    return put.call(this,value,now);
  };
  try{await assert.rejects(()=>f.create({fetchImpl:f.repairFetch}).run(input),/second candidate checkpoint interrupted/);}
  finally{JsonFileDevelopmentChangeSetStore.prototype.put=put;}
  assert.equal(interrupted,true);assert.equal(f.repairCalls(),2);
  const bookkeeping="docs/jarvis-reverse-traceability.json";
  writeFileSync(join(f.recoveryWorkspace,bookkeeping),readFileSync(join(f.baselineWorkspace,bookkeeping)));
  await f.create({fetchImpl:async()=>{assert.fail("prepared retry must not infer");}}).run(input);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"VERIFYING");
  assert.equal(JSON.parse(readFileSync(join(f.recoveryWorkspace,bookkeeping),"utf8")).surfaces[0].sha256,hash("export const answer = 42;\n"));
  assert.equal(readFileSync(join(f.workspace,"scripts/logic.mjs"),"utf8"),"export const answer = 41;\n");
});

test("tracked recovery does not reissue interrupted second inference",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);let calls=0;
  const interrupted:typeof fetch=async(url,options)=>{
    if(String(url).endsWith("/apply-template"))return f.repairFetch(url,options);
    calls++;throw Error("model connection interrupted");
  };
  await assert.rejects(()=>f.create({fetchImpl:interrupted}).run(input),/model connection interrupted/);
  await assert.rejects(()=>f.create({fetchImpl:async()=>{assert.fail("interrupted inference cannot replay");}}).run(input),/TRACKED_REPAIR_INFERENCE_INTERRUPTED_NO_RETRY/);
  assert.equal(calls,1);assert.equal(f.repairCalls(),1);
});

test("tracked recovery partial receipts stay pending without freezing incomplete evidence",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);
  await fixtureReceipt(f,f.manifest.verifier.receiptFile,false,p=>{p.checks=p.checks.slice(0,2);});
  await f.create({fetchImpl:async()=>{assert.fail("pending is not permission to infer");}}).run(input);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"VERIFYING");
  rmSync(f.manifest.verifier.receiptFile);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:async()=>{assert.fail("consume only");}}).run(input);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"RECOVERING");
});

test("hosted executor fences its authority file from every recovery workspace",async t=>{
  const f=recoveryFixture(t),db=new CompassStore(f.compassPath);
  const goal=compassGoalToLoopGoal(db.setGoal({title:f.goal.title,successCriteria:f.goal.successCriteria,constraints:f.goal.constraints}));
  const goalId=goalWorkStateId(goal);db.updateState({status:"READY",blockers:[]});await new CompassWorkRunStore(db).put(createQueuedWorkRun(goalId));db.close();
  f.manifest.sequence.goalDigest=residentDevelopmentGoalDigest(goal);f.repin();
  const config={version:1,authorityPath:f.compassPath,goalId,goalDigest:residentDevelopmentGoalDigest(goal),taskScopeId:"issue:1219",
    executionContractDigest:f.env.GORIQ_TRACKED_REPAIR_MANIFEST_SHA256,expiresAt:f.manifest.sequence.expiresAt,hostId:"github-hosted",privacy:"public",
    nodes:[{id:"github-hosted",kind:"cloud",capabilities:["code-builder","filesystem"],online:true,healthy:true,privacy:"public-ok",incrementalCost:0,reliability:1,latencyMs:1,evidenceModes:["LOCAL"]}]};
  const file=join(f.recoveryWorkspace,"host-owned.json"),bytes=JSON.stringify(config);writeFileSync(file,bytes);
  const repositoryRoot=fileURLToPath(new URL("../",import.meta.url));
  const run=spawnSync(process.execPath,[join(repositoryRoot,"scripts/jarvis-goal-executor.ts")],{cwd:repositoryRoot,encoding:"utf8",timeout:15000,
    env:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",NODE_ENV:"test",...f.env,
      GORIQ_EXECUTION_HOST_MODE:"hosted",GORIQ_EXECUTION_HOST_ID:"github-hosted",GORIQ_HOSTED_ROUTING_FILE:file,GORIQ_HOSTED_ROUTING_SHA256:hash(bytes),
      JARVIS_GOAL_EXECUTION_GOAL_ID:goalId,JARVIS_GOAL_EXECUTION_COMPASS_PATH:f.compassPath}});
  assert.equal(run.status,1);assert.match(run.stderr,/RESIDENT_AUTHORITY_INSIDE_CANDIDATE/);
  assert.equal((await f.jobs().getByGoal(goalId)).length,0,"authority must fail before planning or model execution");
});

test("tracked recovery uses the recorded consumption time for expired historical evidence",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  t.mock.timers.enable({apis:["Date"],now:Date.now()+11*60000});
  await f.create({fetchImpl:f.repairFetch}).run(input);
  assert.equal(f.repairCalls(),2);assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"VERIFYING");
});

test("tracked recovery refuses altered archived signatures before another inference",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);const first=await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  const root=join(f.stateRoot,"tracked-repair"),archive=readdirSync(root).find(name=>readFileSync(join(root,name),"utf8")===first.bytes)!;
  assert.ok(archive);
  const receipt=JSON.parse(first.bytes);receipt.payload.checks[0].outputDigest="0".repeat(64);writeFileSync(join(root,archive),JSON.stringify(receipt));
  await assert.rejects(()=>f.create({fetchImpl:async()=>{assert.fail("tampered failure cannot authorize inference");}}).run(input),/SIGNED_VERIFIER_SIGNATURE_INVALID/);
  assert.equal(f.repairCalls(),1);
});

test("tracked recovery stops at its final pinned attempt and keeps both rejected candidates",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);await f.create({fetchImpl:f.repairFetch}).run(input);
  await fixtureReceipt(f,f.recoveryReceipt,true);await f.create({fetchImpl:f.repairFetch}).run(input);
  const result=await f.create({fetchImpl:async()=>{assert.fail("no third pinned attempt");}}).run(input);
  assert.ok(result.goalEvaluation?.blockers.includes("tracked_repair_attempt_limit"));assert.equal(f.repairCalls(),2);
  assert.equal((await f.changes().list()).filter(c=>c.status==="REJECTED").length,2);
});

test("tracked recovery rejects equivalent model output even in a separate workspace",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  const repeat:typeof fetch=async(url,options)=>{
    const response=await f.repairFetch(url,options);
    if(String(url).endsWith("/apply-template"))return response;
    const body=await response.json() as {content:string};body.content=JSON.stringify({edits:[{slot:1,after:"41"}]});return new Response(JSON.stringify(body));
  };
  const result=await f.create({fetchImpl:repeat}).run(input);
  assert.ok(result.goalEvaluation?.blockers.includes("equivalent_failed_candidate"));assert.equal(f.repairCalls(),2);
  assert.equal((await f.changes().list()).filter(c=>c.status==="REJECTED").length,2);
  assert.equal(existsSync(f.recoveryReceipt+".request.json"),false);
});

test("tracked recovery refuses dirty pre-provisioned workspaces before inference",async t=>{
  const f=recoveryFixture(t),input={goalId:f.goalId,goal:f.goal,context:[]};
  await f.create({fetchImpl:f.repairFetch}).run(input);await fixtureReceipt(f,f.manifest.verifier.receiptFile,true);
  await f.create({fetchImpl:f.repairFetch}).run(input);
  writeFileSync(join(f.recoveryWorkspace,"scripts/logic.mjs"),"export const answer = 999;\n");
  await assert.rejects(()=>f.create({fetchImpl:async()=>{assert.fail("dirty workspace must not infer");}}).run(input),/INDEPENDENT_ARTIFACT_STATUS_MISMATCH/);
  assert.equal(readFileSync(join(f.recoveryWorkspace,"scripts/logic.mjs"),"utf8"),"export const answer = 999;\n");
});

test("tracked repair profile is selected fail-closed before a Broker can ignore an incomplete host pin",()=>{
  assert.throws(()=>createResidentReceiptWakes({GORIQ_TRACKED_REPAIR_MANIFEST_FILE:"/tmp/not-configured.json"},process.cwd()),/TRACKED_REPAIR_MANIFEST_PIN_REQUIRED/);
});

test("real durable host performs trusted RED then one bounded edit and waits for a bound receipt",async t=>{
  const f=fixture(t),runtime=f.create();assert.equal(runtime.matches(f.goal),true);
  const report=await runtime.run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.equal(report.goalEvaluation?.achieved,false);assert.deepEqual(f.counts(),{calls:1,templates:1});
  assert.equal(readFileSync(join(f.workspace,"scripts/logic.mjs"),"utf8"),"export const answer = 42;\n");
  assert.equal(readFileSync(join(f.baselineWorkspace,"scripts/logic.mjs"),"utf8"),"export const answer = 0;\n");
  const job=(await f.jobs().getByGoal(f.goalId))[0]!;assert.equal(job.phase,"VERIFYING");
  const request=JSON.parse(readFileSync(f.manifest.verifier.receiptFile+".request.json","utf8"));
  assert.equal(request.version,2);assert.equal(request.request.jobId,job.jobId);assert.equal(request.request.goalId,f.goalId);
  assert.deepEqual(request.request.requiredChecks,["lint","typecheck","unit","integration","security","build"]);
  assert.equal(request.request.trackedEdits.files[0].afterSha256,hash("export const answer = 42;\n"));
  const restarted=await f.create({fetchImpl:async()=>{assert.fail("persisted candidate must not reinvoke model");}}).run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.equal(restarted.goalEvaluation?.achieved,false);assert.deepEqual(f.counts(),{calls:1,templates:1});
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.jobId,job.jobId);
});

test("the exact six-check receipt completes only the isolated criterion without rebuilding",async t=>{
  const f=fixture(t);await f.create().run({goalId:f.goalId,goal:f.goal,context:[]});
  const job=(await f.jobs().getByGoal(f.goalId))[0]!,change=(await f.changes().list()).find(c=>c.workItemId.endsWith(":implement"))!;
  const at=new Date().toISOString(),p:SignedLocalVerifierPayload={version:1,verifierId:"fixture-not-independent",goalId:f.goalId,jobId:job.jobId,changeSetId:change.changeSetId,builderId:change.deviceId,
    baseRevision:change.baseRevision,sourceRevision:change.candidateRevision,artifactDigest:change.artifactDigest,issuedAt:at,expiresAt:new Date(Date.now()+600000).toISOString(),
    checks:["lint","typecheck","unit","integration","security","build"].map(check=>({check:check as "lint",status:"passed",outputDigest:hash(check),recordedAt:at}))};
  const receipt={payload:p,signatureBase64:sign(null,Buffer.from(canonicalLocalVerifierPayload(p)),fixtureKey).toString("base64")};
  writeFileSync(f.manifest.verifier.receiptFile,JSON.stringify(receipt));
  const report=await f.create({fetchImpl:async()=>{assert.fail("receipt continuation never rebuilds");}}).run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.equal(report.goalEvaluation?.achieved,true);assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"COMPLETED");
  assert.deepEqual(f.counts(),{calls:1,templates:1});
});

test("prepared candidate recovers when Change Set persistence fails after source materialization",async t=>{
  const f=fixture(t),put=JsonFileDevelopmentChangeSetStore.prototype.put;let interrupted=false;
  JsonFileDevelopmentChangeSetStore.prototype.put=async function(value,now){
    if(value.workItemId.endsWith(":implement")&&!interrupted){interrupted=true;throw Error("test checkpoint interruption");}
    return put.call(this,value,now);
  };
  try{await assert.rejects(()=>f.create().run({goalId:f.goalId,goal:f.goal,context:[]}),/test checkpoint interruption/);}
  finally{JsonFileDevelopmentChangeSetStore.prototype.put=put;}
  assert.equal(interrupted,true);assert.equal(f.counts().calls,1);
  assert.equal((await f.changes().list()).filter(c=>c.workItemId.endsWith(":implement")).length,0);
  const job=(await f.jobs().getByGoal(f.goalId))[0]!;assert.equal(job.phase,"IMPLEMENTING");
  const report=await f.create({fetchImpl:async()=>{assert.fail("prepared output must recover without another model request");}})
    .run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.equal(report.goalEvaluation?.achieved,false);assert.equal(f.counts().calls,1);
  const recovered=(await f.jobs().getByGoal(f.goalId))[0]!;assert.equal(recovered.jobId,job.jobId);assert.equal(recovered.phase,"VERIFYING");
  assert.equal(readFileSync(join(f.workspace,"scripts/logic.mjs"),"utf8"),"export const answer = 42;\n");
});

test("receipt presence alone cannot pass the profile and changed candidate bytes cannot reuse it",async t=>{
  const f=fixture(t);await f.create().run({goalId:f.goalId,goal:f.goal,context:[]});
  writeFileSync(f.manifest.verifier.receiptFile,JSON.stringify({payload:{},signatureBase64:"A".repeat(86)+"=="}));
  await assert.rejects(()=>f.create().run({goalId:f.goalId,goal:f.goal,context:[]}),/SIGNED_VERIFIER_/);
  writeFileSync(join(f.workspace,"scripts/logic.mjs"),"export const answer = 43;\n");
  await assert.rejects(()=>f.create().run({goalId:f.goalId,goal:f.goal,context:[]}),/CONTENT_MISMATCH/);
  assert.equal((await f.jobs().getByGoal(f.goalId))[0]!.phase,"VERIFYING");assert.equal(f.counts().calls,1);
});

test("generated source is treated as bytes and is never executed by the Broker-side runtime",async t=>{
  const f=fixture(t),marker=join(f.root,"host-execution-forbidden");
  const fetchImpl:typeof fetch=async(url,options)=>String(url).endsWith("/apply-template")?f.fetchImpl(url,options):
    new Response(JSON.stringify({model:"fixture-model",stop:true,truncated:false,stop_type:"eos",content:JSON.stringify({edits:[{slot:1,after:"42; await import('node:fs').then(m=>m.writeFileSync("+JSON.stringify(marker)+",'bad'))"}]})}));
  const report=await f.create({fetchImpl}).run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.equal(report.goalEvaluation?.achieved,false);assert.equal(existsSync(marker),false);
});

test("probe and manifest pins fail before model execution",t=>{
  const f=fixture(t);f.env.GORIQ_TRACKED_REPAIR_MANIFEST_SHA256="0".repeat(64);
  assert.throws(()=>f.create(),/MANIFEST_PIN_MISMATCH/);
  f.repin();writeFileSync(f.manifest.probe.file,"changed test\n");assert.throws(()=>f.create(),/PROBE_PIN_MISMATCH/);
  assert.deepEqual(f.counts(),{calls:0,templates:0});
});

test("pinned verifier input admits only one public PEM and rejects an appended private PEM bundle",t=>{
  const f=fixture(t),bundle=publicKey+fixtureKey.export({format:"pem",type:"pkcs8"}).toString();
  writeFileSync(f.manifest.verifier.publicKeyFile,bundle);f.manifest.verifier.publicKeySha256=hash(bundle);f.repin();
  assert.throws(()=>f.create(),/TRACKED_REPAIR_PUBLIC_KEY_INVALID/);assert.deepEqual(f.counts(),{calls:0,templates:0});
});

test("resource wait before network leaves inference retry available without duplicating a call",async t=>{
  const f=fixture(t),wait=async()=>{throw new ResourceWaitError({status:"WAITING_FOR_RESOURCE",reason:"test pressure",retryAfterMs:1,observedAt:new Date().toISOString()});};
  await f.create({resourceAdmission:wait}).run({goalId:f.goalId,goal:f.goal,context:[]});
  assert.deepEqual(f.counts(),{calls:0,templates:0});
  const records=await f.jobs().getByGoal(f.goalId);assert.equal(records[0]!.phase,"WAITING_FOR_RESOURCE");
});

test("standalone executor refuses a valid legacy handoff when tracked profile is selected",async t=>{
  const f=fixture(t),db=new CompassStore(f.compassPath);
  const goal=compassGoalToLoopGoal(db.setGoal({title:f.goal.title,successCriteria:f.goal.successCriteria,constraints:f.goal.constraints}));
  const goalId=goalWorkStateId(goal);db.updateState({status:"READY",blockers:[]});
  await new CompassWorkRunStore(db).put(createQueuedWorkRun(goalId));db.close();
  f.manifest.sequence.goalDigest=residentDevelopmentGoalDigest(goal);f.repin();
  const revision="a".repeat(40),handoffFile=join(f.root,"legacy-handoff.json");writeFileSync(join(f.root,"artifact.txt"),"accepted bytes");
  const handoff={version:1,goalId,goalDigest:completionDigest(goal),dataRootDigest:hash(f.root),sourceRevision:revision,expiresAt:f.manifest.sequence.expiresAt,
    requirements:[{criterionId:"criterion-1",weight:1,evidence:[{kind:"software",environment:"host-local-artifact:artifact.txt",sourceRevision:revision,artifactDigest:hash("accepted bytes"),trustedIssuers:["completion-local-sha256-v1"]}]}],
    candidates:[{workItem:{id:"inspect",objective:"Inspect accepted artifact",requiredCapabilities:["context.inspect"],dependsOn:[]},criterionIds:["criterion-1"],strategyId:"readback",rationale:"required artifact condition",evidenceRefs:["issue:1858"],feasibility:"available",estimatedMinutes:1,riskSignals:{},humanActions:[],action:{id:"inspect",description:"Inspect accepted artifact",capability:"context.inspect",risk:"low"}}],
    checks:[{criterionId:"criterion-1",taskId:"inspect",path:"artifact.txt",expectedSha256:hash("accepted bytes")}]};
  const bytes=JSON.stringify(handoff);writeFileSync(handoffFile,bytes);
  const repositoryRoot=fileURLToPath(new URL("../",import.meta.url));
  const result=spawnSync(process.execPath,[join(repositoryRoot,"scripts/jarvis-goal-executor.ts")],{cwd:repositoryRoot,encoding:"utf8",timeout:15000,
    env:{...process.env,...f.env,GORIQ_COMPLETION_HANDOFF_PATH:handoffFile,GORIQ_COMPLETION_HANDOFF_SHA256:hash(bytes),GORIQ_COMPLETION_DATA_ROOT:f.root,GORIQ_RUNTIME_REVISION:revision,
      JARVIS_GOAL_EXECUTION_GOAL_ID:goalId,JARVIS_GOAL_EXECUTION_COMPASS_PATH:f.compassPath,GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE:"",GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256:""}});
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/TRACKED_REPAIR_MULTIPLE_RUNTIME_PROFILES/);
  const reopened=new CompassStore(f.compassPath);try{assert.equal((await new CompassWorkRunStore(reopened).getByGoal(goalId))?.phase,"BLOCKED");}finally{reopened.close();}
});

test("authenticated Broker selects tracked profile and restarts the same waiting Job without another model call",{timeout:45000},async t=>{
  const f=fixture(t),repositoryRoot=fileURLToPath(new URL("../",import.meta.url));let child:ChildProcess|undefined,diagnostics="",calls=0;
  let acceptedGoalId=f.goalId;
  const model=createServer((request,response)=>{
    const chunks:Buffer[]=[];request.on("data",c=>chunks.push(Buffer.from(c)));request.once("end",()=>{
      response.setHeader("content-type","application/json");
      if(request.url==="/apply-template")return response.end(JSON.stringify({prompt:"<|im_start|>assistant\n"}));
      calls++;response.end(JSON.stringify({model:"fixture-model",stop:true,truncated:false,stop_type:"eos",content:JSON.stringify({edits:[{slot:1,after:"42"}]})}));
    });
  });
  model.listen(0,"127.0.0.1");await once(model,"listening");t.after(()=>new Promise<void>(r=>model.close(()=>r())));
  f.manifest.model.endpoint=`http://127.0.0.1:${(model.address() as {port:number}).port}/completion`;f.repin();
  const socket=createServer();socket.listen(0,"127.0.0.1");await once(socket,"listening");const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
  const owner="tracked-profile-test-owner",headers={Authorization:`Bearer ${owner}`,"content-type":"application/json"},url=`http://127.0.0.1:${port}/api/jarvis/admin`;
  const resource=join(f.root,"resource");mkdirSync(resource);
  const env={...process.env,...f.env,GITHUB_TOKEN:"",GH_TOKEN:"",CODE_BUILDER_LOCAL_TOKEN:"",CODE_BUILDER_LOCAL_URL:"",
    GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE:"",GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256:"",GORIQ_COMPLETION_HANDOFF_PATH:"",GORIQ_COMPLETION_HANDOFF_SHA256:"",
    JARVIS_BROKER_HOST:"127.0.0.1",JARVIS_BROKER_PORT:String(port),JARVIS_OWNER_TOKEN:owner,JARVIS_DB_PATH:join(f.root,"broker.sqlite"),JARVIS_COMPASS_DB_PATH:f.compassPath,
    JARVIS_PUBLIC_BROKER_URL:"",JARVIS_WORKER_INSTALL_URL:"",JARVIS_WORKER_APK_PATH:"",XDG_STATE_HOME:resource,
    NODE_OPTIONS:`--import=${pathToFileURL(join(repositoryRoot,"tests/helpers/resource-telemetry-preload.mjs")).href}`};
  const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,"exit");child.kill();await done;}child=undefined;};
  t.after(stop);
  const start=()=>{child=spawn(process.execPath,[join(repositoryRoot,"scripts/jarvis-broker.ts")],{cwd:repositoryRoot,env,stdio:["ignore","ignore","pipe"]});
    child.stderr?.on("data",c=>{diagnostics=(diagnostics+String(c)).slice(-12000);});};
  const failureSnapshot=async()=>{
    const jobs=await f.jobs().getByGoal(acceptedGoalId),journal=join(f.stateRoot,"tracked-repair");
    return JSON.stringify({calls,jobs:jobs.map(job=>({jobId:job.jobId,phase:job.phase,attempts:job.attempts.length,
      lastTransition:job.history.at(-1)})),journals:existsSync(journal)?readdirSync(journal):[],
      receiptRequested:existsSync(f.manifest.verifier.receiptFile+".request.json")});
  };
  const wait=async(label:string,check:()=>Promise<boolean>)=>{const until=Date.now()+15000;while(Date.now()<until){if(child?.exitCode!==null&&child?.exitCode!==undefined)assert.fail(label+diagnostics+"\n"+await failureSnapshot());
    if(await check())return;await new Promise(r=>setTimeout(r,100));}assert.fail(label+diagnostics+"\n"+await failureSnapshot());};
  const ready=()=>wait("Broker ready",async()=>{try{return(await fetch(url+"/bridge/events",{headers,signal:AbortSignal.timeout(500)})).ok;}catch{return false;}});
  start();await ready();
  const body=JSON.stringify({text:f.goal.title,goalContract:{successCriteria:f.goal.successCriteria,constraints:f.goal.constraints},idempotencyKey:"tracked-profile-intake"});
  assert.equal((await fetch(url+"/work",{method:"POST",headers:{"content-type":"application/json"},body})).status,401);
  const response=await fetch(url+"/work",{method:"POST",headers,body});assert.equal(response.status,202);
  const accepted=await response.json() as {goalId:string;executionScheduled:boolean};assert.equal(accepted.executionScheduled,true);
  acceptedGoalId=accepted.goalId;
  await wait("tracked Job VERIFYING",async()=>{const jobs=await f.jobs().getByGoal(accepted.goalId);return jobs.length===1&&jobs[0]!.phase==="VERIFYING"&&existsSync(f.manifest.verifier.receiptFile+".request.json");});
  const before=(await f.jobs().getByGoal(accepted.goalId))[0]!;assert.equal(calls,1);const pid=child!.pid;
  await stop();start();await ready();assert.notEqual(child!.pid,pid);
  await wait("same waiting Job",async()=>{const response=await fetch(url+"/work/"+accepted.goalId,{headers});const state=await response.json() as {run?:{nextAction?:string}};return state.run?.nextAction==="verification_wait";});
  assert.equal(calls,1);assert.equal((await f.jobs().getByGoal(accepted.goalId))[0]!.jobId,before.jobId);
});


test("host bookkeeping binds a large pinned map and preserves every field except changed source SHA",async t=>{
  const f=fixture(t,true),before=JSON.parse(readFileSync(join(f.baselineWorkspace,"docs/jarvis-reverse-traceability.json"),"utf8"));
  await f.create().run({goalId:f.goalId,goal:f.goal,context:[]});
  const after=JSON.parse(readFileSync(join(f.workspace,"docs/jarvis-reverse-traceability.json"),"utf8"));
  const expected=structuredClone(before);expected.surfaces[0].sha256=hash("export const answer = 42;\n");assert.deepEqual(after,expected);
  assert.equal(readFileSync(join(f.workspace,"docs/jarvis-reverse-traceability.json"),"utf8"),readFileSync(join(f.baselineWorkspace,"docs/jarvis-reverse-traceability.json"),"utf8").replace(before.surfaces[0].sha256,expected.surfaces[0].sha256));
  const request=JSON.parse(readFileSync(f.manifest.verifier.receiptFile+".request.json","utf8"));
  const doc=request.request.trackedEdits.files.find((v:{path:string})=>v.path==="docs/jarvis-reverse-traceability.json");
  assert.equal(doc.beforeSha256,hash(readFileSync(join(f.baselineWorkspace,doc.path))));assert.equal(doc.afterSha256,hash(readFileSync(join(f.workspace,doc.path))));
  await f.create({fetchImpl:async()=>{assert.fail("bookkeeping recovery must not infer");}}).run({goalId:f.goalId,goal:f.goal,context:[]});assert.equal(f.counts().calls,1);
});

test("bookkeeping prepared recovery rejects metadata tampering without invoking a model",async t=>{
  const f=fixture(t,true);await f.create().run({goalId:f.goalId,goal:f.goal,context:[]});
  const job=(await f.jobs().getByGoal(f.goalId))[0]!,file=join(f.stateRoot,"tracked-repair",hash(job.jobId)+".prepared.json");
  const prepared=JSON.parse(readFileSync(file,"utf8")),doc=prepared.files.find((v:{path:string})=>v.path==="docs/jarvis-reverse-traceability.json");
  doc.content=doc.content.replace('"scope": "unchanged"','"scope": "forged"');writeFileSync(file,JSON.stringify(prepared));
  await assert.rejects(()=>f.create({fetchImpl:async()=>{assert.fail("no retry");}}).run({goalId:f.goalId,goal:f.goal,context:[]}),/BOOKKEEPING/);assert.equal(f.counts().calls,1);
});

test("bookkeeping cannot be used as a model slot or select an arbitrary docs path",t=>{
  const f=fixture(t,true);f.manifest.slots.push({id:2,path:"docs/jarvis-reverse-traceability.json",before:"unchanged"});f.repin();
  assert.throws(()=>f.create(),/SCOPE_INVALID/);f.manifest.slots.pop();Object.assign(f.manifest,{bookkeeping:{path:"docs/other.json",beforeSha256:"a".repeat(64)}});f.repin();
  assert.throws(()=>f.create(),/BOOKKEEPING/);
});

for(const rows of ["missing","duplicate"]){test(`bookkeeping refuses ${rows} source rows without materializing candidate`,async t=>{
  const f=fixture(t,true,rows);await assert.rejects(()=>f.create().run({goalId:f.goalId,goal:f.goal,context:[]}),/BOOKKEEPING_ROW_PIN_INVALID/);
  assert.equal(readFileSync(join(f.workspace,"scripts/logic.mjs"),"utf8"),"export const answer = 0;\n");assert.equal(f.counts().calls,1);
});}
