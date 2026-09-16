import assert from "node:assert/strict";
import test from "node:test";
import type { ActionResult, Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import {
  WorkStateContextSource,
  WorkStateGuardedExecutor,
  type WorkStateAction,
} from "../src/orchestrator/work-state-integration.ts";
import type { WorkEvent, WorkState, WorkStateStore } from "../src/orchestrator/work-state.ts";

const goal: Goal = {
  title: "Complete a bounded P7 change",
  description: "Change one scoped artifact and verify it",
  successCriteria: ["scoped change is independently verified"],
  constraints: ["do not leak agent-local context"],
};

class MemoryWorkStateStore implements WorkStateStore {
  state: WorkState | null = null;
  events: WorkEvent[] = [];

  async get(goalId: string): Promise<WorkState | null> {
    return this.state?.goalId === goalId ? structuredClone(this.state) : null;
  }

  async put(state: WorkState): Promise<void> {
    this.state = structuredClone(state);
  }

  async appendEvent(_goalId: string, event: WorkEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

async function initializedStore(): Promise<MemoryWorkStateStore> {
  const store = new MemoryWorkStateStore();
  await new WorkStateContextSource(store).collect({ goal });
  return store;
}

test("unbound material mutation creates a complete bounded child work item before execution", async () => {
  const store = await initializedStore();
  let observedChild: WorkState["childWorkItems"][number] | undefined;
  const inner = {
    async execute(action: ProposedAction): Promise<ActionResult> {
      observedChild = store.state?.childWorkItems.find((item) => item.id === (action as WorkStateAction).workItemId);
      return { actionId: action.id, ok: true, summary: "executed after child gate" };
    },
  };
  const guarded = new WorkStateGuardedExecutor(inner, store, goal);
  const action: WorkStateAction = {
    id: "edit-scoped-file",
    description: "update bounded implementation",
    capability: "code.edit",
    risk: "low",
    input: { files: [{ path: "src/orchestrator/example.ts" }] },
  };

  const result = await guarded.execute(action, []);

  assert.equal(result.ok, true);
  assert.equal(action.workItemId, "action-edit-scoped-file");
  assert.ok(observedChild);
  assert.equal(observedChild.status, "IN_PROGRESS");
  assert.equal(observedChild.objective, action.description);
  assert.deepEqual(observedChild.affectedScope, ["src/orchestrator/example.ts"]);
  assert.deepEqual(observedChild.definitionOfDone, [{
    id: "action-edit-scoped-file-verified",
    description: "Goal Loop verifier accepts the action result",
  }]);
  assert.equal(observedChild.executionApproach, "Execute through capability code.edit");
  assert.equal(observedChild.verificationMethod, "Goal Loop verifier evidence");
});

test("material mutation rejects unknown and inactive child work item bindings", async () => {
  const store = await initializedStore();
  let executions = 0;
  const guarded = new WorkStateGuardedExecutor({
    async execute(action: ProposedAction): Promise<ActionResult> {
      executions += 1;
      return { actionId: action.id, ok: true, summary: "must not execute" };
    },
  }, store, goal);

  const unknown = await guarded.execute({
    id: "unknown-binding",
    description: "mutate with unknown binding",
    capability: "code.edit",
    risk: "low",
    workItemId: "missing-child",
  } as WorkStateAction, []);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.blocker, "bound_work_item_not_found");

  store.state!.childWorkItems.push({
    id: "completed-child",
    objective: "already finished",
    definitionOfDone: [{ id: "done", description: "verified" }],
    affectedScope: ["src/orchestrator/example.ts"],
    executionApproach: "edit",
    verificationMethod: "tests",
    status: "COMPLETED",
  });
  const inactive = await guarded.execute({
    id: "inactive-binding",
    description: "mutate with inactive binding",
    capability: "code.edit",
    risk: "low",
    workItemId: "completed-child",
  } as WorkStateAction, []);
  assert.equal(inactive.ok, false);
  assert.equal(inactive.blocker, "bound_work_item_not_active");
  assert.equal(executions, 0);
});

test("planner-facing Work-State context is an explicit handoff partition, not the mutable WorkState record", async () => {
  const store = await initializedStore();
  store.state!.riskClass = "R2";
  store.state!.verificationResults = [{ itemId: "criterion-1", passed: false, evidence: "raw-verifier-detail" }];
  store.state!.childWorkItems.push({
    id: "private-child-detail",
    objective: "bounded internal mutation",
    definitionOfDone: [{ id: "child-dod", description: "verified" }],
    affectedScope: ["src/private-detail.ts"],
    executionApproach: "internal plan",
    verificationMethod: "internal verifier detail",
    status: "IN_PROGRESS",
  });

  const [context] = await new WorkStateContextSource(store).collect({ goal });
  assert.equal(context.source, "gai-work-state");
  assert.ok(context.data && typeof context.data === "object");

  const shared = context.data as Record<string, unknown>;
  assert.deepEqual(Object.keys(shared).sort(), [
    "artifacts",
    "blockers",
    "currentState",
    "decisions",
    "goalId",
    "nextAction",
    "objective",
    "remainingDefinitionOfDone",
    "status",
    "updatedAt",
  ].sort());
  assert.equal("childWorkItems" in shared, false);
  assert.equal("verificationResults" in shared, false);
  assert.equal("riskClass" in shared, false);
  assert.equal("constraints" in shared, false);
  assert.equal(JSON.stringify(shared).includes("raw-verifier-detail"), false);
  assert.equal(JSON.stringify(shared).includes("src/private-detail.ts"), false);
});
