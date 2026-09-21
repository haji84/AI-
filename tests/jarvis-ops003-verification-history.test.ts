import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { readProductionVerificationHistory } from "../src/gai/production-verification-history.ts";
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
  return join(await mkdtemp(join(tmpdir(), "jarvis-verification-history-")), "runs.json");
}

test("OPS-003 persists accepted and rejected verifier outcomes across runtime reconstruction", async () => {
  const path = await historyFile();
  const taskGoal = goal("durable verifier history");
  const secretEvidence = "should-not-be-returned-by-history";
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "attempt-1", description: "first implementation", capability: "local", risk: "low" },
      result: { actionId: "attempt-1", ok: true, summary: "implemented first attempt" },
      verification: { ok: false, summary: "first attempt failed verification", evidence: { secretEvidence } },
      stopReason: "continue",
      nextAction: "repair first attempt",
    }),
    report(taskGoal, {
      action: { id: "attempt-2", description: "repaired implementation", capability: "local", risk: "low" },
      result: { actionId: "attempt-2", ok: true, summary: "implemented repair" },
      verification: { ok: true, summary: "repair verified", evidence: { secretEvidence } },
      stopReason: "goal_complete",
      nextAction: null,
    }),
  ]) as never);

  const completed = await runtime.run({ runId: "verify-run", goal: taskGoal });
  assert.equal(completed.state, "completed");
  assert.equal(completed.verificationHistory?.length, 2);

  const restarted = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  const restored = await restarted.get("verify-run");
  assert.deepEqual(restored?.verificationHistory?.map((entry) => [entry.cycle, entry.ok, entry.summary]), [
    [1, false, "first attempt failed verification"],
    [2, true, "repair verified"],
  ]);

  const history = await readProductionVerificationHistory(path, { limit: 10 });
  assert.deepEqual(history.map((entry) => [entry.cycle, entry.ok, entry.actionId]), [
    [2, true, "attempt-2"],
    [1, false, "attempt-1"],
  ]);
  assert.equal(JSON.stringify(history).includes(secretEvidence), false);
  assert.equal(history.some((entry) => "evidence" in entry), false);
});

test("OPS-003 verification history is bounded, deterministic and defensive", async () => {
  const path = await historyFile();
  const taskGoal = goal("bounded verifier history");
  const runtime = new ProductionAutonomyRuntime(path, () => loop([
    report(taskGoal, {
      action: { id: "verify-a", description: "verify a", capability: "local", risk: "low" },
      verification: { ok: false, summary: "a failed" },
      stopReason: "continue",
    }),
    report(taskGoal, {
      action: { id: "verify-b", description: "verify b", capability: "local", risk: "low" },
      verification: { ok: true, summary: "b passed" },
      stopReason: "goal_complete",
    }),
  ]) as never);
  await runtime.run({ runId: "bounded-run", goal: taskGoal });

  const limited = await readProductionVerificationHistory(path, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.cycle, 2);
  limited[0]!.summary = "caller tampered";

  const reread = await readProductionVerificationHistory(path, { limit: 1 });
  assert.equal(reread[0]?.summary, "b passed");
  await assert.rejects(() => readProductionVerificationHistory(path, { limit: 0 }), /integer from 1 to 200/);
  await assert.rejects(() => readProductionVerificationHistory(path, { limit: 201 }), /integer from 1 to 200/);
});

test("OPS-003 fails closed on malformed persisted verification history", async () => {
  const path = await historyFile();
  const malformed = {
    version: 1,
    runs: [{
      runId: "bad-run",
      goal: { title: "bad history", successCriteria: ["verified"], constraints: [] },
      state: "running",
      cycles: 1,
      completionEvidence: [],
      updatedAt: "2026-09-21T09:00:00.000Z",
      verificationHistory: [{
        cycle: 1,
        observedAt: "not-a-date",
        ok: true,
        summary: "invalid timestamp",
        actionId: null,
        actionDescription: null,
      }],
    }],
  };
  await writeFile(path, `${JSON.stringify(malformed)}\n`, "utf8");

  await assert.rejects(() => readProductionVerificationHistory(path), /invalid production verification history file/);
  const runtime = new ProductionAutonomyRuntime(path, () => loop([]) as never);
  await assert.rejects(() => runtime.get("bad-run"), /invalid production verification history/);
});

test("OPS-003 missing history file is empty rather than fabricated", async () => {
  const path = await historyFile();
  assert.deepEqual(await readProductionVerificationHistory(path), []);
});
