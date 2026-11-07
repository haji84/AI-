import assert from "node:assert/strict";
import test from "node:test";
import { ResourceWaitScheduler } from "../src/orchestrator/development-resource-scheduler.ts";
import { nextResourceWait, resourceWaitFromEvidence } from "../src/orchestrator/development-resource-wait.ts";
import { createQueuedWorkRun } from "../src/orchestrator/work-run-state.ts";

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
