import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { existsSync } from "node:fs";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "../src/orchestrator/development-change-set-store.ts";
import { createDevelopmentJob, DevelopmentJobStateController } from "../src/orchestrator/development-job.ts";
import {
  JsonFileDevelopmentJobStore,
  MemoryDevelopmentJobStore,
} from "../src/orchestrator/development-job-store.ts";

function job() {
  return createDevelopmentJob({
    jobId: "job-store-1",
    goalId: "goal-681",
    requirementIds: ["CORE-014"],
    acceptanceCriteria: ["durable"],
    definitionOfDone: [{ id: "durable", description: "survives restart", required: true }],
    baseRevision: "b".repeat(40),
    approvalScope: { taskScopeId: "issue-681", maxRisk: "low" },
    workItems: [{ id: "persist", objective: "persist", dependsOn: [], requiredCapabilities: ["filesystem"] }],
  }, new Date("2026-09-26T00:00:00.000Z"));
}

test("memory store returns clones and deduplicates job identity", async () => {
  const store = new MemoryDevelopmentJobStore();
  const value = job();
  await store.put(value);
  const restored = await store.get(value.jobId);
  assert.deepEqual(restored, value);
  restored!.blockers.push("mutated outside store");
  assert.deepEqual((await store.get(value.jobId))?.blockers, []);
  await assert.rejects(() => store.put({ ...value, goalId: "other-goal" }), /identity conflict/i);
});
test("JSON store survives reconstruction and uses a versioned snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-development-job-"));
  const path = join(directory, "jobs.json");
  try {
    const first = new JsonFileDevelopmentJobStore(path);
    await first.put(job());
    const second = new JsonFileDevelopmentJobStore(path);
    assert.deepEqual(await second.get("job-store-1"), job());
    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number; jobs: unknown[] };
    assert.equal(raw.version, 1);
    assert.equal(raw.jobs.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON store rejects a corrupt or unsupported snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-development-job-corrupt-"));
  const path = join(directory, "jobs.json");
  try {
    await writeFile(path, JSON.stringify({ version: 99, jobs: [] }), "utf8");
    const store = new JsonFileDevelopmentJobStore(path);
    await assert.rejects(() => store.list(), /unsupported development job snapshot/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent stale history cannot overwrite a Human Gate even with a newer timestamp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-development-gate-"));
  try {
    const path = join(directory, "jobs.json");
    const first = new JsonFileDevelopmentJobStore(path), second = new JsonFileDevelopmentJobStore(path);
    const initial = job(), controller = new DevelopmentJobStateController();
    await first.put(initial);
    const stale = (await first.get(initial.jobId))!;
    await second.put(controller.apply(initial, { transitionId: "owner-gate", actor: "state-controller", to: "HUMAN_GATE", reason: "owner gate", at: "2026-09-26T00:00:01.000Z" }));
    const late = controller.apply(stale, { transitionId: "late-wait", actor: "state-controller", to: "WAITING_FOR_RESOURCE", reason: "pressure", at: "2026-09-26T00:00:02.000Z" });
    await assert.rejects(first.put(late), /conflicting development job history/);
    assert.equal((await first.get(initial.jobId))?.phase, "HUMAN_GATE");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function withRenameFault<T>(platform:NodeJS.Platform,
  fault:(attempt:number,perform:()=>Promise<void>)=>Promise<void>,body:(calls:()=>number)=>Promise<T>):Promise<T>{
  const original=promises.rename,descriptor=Object.getOwnPropertyDescriptor(process,"platform")!;let calls=0;
  Object.defineProperty(process,"platform",{...descriptor,value:platform});
  promises.rename=async(...args)=>fault(++calls,()=>original(...args));syncBuiltinESMExports();
  try{return await body(()=>calls);}
  finally{promises.rename=original;syncBuiltinESMExports();Object.defineProperty(process,"platform",descriptor);}
}

test("Windows transient replacement sharing failure preserves the complete old Job and lease until commit",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"goriq-job-transient-")),path=join(directory,"jobs.json"),store=new JsonFileDevelopmentJobStore(path),initial=job();
  const next=new DevelopmentJobStateController().apply(initial,{transitionId:"plan",actor:"state-controller",to:"PLANNING",reason:"plan",at:"2026-09-26T00:00:01.000Z"});
  try{
    await store.put(initial);const old=await readFile(path,"utf8");
    await withRenameFault("win32",async(attempt,perform)=>{
      assert.equal(await readFile(path,"utf8"),old);assert.equal(existsSync(path+".lock"),true);
      if(attempt<3)throw Object.assign(Error("sharing violation"),{code:"EPERM"});await perform();
    },async calls=>{await store.put(next);assert.equal(calls(),3);});
    assert.deepEqual(await new JsonFileDevelopmentJobStore(path).get(initial.jobId),JSON.parse(JSON.stringify(next)));
    assert.equal(existsSync(path+".lock"),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("Windows persistent replacement denial fails within its bound and retains the previous complete snapshot",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"goriq-job-denied-")),path=join(directory,"jobs.json"),store=new JsonFileDevelopmentJobStore(path),initial=job();
  const denial=Object.assign(Error("permanent denial"),{code:"EPERM"});
  try{
    await store.put(initial);const old=await readFile(path,"utf8");
    await withRenameFault("win32",async()=>{assert.equal(await readFile(path,"utf8"),old);throw denial;},async calls=>{
      await assert.rejects(()=>store.put({...initial,blockers:["new snapshot"]}),error=>error===denial);
      assert.ok(calls()>1&&calls()<=5);
    });
    assert.equal(await readFile(path,"utf8"),old);assert.deepEqual(await new JsonFileDevelopmentJobStore(path).get(initial.jobId),initial);
    assert.equal(existsSync(path+".lock"),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

for(const [platform,code] of [["win32","EACCES"],["linux","EPERM"]] as const)test("unrelated replacement failure is not retried: "+platform+"/"+code,async()=>{
  const directory=await mkdtemp(join(tmpdir(),"goriq-job-fail-fast-")),path=join(directory,"jobs.json"),store=new JsonFileDevelopmentJobStore(path),initial=job();
  const failure=Object.assign(Error("unchanged failure"),{code});
  try{
    await store.put(initial);const old=await readFile(path,"utf8");
    await withRenameFault(platform,async()=>{throw failure;},async calls=>{
      await assert.rejects(()=>store.put({...initial,blockers:["new snapshot"]}),error=>error===failure);assert.equal(calls(),1);
    });
    assert.equal(await readFile(path,"utf8"),old);
  }finally{await rm(directory,{recursive:true,force:true});}
});

for(const permanent of [false,true])test("ChangeSet replacement exposes only committed state during "+(permanent?"persistent denial":"transient sharing failure"),async()=>{
  const directory=await mkdtemp(join(tmpdir(),"goriq-change-replace-")),path=join(directory,"changes.json"),store=new JsonFileDevelopmentChangeSetStore(path);
  const initial=createDevelopmentChangeSet({changeSetId:"change-replace",jobId:"job-681",workItemId:"job-681:implement",deviceId:"fixture",
    baseRevision:"a".repeat(40),changedPaths:["src/example.ts"],affectedSymbols:[],patchDigest:"b".repeat(64),evidenceDigest:"c".repeat(64),rollback:{kind:"git-base",reference:"a".repeat(40)}},new Date("2026-09-26T00:00:00.000Z"));
  const next={...initial,patchDigest:"d".repeat(64),updatedAt:"2026-09-26T00:00:01.000Z"},denial=Object.assign(Error("sharing denial"),{code:"EPERM"});
  try{
    await store.put(initial);const old=await readFile(path,"utf8");
    await withRenameFault("win32",async(attempt,perform)=>{
      assert.equal(await readFile(path,"utf8"),old);assert.deepEqual(await store.get(initial.changeSetId),initial);
      assert.equal(existsSync(path+".lock"),true);
      if(permanent||attempt<3)throw denial;await perform();
    },async calls=>{
      if(permanent){await assert.rejects(()=>store.put(next),error=>error===denial);assert.ok(calls()>1&&calls()<=5);}
      else await store.put(next);
    });
    const expected=permanent?initial:next;
    assert.deepEqual(await store.get(initial.changeSetId),expected);
    assert.deepEqual(await new JsonFileDevelopmentChangeSetStore(path).get(initial.changeSetId),expected);
    assert.equal(existsSync(path+".lock"),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
