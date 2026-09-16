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

test("durable non-progress budget survives runtime reconstruction and blocks repeated identical outcome", async () => {
  const path = await file();
  const stuck = report({
    action: { id: "retry-a", description: "retry same", capability: "local", risk: "low" },
    result: { actionId: "retry-a", ok: false, summary: "same temporary failure" },
    nextAction: "Retry same operation: retry same",
  });

  const first = new ProductionAutonomyRuntime(path, () => loop([stuck]) as never, {}, { maxConsecutiveNonProgressCycles: 2 });
  const firstResult = await first.run({ runId: "restart-budget", goal, maxCycles: 1 });
  assert.equal(firstResult.state, "waiting");
  assert.equal(firstResult.recoveryBudget?.consecutiveNonProgress, 1);
  assert.equal(firstResult.recoveryBudget?.limit, 2);

  const restarted = new ProductionAutonomyRuntime(path, () => loop([stuck]) as never, {}, { maxConsecutiveNonProgressCycles: 2 });
  const secondResult = await restarted.run({ runId: "restart-budget", goal, maxCycles: 3 });
  assert.equal(secondResult.state, "blocked");
  assert.equal(secondResult.recoveryBudget?.consecutiveNonProgress, 2);
  assert.match(secondResult.recoveryBudget?.blockedReason ?? "", /Durable non-progress budget exhausted \(2\/2\)/);
});

test("verified progress resets durable non-progress streak and a changed strategy gets a fresh bounded streak", async () => {
  const path = await file();
  const sameFailure = report({
    action: { id: "work", description: "work", capability: "local", risk: "low" },
    result: { actionId: "work", ok: false, summary: "failure" },
    nextAction: "Retry same operation: work",
  });
  const verifiedProgress = report({
    action: { id: "repair", description: "repair", capability: "local", risk: "low" },
    result: { actionId: "repair", ok: true, summary: "repair passed" },
    verification: { ok: true, summary: "verified repair", evidence: { step: "repair" } },
    nextAction: "Continue after repair",
  });
  const changedStrategy = report({
    action: { id: "work", description: "work", capability: "local", risk: "low" },
    result: { actionId: "work", ok: false, summary: "different failure" },
    nextAction: "Strategy pivot 1: alternative work",
  });

  const runtime = new ProductionAutonomyRuntime(
    path,
    () => loop([sameFailure, verifiedProgress, changedStrategy]) as never,
    {},
    { maxConsecutiveNonProgressCycles: 2 },
  );
  const result = await runtime.run({ runId: "progress-reset", goal, maxCycles: 3 });
  assert.equal(result.state, "waiting");
  assert.equal(result.cycles, 3);
  assert.equal(result.completionEvidence.length, 1);
  assert.equal(result.recoveryBudget?.consecutiveNonProgress, 1);
  assert.equal(result.recoveryBudget?.blockedReason, undefined);
  assert.ok(result.recoveryBudget?.lastProgressAt);
});

test("invalid durable recovery budget configuration fails closed", async () => {
  assert.throws(
    () => new ProductionAutonomyRuntime("/tmp/unused.json", () => loop([report()]) as never, {}, { maxConsecutiveNonProgressCycles: 1 }),
    /integer from 2 to 100/,
  );
});
