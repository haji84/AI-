import { loadCanonicalBundle } from "../scripts/jarvis-owner-spec-sync.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";

test("actual authenticated Broker work ingress captures owner requirement and survives restart", {timeout:30000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),"jarvis-owner-intake-")),token=randomBytes(32).toString("hex");
 const server=createServer();server.listen(0,"127.0.0.1");await once(server,"listening");
 const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));
 const base="http://127.0.0.1:"+port;let child:ReturnType<typeof spawn>|undefined;
 const launch=async()=>{child=spawn(process.execPath,["scripts/jarvis-broker.ts"],{windowsHide:true,stdio:"ignore",env:{...process.env,GITHUB_TOKEN:"",JARVIS_BROKER_HOST:"127.0.0.1",JARVIS_BROKER_PORT:String(port),JARVIS_OWNER_TOKEN:token,JARVIS_DB_PATH:join(dir,"state.sqlite"),JARVIS_COMPASS_DB_PATH:join(dir,"compass.sqlite"),JARVIS_PUBLIC_BROKER_URL:"",JARVIS_WORKER_INSTALL_URL:"",JARVIS_WORKER_APK_PATH:""}});for(let n=0;n<100;n++){try{if((await fetch(base+"/health",{signal:AbortSignal.timeout(1000)})).ok)return;}catch{ /* bounded isolated startup */ }await new Promise(r=>setTimeout(r,50));}throw Error("Broker startup failed");};
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit");child.kill();await exited;}};
 const send=(body:unknown,authorized=true)=>fetch(base+"/api/jarvis/admin/work",{method:"POST",signal:AbortSignal.timeout(5000),headers:{"content-type":"application/json",...(authorized?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body)});
 const payload={text:"JARVISの仕様同期を完成させて",idempotencyKey:"owner-first",requirement:{decision:"accept",statement:"CORE-015 の仕様同期を完了条件に追加する",canonicalIds:["CORE-015"]}};
 try{
  await launch();assert.equal((await send(payload,false)).status,401);
  const invalid=await send({text:"broken goal を完成させて",idempotencyKey:"bad-first",requirement:{decision:"accept",statement:"replace",supersedes:"owner-intake-"+"0".repeat(32)}});
  assert.equal(invalid.status,409);
  const badRetry=await send({text:"broken goal を完成させて",idempotencyKey:"bad-first",requirement:{decision:"accept",statement:"replace",supersedes:"owner-intake-"+"0".repeat(32)}});assert.equal(badRetry.status,409);
  const first=await send(payload);assert.equal(first.status,202);const result=await first.json();assert.equal(result.requirement.state,"ACCEPTED_REQUIREMENT");assert.ok(result.goalId);assert.equal(result.requirement.goalId,result.goalId);
  assert.equal(result.requirement.source.boundary,"broker_owner_auth");assert.equal(result.requirement.source.specSynced,undefined);
  assert.equal((await send({...payload,idempotencyKey:"forgery",requirement:{...payload.requirement,specSynced:true}})).status,409);
  assert.equal((await send({...payload,text:"different"})).status,409,"same key cannot silently accept another statement");
  const proposalRequest={decisionId:result.requirement.id,review:{sourceRef:"https://github.com/haji84/AI-/issues/1205",bindings:[{id:"CORE-015",baseFingerprint:result.requirement.matches.find((x:{id:string})=>x.id==="CORE-015").fingerprint}]}};
  const proposal=await fetch(base+"/api/jarvis/admin/requirements/proposal",{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(proposalRequest),signal:AbortSignal.timeout(5000)});
  assert.equal(proposal.status,200);const artifact=await proposal.json();assert.equal(artifact.files.length,4);assert.equal(artifact.autoMerge,false);assert.equal(artifact.productionAuthorized,false);
  assert.equal((await fetch(base+"/api/jarvis/admin/requirements/proposal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(proposalRequest),signal:AbortSignal.timeout(5000)})).status,401);
  for(const authorized of [false,true]){
   const pub=await fetch(base+"/api/jarvis/admin/requirements/publish",{method:"POST",headers:{"content-type":"application/json",...(authorized?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(proposalRequest),signal:AbortSignal.timeout(5000)});
   assert.equal(pub.status,authorized?503:401);
   if(authorized)assert.equal((await pub.json()).message,"github_write_unavailable");
  }
  await stop();await launch();
  const retry=await (await send(payload)).json();assert.equal(retry.requirement.id,result.requirement.id);
  const list=await fetch(base+"/api/jarvis/admin/requirements",{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)});assert.equal(list.status,200);assert.equal((await list.json()).records.length,1);
  assert.equal((await fetch(base+"/api/jarvis/admin/requirements",{signal:AbortSignal.timeout(5000)})).status,401);

  const adopt=await (await send({text:"郵便を分類できる機能を追加して",idempotencyKey:"natural"})).json();
  assert.equal(adopt.requirement.state,"ACCEPTED_REQUIREMENT");
  const previewRequest={decisionId:adopt.requirement.id,choice:{mode:"new"}};
  const previewUrl=base+"/api/jarvis/admin/requirements/preview";
  assert.equal((await fetch(previewUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(previewRequest)})).status,401);
  const preview=await fetch(previewUrl,{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(previewRequest)});
  assert.equal(preview.status,200);const display=await preview.json();assert.deepEqual(display.requirementIds,[`OWN-${String(loadCanonicalBundle(process.cwd()).inventory.allocations.length+1).padStart(3,"0")}`]);assert.equal(display.bundle,undefined);assert.equal(display.files[0].content,undefined);
  const idea=await (await send({text:"たとえば通知機能を追加して",idempotencyKey:"example"})).json();assert.equal(idea.requirement.state,"IDEA");
  const chosen=await (await send({text:"それで進めて",idempotencyKey:"chosen",requirementReferenceId:idea.requirement.id})).json();
  assert.equal(chosen.requirement.statement,idea.requirement.statement);assert.deepEqual(chosen.requirement.conversation.referenceIds,[idea.requirement.id]);
  const retryChosen=await (await send({text:"それで進めて",idempotencyKey:"chosen",requirementReferenceId:idea.requirement.id})).json();assert.equal(retryChosen.requirement.id,chosen.requirement.id);
  await send({text:"文字サイズ機能が欲しい"});const nextChosen=await (await send({text:"それで進めて"})).json();assert.match(nextChosen.requirement.statement,/文字/);
  assert.notEqual(nextChosen.requirement.id,chosen.requirement.id);
  await send({text:"仕様として追加: calendar display",idempotencyKey:"calendar"});
  const ambiguous=await (await send({text:"この仕様を撤回して",idempotencyKey:"ambiguous"})).json();assert.equal(ambiguous.accepted,false);assert.equal(ambiguous.conversation.needsClarification,true);
 }finally{await stop();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}
});
