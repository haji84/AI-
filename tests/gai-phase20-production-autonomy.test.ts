import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import type { CycleReport, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = { title: "finish work", successCriteria: ["verified"], constraints: [] };
const intent = { summary: "finish", confidence: 1, evidence: [] };
function report(overrides: Partial<CycleReport> = {}): CycleReport { return { goal, intent, stopReason: "continue", contextSources: [], ...overrides }; }
function loop(reports: CycleReport[]) { let index = 0; return { runCycle: async () => reports[Math.min(index++, reports.length - 1)]! }; }
async function file() { return join(await mkdtemp(join(tmpdir(), "prod-auto-")), "runs.json"); }

test("runs until verifier-backed completion and invokes learning hooks", async () => {
  let learned = 0; let completed = 0;
  const runtime = new ProductionAutonomyRuntime(await file(), () => loop([
    report(),
    report({ stopReason: "goal_complete", action: { id: "a", description: "done", capability: "local", risk: "low" }, verification: { ok: true, summary: "pass", evidence: { id: "v1" } } }),
  ]) as never, { onVerifiedCycle: async () => { learned += 1; }, onVerifiedCompletion: async () => { completed += 1; } });
  const result = await runtime.run({ runId: "r1", goal });
  assert.equal(result.state, "completed"); assert.equal(result.cycles, 2); assert.equal(learned, 1); assert.equal(completed, 1);
});

test("preserves approval and blocker stops", async () => {
  const approval = new ProductionAutonomyRuntime(await file(), () => loop([report({ stopReason: "approval_required" })]) as never);
  assert.equal((await approval.run({ runId: "approval", goal })).state, "approval-required");
  const blocked = new ProductionAutonomyRuntime(await file(), () => loop([report({ stopReason: "blocked" })]) as never);
  assert.equal((await blocked.run({ runId: "blocked", goal })).state, "blocked");
});

test("persists run state and completed idempotency across restart", async () => {
  const path = await file(); let calls = 0;
  const first = new ProductionAutonomyRuntime(path, () => ({ runCycle: async () => { calls += 1; return report({ stopReason: "goal_complete", action: null }); } }) as never);
  await first.run({ runId: "same", goal });
  const restarted = new ProductionAutonomyRuntime(path, () => ({ runCycle: async () => { calls += 1; return report(); } }) as never);
  const restored = await restarted.run({ runId: "same", goal });
  assert.equal(restored.state, "completed"); assert.equal(calls, 1);
});

test("bounded cycle exhaustion waits durably instead of claiming success", async () => {
  const runtime = new ProductionAutonomyRuntime(await file(), () => loop([report()]) as never);
  const result = await runtime.run({ runId: "wait", goal, maxCycles: 2 });
  assert.equal(result.state, "waiting"); assert.equal(result.cycles, 2);
});

test("readiness never substitutes CI for real-device and long-run evidence", async () => {
  const runtime = new ProductionAutonomyRuntime(await file(), () => loop([report()]) as never);
  const incomplete = runtime.readiness();
  assert.equal(incomplete.implementationComplete, true); assert.equal(incomplete.productionReady, false);
  assert.deepEqual(incomplete.missingEvidence, ["real multi-device E2E", "real iPhone E2E", "long-duration run"]);
  const ready = runtime.readiness({ multiDeviceE2E: ["zbook-mac-real"], iPhoneE2E: ["iphone-real"], longDurationRun: ["24h-pass"] });
  assert.equal(ready.productionReady, true);
});
