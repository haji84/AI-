import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { readProductionTaskHistory } from "../src/gai/production-task-history.ts";
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
  return join(await mkdtemp(join(tmpdir(), "jarvis-task-history-")), "runs.json");
}

test("OPS-001 returns bounded durable task history newest-first after runtime reconstruction", async () => {
  const path = await historyFile();
  const olderGoal = goal("older task");
  const newerGoal = goal("newer task");

  const first = new ProductionAutonomyRuntime(path, () => loop([
    report(olderGoal, {
      stopReason: "goal_complete",
      action: { id: "complete-old", description: "complete old", capability: "local", risk: "low" },
      verification: { ok: true, summary: "old task verified", evidence: { task: "old" } },
    }),
  ]) as never);
  await first.run({ runId: "task-old", goal: olderGoal });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const restarted = new ProductionAutonomyRuntime(path, () => loop([
    report(newerGoal, { stopReason: "blocked", nextAction: "wait for a future safe strategy" }),
  ]) as never);
  await restarted.run({ runId: "task-new", goal: newerGoal });

  const limited = await readProductionTaskHistory(path, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.runId, "task-new");
  assert.equal(limited[0]?.state, "blocked");

  const history = await readProductionTaskHistory(path, { limit: 10 });
  assert.deepEqual(history.map((item) => item.runId), ["task-new", "task-old"]);
  assert.equal(history[1]?.state, "completed");
  assert.deepEqual(history[1]?.completionEvidence, [{ task: "old" }]);
});

test("OPS-001 history reads are defensive and cannot mutate persisted task records", async () => {
  const path = await historyFile();
  const taskGoal = goal("immutable history source");
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, { stopReason: "goal_complete", action: null }),
  ]) as never);
  await runtime.run({ runId: "task-defensive", goal: taskGoal });

  const firstRead = await readProductionTaskHistory(path);
  firstRead[0]!.goal.title = "tampered in caller";
  firstRead[0]!.completionEvidence.push({ injected: true });

  const secondRead = await readProductionTaskHistory(path);
  assert.equal(secondRead[0]?.goal.title, "immutable history source");
  assert.deepEqual(secondRead[0]?.completionEvidence, []);
});

test("OPS-001 task history fails closed on invalid limits or malformed persisted envelopes", async () => {
  const path = await historyFile();
  await assert.rejects(() => readProductionTaskHistory(path, { limit: 0 }), /integer from 1 to 200/);
  await assert.rejects(() => readProductionTaskHistory(path, { limit: 201 }), /integer from 1 to 200/);

  await writeFile(path, `${JSON.stringify({ version: 2, runs: [] })}\n`, "utf8");
  await assert.rejects(() => readProductionTaskHistory(path), /invalid production task history file/);
});

test("OPS-001 missing history file is an empty history, not a fabricated task", async () => {
  const path = await historyFile();
  assert.deepEqual(await readProductionTaskHistory(path), []);
});
