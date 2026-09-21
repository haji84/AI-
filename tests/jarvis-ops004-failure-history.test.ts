import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { readProductionFailureHistory } from "../src/gai/production-failure-history.ts";
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
  return join(await mkdtemp(join(tmpdir(), "jarvis-failure-history-")), "runs.json");
}

test("OPS-004 persists execution and verification failures across runtime reconstruction", async () => {
  const path = await historyFile();
  const taskGoal = goal("durable failure history");
  const secretEvidence = "raw-verifier-evidence-must-not-leak";
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "exec-1", description: "first execution", capability: "local", risk: "low" },
      result: { actionId: "exec-1", ok: false, summary: "execution failed", blocker: "tool unavailable" },
      stopReason: "continue",
      nextAction: "retry execution",
    }),
    report(taskGoal, {
      action: { id: "verify-2", description: "candidate implementation", capability: "local", risk: "low" },
      result: { actionId: "verify-2", ok: true, summary: "candidate produced" },
      verification: { ok: false, summary: "candidate rejected", evidence: { secretEvidence } },
      stopReason: "continue",
      nextAction: "repair candidate",
    }),
    report(taskGoal, {
      action: { id: "verify-3", description: "repaired implementation", capability: "local", risk: "low" },
      result: { actionId: "verify-3", ok: true, summary: "repair produced" },
      verification: { ok: true, summary: "repair accepted", evidence: { secretEvidence } },
      stopReason: "goal_complete",
      nextAction: null,
    }),
  ]) as never);

  const completed = await runtime.run({ runId: "failure-run", goal: taskGoal });
  assert.equal(completed.state, "completed");
  assert.deepEqual(completed.failureHistory?.map((entry) => [entry.cycle, entry.kind, entry.summary]), [
    [1, "execution", "execution failed"],
    [2, "verification", "candidate rejected"],
  ]);

  const restarted = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  const restored = await restarted.get("failure-run");
  assert.deepEqual(restored?.failureHistory?.map((entry) => [entry.cycle, entry.kind, entry.blocker]), [
    [1, "execution", "tool unavailable"],
    [2, "verification", null],
  ]);

  const history = await readProductionFailureHistory(path, { limit: 10 });
  assert.deepEqual(history.map((entry) => [entry.cycle, entry.kind, entry.actionId]), [
    [2, "verification", "verify-2"],
    [1, "execution", "exec-1"],
  ]);
  assert.equal(JSON.stringify(history).includes(secretEvidence), false);
  assert.equal(history.some((entry) => "evidence" in entry), false);
});

test("OPS-004 records a terminal failure when no lower-level failure exists", async () => {
  const path = await historyFile();
  const taskGoal = goal("terminal failure history");
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "blocked-1", description: "blocked action", capability: "local", risk: "low" },
      stopReason: "blocked",
      nextAction: "manual intervention required",
    }),
  ]) as never);

  const blocked = await runtime.run({ runId: "terminal-run", goal: taskGoal });
  assert.equal(blocked.state, "blocked");
  assert.deepEqual(blocked.failureHistory?.map((entry) => [entry.kind, entry.summary]), [
    ["terminal", "manual intervention required"],
  ]);
});

test("OPS-004 failure history is bounded, deterministic and defensive", async () => {
  const path = await historyFile();
  const taskGoal = goal("bounded failure history");
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "fail-a", description: "failure a", capability: "local", risk: "low" },
      result: { actionId: "fail-a", ok: false, summary: "a failed" },
      stopReason: "continue",
    }),
    report(taskGoal, {
      action: { id: "fail-b", description: "failure b", capability: "local", risk: "low" },
      verification: { ok: false, summary: "b rejected" },
      stopReason: "blocked",
    }),
  ]) as never);
  await runtime.run({ runId: "bounded-run", goal: taskGoal });

  const limited = await readProductionFailureHistory(path, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.cycle, 2);
  limited[0]!.summary = "caller tampered";

  const reread = await readProductionFailureHistory(path, { limit: 1 });
  assert.equal(reread[0]?.summary, "b rejected");
  await assert.rejects(() => readProductionFailureHistory(path, { limit: 0 }), /integer from 1 to 200/);
  await assert.rejects(() => readProductionFailureHistory(path, { limit: 201 }), /integer from 1 to 200/);
});

test("OPS-004 fails closed on malformed persisted failure history", async () => {
  const path = await historyFile();
  const malformed = {
    version: 1,
    runs: [{
      runId: "bad-run",
      goal: { title: "bad failure history", successCriteria: ["verified"], constraints: [] },
      state: "running",
      cycles: 1,
      completionEvidence: [],
      updatedAt: "2026-09-21T09:00:00.000Z",
      failureHistory: [{
        cycle: 1,
        observedAt: "not-a-date",
        kind: "execution",
        summary: "invalid timestamp",
        blocker: null,
        actionId: null,
        actionDescription: null,
      }],
    }],
  };
  await writeFile(path, `${JSON.stringify(malformed)}\n`, "utf8");

  await assert.rejects(() => readProductionFailureHistory(path), /invalid production failure history file/);
  const runtime = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  await assert.rejects(() => runtime.get("bad-run"), /invalid production failure history/);
});

test("OPS-004 missing failure history file is empty rather than fabricated", async () => {
  const path = await historyFile();
  assert.deepEqual(await readProductionFailureHistory(path), []);
});
