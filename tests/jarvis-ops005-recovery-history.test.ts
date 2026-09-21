import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { readProductionRecoveryHistory } from "../src/gai/production-recovery-history.ts";
import type { CycleReport, Goal } from "../src/orchestrator/goal-loop.ts";

function goal(title: string): Goal {
  return { title, successCriteria: ["verified"], constraints: [] };
}

function report(goalValue: Goal, overrides: Partial<CycleReport> = {}): CycleReport {
  return {
    goal: goalValue,
    intent: { summary: goalValue.title, confidence: 1, evidence: [] },
    stopReason: "continue",
    contextSources: [],
    ...overrides,
  };
}

function loop(reports: CycleReport[]) {
  let index = 0;
  return { runCycle: async () => reports[Math.min(index++, reports.length - 1)]! };
}

async function historyFile() {
  return join(await mkdtemp(join(tmpdir(), "jarvis-recovery-history-")), "runs.json");
}

test("OPS-005 persists structured recovery decisions across runtime reconstruction", async () => {
  const path = await historyFile();
  const taskGoal = goal("durable recovery history");
  const secretEvidence = "raw-recovery-evidence-must-not-leak";
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "repair-1", description: "repair candidate", capability: "local", risk: "low" },
      result: { actionId: "repair-1", ok: false, summary: "compile failed", evidence: { secretEvidence } },
      recoveryDecision: {
        action: "repair",
        reason: "Failure can be repaired within the current strategy (1/3)",
        nextStrategyPivot: 0,
        blocked: false,
      },
      stopReason: "continue",
      nextAction: "Repair current strategy and retry: repair candidate",
    }),
    report(taskGoal, {
      action: { id: "pivot-2", description: "alternate implementation", capability: "local", risk: "low" },
      result: { actionId: "pivot-2", ok: false, summary: "same failure", evidence: { secretEvidence } },
      recoveryDecision: {
        action: "strategy_pivot",
        reason: "same failure reached retry limit; re-plan",
        nextStrategyPivot: 1,
        blocked: false,
      },
      stopReason: "continue",
      nextAction: "Strategy pivot 1: re-plan a different approach",
    }),
    report(taskGoal, {
      action: { id: "blocked-3", description: "external dependency", capability: "local", risk: "low" },
      result: { actionId: "blocked-3", ok: false, summary: "external dependency unavailable", blocker: "physical access required", evidence: { secretEvidence } },
      recoveryDecision: {
        action: "blocked",
        reason: "Explicit blocker: physical access required",
        nextStrategyPivot: 1,
        blocked: true,
        humanInterventionHint: "physical access required",
      },
      stopReason: "blocked",
      nextAction: "BLOCKED: physical access required",
    }),
  ]) as never);

  const blocked = await runtime.run({ runId: "recovery-run", goal: taskGoal });
  assert.equal(blocked.state, "blocked");
  assert.deepEqual(blocked.recoveryHistory?.map((entry) => [entry.cycle, entry.action, entry.blocked, entry.nextStrategyPivot]), [
    [1, "repair", false, 0],
    [2, "strategy_pivot", false, 1],
    [3, "blocked", true, 1],
  ]);

  const restarted = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  const restored = await restarted.get("recovery-run");
  assert.deepEqual(restored?.recoveryHistory?.map((entry) => [entry.actionId, entry.actionDescription, entry.nextAction]), [
    ["repair-1", "repair candidate", "Repair current strategy and retry: repair candidate"],
    ["pivot-2", "alternate implementation", "Strategy pivot 1: re-plan a different approach"],
    ["blocked-3", "external dependency", "BLOCKED: physical access required"],
  ]);

  const history = await readProductionRecoveryHistory(path, { limit: 10 });
  assert.deepEqual(history.map((entry) => [entry.cycle, entry.action, entry.blocked]), [
    [3, "blocked", true],
    [2, "strategy_pivot", false],
    [1, "repair", false],
  ]);
  assert.equal(JSON.stringify(history).includes(secretEvidence), false);
  assert.equal(history.some((entry) => "evidence" in entry || "humanInterventionHint" in entry), false);
});

test("OPS-005 recovery history is bounded, deterministic and defensive", async () => {
  const path = await historyFile();
  const persisted = {
    version: 1,
    runs: [
      {
        runId: "b-run",
        goal: { title: "b goal" },
        recoveryHistory: [{
          cycle: 1,
          observedAt: "2026-09-21T10:00:00.000Z",
          action: "repair",
          reason: "repair b",
          blocked: false,
          nextStrategyPivot: 0,
          actionId: "b",
          actionDescription: "repair b",
          nextAction: "retry b",
        }],
      },
      {
        runId: "a-run",
        goal: { title: "a goal" },
        recoveryHistory: [{
          cycle: 2,
          observedAt: "2026-09-21T10:00:00.000Z",
          action: "strategy_pivot",
          reason: "pivot a",
          blocked: false,
          nextStrategyPivot: 1,
          actionId: "a",
          actionDescription: "pivot a",
          nextAction: "retry a",
        }],
      },
    ],
  };
  await writeFile(path, `${JSON.stringify(persisted)}\n`, "utf8");

  const limited = await readProductionRecoveryHistory(path, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.runId, "a-run");
  limited[0]!.reason = "caller tampered";

  const reread = await readProductionRecoveryHistory(path, { limit: 1 });
  assert.equal(reread[0]?.reason, "pivot a");
  await assert.rejects(() => readProductionRecoveryHistory(path, { limit: 0 }), /integer from 1 to 200/);
  await assert.rejects(() => readProductionRecoveryHistory(path, { limit: 201 }), /integer from 1 to 200/);
});

test("OPS-005 fails closed on malformed persisted recovery history", async () => {
  const path = await historyFile();
  const malformed = {
    version: 1,
    runs: [{
      runId: "bad-run",
      goal: { title: "bad recovery history", successCriteria: ["verified"], constraints: [] },
      state: "running",
      cycles: 1,
      completionEvidence: [],
      updatedAt: "2026-09-21T10:00:00.000Z",
      recoveryHistory: [{
        cycle: 1,
        observedAt: "not-a-date",
        action: "repair",
        reason: "invalid timestamp",
        blocked: false,
        nextStrategyPivot: 0,
        actionId: null,
        actionDescription: null,
        nextAction: null,
      }],
    }],
  };
  await writeFile(path, `${JSON.stringify(malformed)}\n`, "utf8");

  await assert.rejects(() => readProductionRecoveryHistory(path), /invalid production recovery history file/);
  const runtime = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  await assert.rejects(() => runtime.get("bad-run"), /invalid production recovery history/);
});

test("OPS-005 missing recovery history file is empty rather than fabricated", async () => {
  const path = await historyFile();
  assert.deepEqual(await readProductionRecoveryHistory(path), []);
});
