import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import type { CycleReport, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "ship verified work",
  successCriteria: ["verification passes", "deliverable is recorded"],
  constraints: ["preserve Human Gates"],
};
const intent = { summary: "finish safely", confidence: 1, evidence: [] };

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return { goal, intent, stopReason: "continue", contextSources: [], ...overrides };
}

function loop(reports: CycleReport[]) {
  let index = 0;
  return { runCycle: async () => reports[Math.min(index++, reports.length - 1)]! };
}

async function file() {
  return join(await mkdtemp(join(tmpdir(), "jarvis-p7-journal-")), "runs.json");
}

test("canonical run journal persists Goal, DoD, state, decisions, verified deliverables and next action across restart", async () => {
  const path = await file();
  const verified = report({
    action: { id: "write", description: "write report", capability: "local", risk: "low" },
    result: { actionId: "write", ok: true, summary: "report written" },
    verification: { ok: true, summary: "report independently verified", evidence: { artifact: "report" } },
    nextAction: "continue with release checks",
  });
  const first = new ProductionAutonomyRuntime(path, () => loop([verified]) as never);
  const result = await first.run({ runId: "journal", goal, maxCycles: 1 });

  assert.equal(result.state, "waiting");
  assert.equal(result.journal?.goal, goal.title);
  assert.deepEqual(result.journal?.definitionOfDone, goal.successCriteria);
  assert.equal(result.journal?.currentState, "report independently verified");
  assert.deepEqual(result.journal?.decisions, ["Verifier accepted: report independently verified"]);
  assert.deepEqual(result.journal?.deliverables, ["write report: report independently verified"]);
  assert.equal(result.journal?.nextAction, "continue with release checks");

  const restarted = new ProductionAutonomyRuntime(path, () => loop([report()]) as never);
  const restored = await restarted.get("journal");
  assert.deepEqual(restored?.journal, result.journal);
});

test("unverified work never enters durable deliverables", async () => {
  const unverified = report({
    action: { id: "unsafe-claim", description: "claim completion", capability: "local", risk: "low" },
    result: { actionId: "unsafe-claim", ok: true, summary: "candidate output exists" },
    verification: { ok: false, summary: "evidence missing" },
    nextAction: "collect real evidence",
  });
  const runtime = new ProductionAutonomyRuntime(await file(), () => loop([unverified]) as never);
  const result = await runtime.run({ runId: "negative", goal, maxCycles: 1 });

  assert.deepEqual(result.journal?.deliverables, []);
  assert.equal(result.journal?.currentState, "evidence missing");
  assert.equal(result.journal?.nextAction, "collect real evidence");
});

test("durable journal stays bounded during long verified runs", async () => {
  const reports = Array.from({ length: 55 }, (_, index) => report({
    action: { id: `a-${index}`, description: `deliver ${index}`, capability: "local", risk: "low" },
    result: { actionId: `a-${index}`, ok: true, summary: `result ${index}` },
    verification: { ok: true, summary: `verified ${index}` },
    nextAction: index === 54 ? "continue" : `next ${index + 1}`,
  }));
  const runtime = new ProductionAutonomyRuntime(await file(), () => loop(reports) as never);
  const result = await runtime.run({ runId: "bounded", goal, maxCycles: reports.length });

  assert.equal(result.journal?.decisions.length, 50);
  assert.equal(result.journal?.deliverables.length, 50);
  assert.equal(result.journal?.decisions[0], "Verifier accepted: verified 5");
  assert.equal(result.journal?.deliverables[0], "deliver 5: verified 5");
  assert.equal(result.journal?.deliverables.at(-1), "deliver 54: verified 54");
});

test("legacy version-1 run files without a journal are reconstructed conservatively", async () => {
  const path = await file();
  await writeFile(path, `${JSON.stringify({
    version: 1,
    runs: [{
      runId: "legacy",
      goal,
      state: "waiting",
      cycles: 0,
      completionEvidence: [],
      updatedAt: "2026-09-16T00:00:00.000Z",
    }],
  })}\n`, "utf8");

  const runtime = new ProductionAutonomyRuntime(path, () => loop([report()]) as never);
  const restored = await runtime.get("legacy");
  assert.equal(restored?.journal?.goal, goal.title);
  assert.deepEqual(restored?.journal?.definitionOfDone, goal.successCriteria);
  assert.equal(restored?.journal?.currentState, "waiting");
  assert.deepEqual(restored?.journal?.decisions, []);
  assert.deepEqual(restored?.journal?.deliverables, []);
  assert.equal(restored?.journal?.nextAction, null);
});
