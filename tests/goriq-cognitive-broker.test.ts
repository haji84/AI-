import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

for (const contractMode of ["steps", "outcomes", "intake"] as const) test("authenticated Broker executes only configured local work and restores verified cognition after restart: " + contractMode,{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"goriq-broker-cognitive-")),token=randomBytes(32).toString("hex");
 const server=createServer();server.listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));
 const base="http://127.0.0.1:"+port, endpoint=base+"/api/jarvis/admin/cognitive", dbPath=join(dir,"compass.sqlite"),dataRoot=join(dir,"files"),manifestPath=join(dir,"manifest.json");
 let child:ReturnType<typeof spawn>|undefined;
 const launch=async()=>{child=spawn(process.execPath,["scripts/jarvis-broker.ts"],{windowsHide:true,stdio:"ignore",env:{...process.env,GITHUB_TOKEN:"",GAI_LOCAL_MODEL_NAME:"",JARVIS_BROKER_HOST:"127.0.0.1",JARVIS_BROKER_PORT:String(port),JARVIS_OWNER_TOKEN:token,JARVIS_DB_PATH:join(dir,"broker.sqlite"),JARVIS_COMPASS_DB_PATH:dbPath,GORIQ_LOCAL_WORK_MANIFEST:contractMode === "steps" ? manifestPath : "",GORIQ_LOCAL_OUTCOMES:contractMode === "outcomes" ? manifestPath : "",GORIQ_LOCAL_DATA_ROOT:dataRoot,GORIQ_LOCAL_MATERIAL_INTAKE:contractMode === "intake" ? "1" : "",JARVIS_PUBLIC_BROKER_URL:"",JARVIS_WORKER_INSTALL_URL:"",JARVIS_WORKER_APK_PATH:""}});for(let n=0;n<100;n++){try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(500)})).ok)return;}catch{ /* bounded isolated startup */ }await new Promise(r=>setTimeout(r,50));}throw Error("Isolated Broker startup failed");};
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,"exit");child.kill();await done;}};
 const send=(body:unknown,auth=true)=>fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 const status=()=>fetch(endpoint,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 try{
  await mkdir(dataRoot);const db=new CompassStore(dbPath);const record=db.setGoal({title:"Create verified local output",successCriteria:["Output contains 42"]});db.close();const goalId=goalWorkStateId(compassGoalToLoopGoal(record));
  await writeFile(join(dataRoot,"source.txt"),"42");
  const sha256=createHash("sha256").update("42").digest("hex");
  await writeFile(manifestPath,JSON.stringify(contractMode === "steps" ? {version:1,goalId,steps:[{id:"save",operation:"create",path:"result.txt",text:"42",expectedSha256:sha256,criteria:["criterion-1"]}]} : {version:1,goalId,materials:[{id:"source",path:"source.txt",sha256,format:"text"}],outcomes:[{id:"copy",materialId:"source",path:"result.txt",domain:"file",criteria:["criterion-1"]}]}));
  await launch();assert.equal((await fetch(endpoint)).status,401);assert.equal((await send({goalId},false)).status,401);
  for(const extra of [{allowExternalAI:true},{dataRoot:"/"},{maxCycles:999}])assert.equal((await send({goalId,...extra})).status,400);
  assert.equal((await send({goalId:"goal-"+"0".repeat(16)})).status,409);
  let intakeReceipt: {outputs:{id:string}[]}|undefined;
  if(contractMode === "intake") {
   const snapshot=await status(), material={goalId,goalDigest:snapshot.goalDigest,materials:[{format:"text",content:"42",criteria:["criterion-1"]}],mappingAcknowledged:true};
   const request=(auth:boolean)=>fetch(endpoint+"/materials",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(material)});
   assert.equal((await request(false)).status,401);
   const prepared=await request(true);assert.equal(prepared.status,200);intakeReceipt=await prepared.json();
  }
  const response=await send({goalId});assert.equal(response.status,200);assert.equal((await response.json()).stopReason,"goal_complete");
  if(contractMode === "intake") {
   const url=endpoint+"/materials?goalId="+goalId+"&outputId="+intakeReceipt!.outputs[0].id;
   assert.equal((await fetch(url)).status,401);
   const download=await fetch(url,{headers:{Authorization:"Bearer "+token}});assert.equal(download.status,200);
   assert.equal(Buffer.from((await download.json()).contentBase64,"base64").toString(),"42");
  } else assert.equal(await readFile(join(dataRoot,"result.txt"),"utf8"),"42");
  const before=await status();assert.equal(before.goalComplete,true);assert.equal(before.metrics.completedGoals,1);assert.equal(before.metrics.externalAiCallsPerGoal,0);assert.equal(before.attempts,contractMode === "steps" ? 1 : 2);
  await stop();await launch();const after=await status();assert.equal(after.goalId,goalId);assert.equal(after.metrics.completedGoals,1);assert.equal(after.attempts,contractMode === "steps" ? 1 : 2);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
