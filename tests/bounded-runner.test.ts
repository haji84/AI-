import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import {
  DefaultApprovalPolicy,
  GoalDrivenLoop,
  type ActionResult,
  type CapabilityExecutor,
  type CycleReport,
  type Goal,
  type InferredIntent,
  type Planner,
  type ProposedAction,
  type Verifier,
} from "../src/orchestrator/goal-loop.ts";

test("Compass adapter reads goal and durably writes cycle state", async () => {
  const compass = new CompassStore(":memory:");
  const storedGoal = compass.setGoal({
    title: "Ship autonomous loop",
    description: "Keep moving until a bounded stop condition",
    successCriteria: ["tests pass"],
    constraints: ["human gate"],
  });
  const goal = compassGoalToLoopGoal(storedGoal);
  assert.deepEqual(goal.successCriteria, ["tests pass"]);

  const adapter = new CompassStateStoreAdapter(compass);
  await adapter.writeBack({
    goal,
    intent: { summary: "continue implementation", confidence: 0.9, evidence: [] },
    action: { id: "a1", description: "implement adapter", capability: "code", risk: "low" },
    result: { actionId: "a1", ok: true, summary: "adapter implemented" },
    verification: { ok: true, summary: "tests pass" },
    stopReason: "continue",
    nextAction: "implement runner",
  });

  const state = compass.getState();
  assert.equal(state.nextAction, "implement runner");
  assert.deepEqual(state.completed, ["implement adapter"]);
  assert.equal(compass.getHistory(1)[0]?.taskStatus, "continue");
  compass.close();
});

test("bounded runner stops at approval_required", async () => {
  const goal: Goal = { title: "Goal", successCriteria: [], constraints: [] };
  let calls = 0;
  const fakeLoop = {
    async runCycle(): Promise<CycleReport> {
      calls += 1;
      return {
        goal,
        intent: { summary: "intent", confidence: 1, evidence: [] },
        stopReason: calls === 2 ? "approval_required" : "continue",
        nextAction: "merge",
        contextSources: [],
      };
    },
  } as unknown as GoalDrivenLoop;

  const report = await runBoundedGoalLoop(fakeLoop, goal, { maxCycles: 10 });
  assert.equal(calls, 2);
  assert.equal(report.stopReason, "approval_required");
});

test("representative multi-step Compass job pauses only at Human Gate and resumes after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "p7-human-gate-e2e-"));
  const dbPath = join(directory, "compass.db");
  const executed: string[] = [];

  const actions: ProposedAction[] = [
    {
      id: "collect",
      description: "collect local inputs",
      capability: "data.collect",
      risk: "low",
    },
    {
      id: "analyze",
      description: "analyze local inputs",
      capability: "data.analyze",
      risk: "low",
    },
    {
      id: "publish",
      description: "publish reviewed result",
      capability: "artifact.publish",
      risk: "low",
      requiresHumanApproval: true,
    },
    {
      id: "verify-final",
      description: "verify final deliverable",
      capability: "artifact.verify",
      risk: "low",
      completesBoundedCommand: true,
    },
  ];

  const executor: CapabilityExecutor = {
    async execute(action): Promise<ActionResult> {
      executed.push(action.id);
      return { actionId: action.id, ok: true, summary: `${action.id} completed`, evidence: { actionId: action.id } };
    },
  };
  const verifier: Verifier = {
    async verify({ action }) {
      return { ok: true, summary: `${action.id} verified`, evidence: { actionId: action.id } };
    },
  };

  function plannerFor(compass: CompassStore): Planner {
    return {
      async inferIntent(): Promise<InferredIntent> {
        return { summary: "complete representative P7 job", confidence: 1, evidence: [] };
      },
      async proposeNextAction(): Promise<ProposedAction | null> {
        const completed = new Set(
          compass.getState().completed.filter((value): value is string => typeof value === "string"),
        );
        return actions.find((action) => !completed.has(action.description)) ?? null;
      },
    };
  }

  function loopFor(compass: CompassStore, approvedActionKey?: string): GoalDrivenLoop {
    return new GoalDrivenLoop(
      plannerFor(compass),
      [],
      executor,
      verifier,
      new CompassStateStoreAdapter(compass),
      new DefaultApprovalPolicy(),
      { approvedActionKey },
    );
  }

  let compass: CompassStore | null = new CompassStore(dbPath);
  try {
    const storedGoal = compass.setGoal({
      title: "Representative P7 job",
      successCriteria: ["all steps verified"],
      constraints: ["publish requires Human Gate"],
    });
    const goal = compassGoalToLoopGoal(storedGoal);

    const beforeApproval = await runBoundedGoalLoop(loopFor(compass), goal, { maxCycles: 10 });
    assert.equal(beforeApproval.stopReason, "approval_required");
    assert.deepEqual(beforeApproval.cycles.map((cycle) => cycle.action?.id), ["collect", "analyze", "publish"]);
    assert.deepEqual(executed, ["collect", "analyze"]);
    assert.equal(beforeApproval.cycles.at(-1)?.approvalSatisfied, false);
    const approvalKey = beforeApproval.cycles.at(-1)?.approvalKey;
    assert.ok(approvalKey);
    assert.deepEqual(compass.getState().completed, ["collect local inputs", "analyze local inputs"]);
    assert.equal(compass.getState().nextAction, "publish reviewed result");

    compass.close();
    compass = null;

    compass = new CompassStore(dbPath);
    assert.deepEqual(compass.getState().completed, ["collect local inputs", "analyze local inputs"]);
    assert.equal(compass.getState().nextAction, "publish reviewed result");

    const afterApproval = await runBoundedGoalLoop(loopFor(compass, approvalKey), goal, { maxCycles: 10 });
    assert.equal(afterApproval.stopReason, "goal_complete");
    assert.deepEqual(afterApproval.cycles.map((cycle) => cycle.action?.id), ["publish", "verify-final"]);
    assert.equal(afterApproval.cycles[0]?.approvalSatisfied, true);
    assert.deepEqual(executed, ["collect", "analyze", "publish", "verify-final"]);
    assert.deepEqual(compass.getState().completed, [
      "collect local inputs",
      "analyze local inputs",
      "publish reviewed result",
      "verify final deliverable",
    ]);
    assert.equal(compass.getState().nextAction, null);
    assert.equal(compass.getState().status, "goal_complete");

    const history = compass.getHistory(10);
    assert.equal(history.length, 5);
    assert.deepEqual(history.map((entry) => entry.taskStatus), [
      "goal_complete",
      "continue",
      "approval_required",
      "continue",
      "continue",
    ]);
  } finally {
    compass?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded runner cannot exceed cycle budget", async () => {
  const goal: Goal = { title: "Goal", successCriteria: [], constraints: [] };
  let calls = 0;
  const fakeLoop = {
    async runCycle(): Promise<CycleReport> {
      calls += 1;
      return {
        goal,
        intent: { summary: "intent", confidence: 1, evidence: [] },
        stopReason: "continue",
        nextAction: "next",
        contextSources: [],
      };
    },
  } as unknown as GoalDrivenLoop;

  const report = await runBoundedGoalLoop(fakeLoop, goal, { maxCycles: 3 });
  assert.equal(calls, 3);
  assert.equal(report.stopReason, "cycle_budget_exhausted");
});
