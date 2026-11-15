import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { URL } from "node:url";
import type { StateRecord } from "../../src/compass/store.ts";
import { GitHubCoordinatorStore, type GitHubGoalCheckpoint } from "../../scripts/goriq-github-coordinator-store.ts";
import { GitHubFencedCheckpointStores } from "../../scripts/goriq-github-checkpoint-stores.ts";
import { goalWorkStateId } from "../../src/orchestrator/work-state-integration.ts";
import { createQueuedWorkRun } from "../../src/orchestrator/work-run-state.ts";
import type { WorkState } from "../../src/orchestrator/work-state.ts";
import type { CoordinatorLease } from "../../src/gai/distributed-coordinator.ts";

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const fixtureGoal = { title: "Implement two fixture artifacts", description: "Source binding test only",
  successCriteria: ["first verified artifact", "second verified artifact"], constraints: ["No production"] };
export function sharedFixture() {
  const at = "2026-01-01T00:00:00.000Z", goalId = goalWorkStateId(fixtureGoal);
  const goal = { ...fixtureGoal, createdAt: at, updatedAt: at };
  const run = createQueuedWorkRun(goalId, at);
  const work: WorkState = { goalId, objective: fixtureGoal.description, definitionOfDone: fixtureGoal.successCriteria.map((description, i) => ({id:`criterion-${i+1}`,description,required:true})),
    currentState:"Fixture imported",status:"NOT_STARTED",riskClass:"R1",constraints:fixtureGoal.constraints,decisions:[],artifacts:[],verificationResults:[],childWorkItems:[],blockers:[],updatedAt:at };
  const sourceState: StateRecord = {projectId:"default",phase:null,status:"READY",completed:[],active:[
    {kind:"jarvis-work-runs",version:1,runs:[run]}, {kind:"gai-work-state",version:1,goalId,state:work,events:[]}],
    blockers:[],decisions:[],deliverables:[],verificationSummary:null,nextAction:"Execute fixture",updatedAt:at};
  const imported = {kind:"goriq-resident-authority-import-v1",goalId,goalContractDigest:hash(goal),sourceState,workState:work,bridgeEvents:[]};
  const changes = {kind:"goriq-change-set-import-v1",goalId,goalContractDigest:hash(goal),changeSets:[],snapshotSha256:hash([])};
  const checkpoint: GitHubGoalCheckpoint = {version:1,goalId,goalContractDigest:hash(goal),goal,workRun:run,tasks:{version:1,tasks:[],savedAt:at},
    developmentJobs:{version:1,jobs:[],savedAt:at},attempts:[],events:[
      {eventId:"fixture-authority-import",record:imported,recordSha256:hash(imported)}, {eventId:"fixture-change-import",record:changes,recordSha256:hash(changes)}]};
  const lease: CoordinatorLease = {clusterId:"fixture-cluster",coordinatorId:"fixture-A",epoch:1,fencingToken:"fixture-fence",issuedAt:at,updatedAt:at,leaseUntil:"2099-01-01T00:00:00.000Z"};
  const repository="fixture-owner/fixture-repo",branch="goriq-state/fixture",path="state/coordinator.enc.json",key=Buffer.alloc(32,0x31),token="fixture-token-not-a-live-credential";
  const files = new Map<string, Buffer>();
  const blob=(bytes:Buffer)=>createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  const replace=(value:GitHubGoalCheckpoint,nextLease=lease)=>{
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
    cipher.setAAD(Buffer.from(JSON.stringify(["goriq-coordinator-v1",repository,branch,path,lease.clusterId])));
    const bytes=Buffer.concat([cipher.update(JSON.stringify({schema:2,lease:nextLease,checkpoint:value})),cipher.final()]);
    files.set(path,Buffer.from(JSON.stringify({version:1,algorithm:"aes-256-gcm",nonce:iv.toString("base64"),ciphertext:bytes.toString("base64"),tag:cipher.getAuthTag().toString("base64")})));
  };
  replace(checkpoint);
  let conflict=false,rootWrites=0,readHook:(()=>void|Promise<void>)|undefined;
  const fetchImpl: typeof fetch=async (input,init={})=>{
    const url=new URL(String(input));
    assert.equal(url.origin,"https://api.github.com");
    assert.equal(init.redirect,"error");
    assert.equal(new Headers(init.headers).get("authorization"),`Bearer ${token}`);
    const name=url.pathname.split("/contents/")[1]!;
    if(name===path&&init.method==="GET")await readHook?.();
    const prior=files.get(name);
    if(init.method==="GET")return prior?Response.json({type:"file",path:name,sha:blob(prior),encoding:"base64",content:prior.toString("base64")}):Response.json({}, {status:404});
    assert.equal(init.method,"PUT");
    const body=JSON.parse(String(init.body));
    if((name===path&&conflict)||prior&&body.sha!==blob(prior))return Response.json({}, {status:409});
    const bytes=Buffer.from(body.content,"base64");files.set(name,bytes);
    if(name===path)rootWrites++;
    return Response.json({content:{sha:blob(bytes)},commit:{sha:"c".repeat(40)}},{status:prior?200:201});
  };
  const store=()=>new GitHubCoordinatorStore({repository,stateBranch:branch,clusterId:lease.clusterId,key,token,minimumEpoch:1,fetchImpl});
  const stores=(coordinator=store())=>new GitHubFencedCheckpointStores(coordinator,()=>({...lease}),{admitDevelopmentJob:()=>true});
  return {goalId,goal:fixtureGoal,checkpoint,lease,sourceState,work,store,stores,replace,
    conflict(){conflict=true;},interceptRootRead(hook:()=>void|Promise<void>){readHook=hook;},get rootWrites(){return rootWrites;},files};
}
