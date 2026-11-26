import assert from "node:assert/strict";
import test from "node:test";
import { ResourceWaitScheduler } from "../src/orchestrator/development-resource-scheduler.ts";
import { nextResourceWait, resourceWaitFromEvidence } from "../src/orchestrator/development-resource-wait.ts";
import { createQueuedWorkRun,nextGoalContinuation,GOAL_CONTINUATION_DELAY_MS,type WorkRunState } from "../src/orchestrator/work-run-state.ts";

function fixture() {
  let time = Date.parse("2026-10-21T12:00:00Z");
  let active = true;
  let resumed = 0;
  let timer: (() => void) | undefined;
  let delay = -1;
  const run = { ...createQueuedWorkRun("goal"), phase: "RUNNING" as const, resourceWait: nextResourceWait(undefined, { status: "WAITING_FOR_RESOURCE", reason: "commit pressure", retryAfterMs: 30_000, observedAt: new Date(time).toISOString() }, new Date(time)) };
  const options = {
    now: () => time,
    read: async () => ({ active, run }),
    resume: async () => { resumed++; },
    schedule: (callback: () => void, ms: number) => { timer = callback; delay = ms; return callback; },
    cancel: () => { timer = undefined; },
    onError: (error: unknown) => { throw error; },
  };
  return { run, options, get resumed() { return resumed; }, get delay() { return delay; }, pause: () => { active = false; }, advance: () => { time += 30_001; }, fire: async () => { timer?.(); await new Promise(resolve => setImmediate(resolve)); } };
}

test("persisted resource wait arms once after restart and resumes only after due", async () => {
  const f = fixture(); const scheduler = new ResourceWaitScheduler(f.options);
  await scheduler.arm("goal"); await scheduler.arm("goal");
  assert.equal(f.delay, 30_000); assert.equal(f.resumed, 0);
  f.advance(); await f.fire(); await f.fire();
  assert.equal(f.resumed, 1); scheduler.close();
});
test("pause and Human Gate are re-read at wake and prevent execution", async () => {
  for (const mode of ["pause", "gate"]) {
    const f = fixture(); const scheduler = new ResourceWaitScheduler(f.options);
    await scheduler.arm("goal");
    if (mode === "pause") f.pause(); else Object.assign(f.run, { phase: "HUMAN_GATE" });
    f.advance(); await f.fire(); assert.equal(f.resumed, 0); scheduler.close();
  }
});
test("expired wait wakes executor to record bounded stop, while shutdown cancels pending resume", async () => {
  const f = fixture(); f.run.resourceWait.checks = 20;
  const scheduler = new ResourceWaitScheduler(f.options);
  await scheduler.arm("goal"); assert.equal(f.delay, 0);
  await f.fire(); assert.equal(f.resumed, 1);
  await scheduler.arm("goal"); scheduler.close(); await f.fire(); assert.equal(f.resumed, 1);
});
test("malformed checkpoint fails visibly and untrusted nested/cyclic evidence is bounded", async () => {
  const f = fixture(); f.run.resourceWait.deadline = "invalid";
  const scheduler = new ResourceWaitScheduler(f.options);
  await assert.rejects(scheduler.arm("goal"), /invalid resource wait/);
  const cycle: { remoteEvidence?: unknown } = {}; cycle.remoteEvidence = cycle;
  assert.equal(resourceWaitFromEvidence(cycle), null);
  assert.equal(resourceWaitFromEvidence({ resourceWait: { status: "WAITING_FOR_RESOURCE", retryAfterMs: Infinity } }), null);
  scheduler.close();
});

test("persisted Goal chunk continuation wakes once after due without a resource wait",async()=>{
 let time=Date.parse("2026-11-11T00:00:00.000Z"),calls=0,delay=-1;
 let timer:(()=>void)|undefined;
 const run={...createQueuedWorkRun("g"),phase:"RUNNING" as const,continuationWait:nextGoalContinuation(undefined,new Date(time))!};
 const scheduler=new ResourceWaitScheduler({
   read:async()=>({active:true,run}),resume:async()=>{calls++},
   now:()=>time,schedule:(callback,ms)=>{timer=callback;delay=ms;return callback},
   cancel:()=>{timer=undefined},onError:error=>{throw error},
 });
 assert.equal(await scheduler.arm("g"),true);assert.equal(delay,GOAL_CONTINUATION_DELAY_MS);
 timer?.();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0,"not due cannot resume");
 time+=GOAL_CONTINUATION_DELAY_MS+1;timer?.();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);timer?.();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 scheduler.close();
});
test("Goal chunk continuation cannot bypass a paused run or overlap resource wait",async()=>{
 const at=new Date("2026-11-11T00:00:00.000Z");
 const run:WorkRunState={...createQueuedWorkRun("g"),phase:"RUNNING",continuationWait:nextGoalContinuation(undefined,at)!};
 let timer:(()=>void)|undefined,calls=0;
 const scheduler=new ResourceWaitScheduler({
   read:async()=>({active:true,run}),resume:async()=>{calls++},
   now:()=>at.getTime()+10000,schedule:callback=>{timer=callback;return callback},
   cancel:()=>{timer=undefined},onError:error=>{throw error},
 });
 await scheduler.arm("g");run.phase="HUMAN_GATE";timer?.();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
 run.phase="RUNNING";run.resourceWait=nextResourceWait(undefined,{status:"WAITING_FOR_RESOURCE",reason:"pressure",retryAfterMs:30000,observedAt:at.toISOString()},at);
 await assert.rejects(scheduler.arm("g"),/conflicting continuation/i);
 scheduler.close();
});
