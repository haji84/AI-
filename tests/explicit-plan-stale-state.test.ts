import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassStateStoreAdapter } from "../src/orchestrator/compass-state-store.ts";
import {
  GoalDrivenLoop,
  type ActionResult,
  type ContextItem,
  type ContextSource,
  type Goal,
  type InferredIntent,
  type Planner,
  type ProposedAction,
  type StateStore,
  type VerificationResult,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Run persisted explicit plan",
  successCriteria: ["PR proposal executes"],
  constraints: ["preserve Human Gate"],
};

const action: ProposedAction = {
  id: "explicit-plan",
  description: "Create bounded smoke PR",
  capability: "repository.propose_pr",
  risk: "low",
  externalSideEffect: true,
};

class CapturingStore implements StateStore {
  record: WriteBackRecord | null = null;

  async getState() {
    return {
      completed: [],
      blockers: ["proposal_failed"],
      nextAction: "stale frontend regression action",
      retriesForCurrentAction: 0,
    };
  }

  async writeBack(record: WriteBackRecord) {
    this.record = record;
  }
}

class ExplicitPlanner implements Planner {
  readonly supersedesPriorExecutionState = true;

  async inferIntent(): Promise<InferredIntent> {
    return { summary: "use explicit plan", confidence: 1, evidence: [] };
  }

  async proposeNextAction(): Promise<ProposedAction> {
    return action;
  }
}

test("explicit plan ignores stale blockers and stale nextAction for the new cycle", async () => {
  let collectedNextAction: string | null | undefined = "unset";
  const source: ContextSource = {
    name: "capture",
    async collect(input): Promise<ContextItem[]> {
      collectedNextAction = input.nextAction;
      return [];
    },
  };
  const store = new CapturingStore();
  const loop = new GoalDrivenLoop(
    new ExplicitPlanner(),
    [source],
    {
      async execute(): Promise<ActionResult> {
        return { actionId: action.id, ok: true, summary: "created" };
      },
    },
    {
      async verify(): Promise<VerificationResult> {
        return { ok: true, summary: "verified" };
      },
    },
    store,
  );

  const report = await loop.runCycle({ goal });

  assert.equal(collectedNextAction, null);
  assert.equal(report.stopReason, "continue");
  assert.equal(report.action?.capability, "repository.propose_pr");
  assert.equal(store.record?.verification?.ok, true);
});

test("ordinary planner still stops on existing blockers", async () => {
  let proposed = false;
  const planner: Planner = {
    async inferIntent() {
      return { summary: "normal", confidence: 1, evidence: [] };
    },
    async proposeNextAction() {
      proposed = true;
      return action;
    },
  };
  const loop = new GoalDrivenLoop(
    planner,
    [],
    { async execute() { throw new Error("must not execute"); } },
    { async verify() { throw new Error("must not verify"); } },
    new CapturingStore(),
  );

  const report = await loop.runCycle({ goal });
  assert.equal(proposed, false);
  assert.equal(report.stopReason, "blocked");
  assert.equal(report.nextAction, "stale frontend regression action");
});

test("successful verified execution clears blockers from Compass current state", async () => {
  const compass = new CompassStore(":memory:");
  compass.updateState({ blockers: ["local_runtime_required", "proposal_failed"], nextAction: "stale" });
  const adapter = new CompassStateStoreAdapter(compass);

  await adapter.writeBack({
    goal,
    intent: { summary: "explicit", confidence: 1, evidence: [] },
    action,
    result: { actionId: action.id, ok: true, summary: "created" },
    verification: { ok: true, summary: "verified" },
    stopReason: "continue",
    nextAction: null,
  });

  const state = compass.getState();
  assert.deepEqual(state.blockers, []);
  assert.equal(state.nextAction, null);
  compass.close();
});
