import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import type { CycleReport, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = { title: "finish safely", successCriteria: ["verified"], constraints: [] };
const intent = { summary: "finish", confidence: 1, evidence: [] };

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return { goal, intent, stopReason: "continue", contextSources: [], ...overrides };
}

async function file() {
  return join(await mkdtemp(join(tmpdir(), "jarvis-p7-block-")), "runs.json");
}

test("persisted blocked run stays blocked after runtime reconstruction without calling a fresh loop", async () => {
  const path = await file();
  let calls = 0;
  const first = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return report({ stopReason: "blocked", nextAction: "human resolution required" });
    },
  }) as never);

  const blocked = await first.run({ runId: "sticky", goal });
  assert.equal(blocked.state, "blocked");
  assert.equal(calls, 1);

  const restarted = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return report({ stopReason: "goal_complete", action: null });
    },
  }) as never);
  const restored = await restarted.run({ runId: "sticky", goal });

  assert.equal(restored.state, "blocked");
  assert.equal(restored.cycles, 1);
  assert.equal(calls, 1);
  assert.equal(restored.journal?.nextAction, "human resolution required");
});

test("durable recovery-budget block cannot be bypassed by another run call", async () => {
  const path = await file();
  let calls = 0;
  const stuck = report({
    action: { id: "stuck", description: "same operation", capability: "local", risk: "low" },
    result: { actionId: "stuck", ok: false, summary: "same temporary failure" },
    nextAction: "Retry same operation: same operation",
  });
  const first = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return stuck;
    },
  }) as never, {}, { maxConsecutiveNonProgressCycles: 2 });

  const blocked = await first.run({ runId: "budget", goal, maxCycles: 3 });
  assert.equal(blocked.state, "blocked");
  assert.equal(calls, 2);

  const restarted = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return report({ stopReason: "goal_complete", action: null });
    },
  }) as never, {}, { maxConsecutiveNonProgressCycles: 2 });
  const restored = await restarted.run({ runId: "budget", goal, maxCycles: 3 });

  assert.equal(restored.state, "blocked");
  assert.equal(calls, 2);
  assert.match(restored.recoveryBudget?.blockedReason ?? "", /Durable non-progress budget exhausted/);
});

test("waiting runs remain resumable across restart", async () => {
  const path = await file();
  let calls = 0;
  const first = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return report({ nextAction: "continue later" });
    },
  }) as never);
  const waiting = await first.run({ runId: "resume", goal, maxCycles: 1 });
  assert.equal(waiting.state, "waiting");

  const restarted = new ProductionAutonomyRuntime(path, () => ({
    runCycle: async () => {
      calls += 1;
      return report({ stopReason: "goal_complete", action: null, nextAction: null });
    },
  }) as never);
  const completed = await restarted.run({ runId: "resume", goal, maxCycles: 2 });

  assert.equal(completed.state, "completed");
  assert.equal(calls, 2);
});
