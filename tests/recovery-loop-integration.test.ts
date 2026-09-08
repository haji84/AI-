import assert from "node:assert/strict";
import test from "node:test";
import {
  GoalDrivenLoop,
  type ActionResult,
  type Goal,
  type ProposedAction,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Recover autonomously",
  successCriteria: ["finish without repeating the same failed repair forever"],
  constraints: ["preserve Human Gate"],
};

const action: ProposedAction = {
  id: "build-app",
  description: "Build the application",
  capability: "build",
  risk: "low",
};

function createFailingLoop(resultFactory: (call: number) => ActionResult) {
  let calls = 0;
  const records: WriteBackRecord[] = [];
  const previousResults: Array<ActionResult | null | undefined> = [];
  const loop = new GoalDrivenLoop(
    {
      inferIntent: async () => ({ summary: "complete the build", confidence: 1, evidence: [] }),
      proposeNextAction: async ({ previousResult }) => {
        previousResults.push(previousResult);
        return action;
      },
    },
    [],
    {
      execute: async () => {
        calls += 1;
        return resultFactory(calls);
      },
    },
    { verify: async () => ({ ok: true, summary: "verified" }) },
    {
      getState: async () => ({ completed: [], blockers: [] }),
      writeBack: async (record) => { records.push(record); },
    },
  );
  return { loop, records, previousResults, calls: () => calls };
}

test("same implementation failure pivots after three attempts instead of retry_exhausted", async () => {
  const harness = createFailingLoop(() => ({
    actionId: action.id,
    ok: false,
    summary: "build missing import",
  }));

  const first = await harness.loop.runCycle({ goal });
  const second = await harness.loop.runCycle({ goal });
  const third = await harness.loop.runCycle({ goal });

  assert.equal(first.recoveryDecision?.action, "repair");
  assert.equal(second.recoveryDecision?.action, "repair");
  assert.equal(third.recoveryDecision?.action, "strategy_pivot");
  assert.equal(third.stopReason, "continue");
  assert.match(third.nextAction ?? "", /Strategy pivot 1/);
  assert.notEqual(third.stopReason, "retry_exhausted");
  assert.equal(harness.calls(), 3);
  assert.equal(harness.previousResults[1]?.summary, "build missing import");
});

test("two pivots are allowed before total recovery budget blocks the task", async () => {
  const harness = createFailingLoop(() => ({
    actionId: action.id,
    ok: false,
    summary: "runtime assertion failed",
  }));

  const reports = [];
  for (let index = 0; index < 9; index += 1) {
    reports.push(await harness.loop.runCycle({ goal }));
  }

  assert.equal(reports[2]?.recoveryDecision?.action, "strategy_pivot");
  assert.equal(reports[5]?.recoveryDecision?.action, "strategy_pivot");
  assert.equal(reports[8]?.recoveryDecision?.action, "blocked");
  assert.equal(reports[8]?.stopReason, "blocked");
  assert.match(reports[8]?.nextAction ?? "", /Human intervention/);
});

test("explicit environment blocker stops immediately without burning three retries", async () => {
  const harness = createFailingLoop(() => ({
    actionId: action.id,
    ok: false,
    summary: "Windows executable verification cannot run here",
    blocker: "A Windows workstation is required",
  }));

  const report = await harness.loop.runCycle({ goal });
  assert.equal(report.recoveryDecision?.action, "blocked");
  assert.equal(report.stopReason, "blocked");
  assert.match(report.nextAction ?? "", /Windows workstation/);
  assert.equal(harness.calls(), 1);
});

test("verification failures enter repair recovery instead of becoming an immediate terminal block", async () => {
  let verifyCalls = 0;
  const loop = new GoalDrivenLoop(
    {
      inferIntent: async () => ({ summary: "verify safely", confidence: 1, evidence: [] }),
      proposeNextAction: async () => action,
    },
    [],
    { execute: async () => ({ actionId: action.id, ok: true, summary: "build succeeded" }) },
    {
      verify: async () => {
        verifyCalls += 1;
        return { ok: false, summary: "test assertion failed" };
      },
    },
    {
      getState: async () => ({ completed: [], blockers: [] }),
      writeBack: async () => undefined,
    },
  );

  const report = await loop.runCycle({ goal });
  assert.equal(report.recoveryDecision?.action, "repair");
  assert.equal(report.stopReason, "continue");
  assert.match(report.nextAction ?? "", /Repair current strategy/);
  assert.equal(verifyCalls, 1);
});
