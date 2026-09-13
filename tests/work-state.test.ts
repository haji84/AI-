import assert from "node:assert/strict";
import test from "node:test";
import {
  canCompleteWorkState,
  createHandoffSnapshot,
  mergeDefinitionOfDoneResults,
  remainingDefinitionOfDone,
  validateMutationBinding,
  type WorkState,
} from "../src/orchestrator/work-state.ts";

function baseState(): WorkState {
  return {
    goalId: "goal-1",
    objective: "Carry work across workers",
    definitionOfDone: [
      { id: "dod-1", description: "implementation complete" },
      { id: "dod-2", description: "verification complete" },
    ],
    currentState: "Worker A completed implementation",
    status: "IN_PROGRESS",
    riskClass: "R2",
    constraints: ["no Addness dependency"],
    decisions: [
      { id: "decision-1", summary: "use provider-neutral work state", at: "2026-09-13T00:00:00Z" },
    ],
    artifacts: [
      { id: "artifact-1", uri: "repo://src/example.ts", kind: "code" },
    ],
    verificationResults: [
      { itemId: "dod-1", passed: true, evidence: "tests" },
    ],
    childWorkItems: [
      {
        id: "work-1",
        objective: "Modify implementation",
        definitionOfDone: [{ id: "child-dod-1", description: "change verified" }],
        affectedScope: ["src/example.ts"],
        executionApproach: "edit and test",
        verificationMethod: "node --test",
        status: "IN_PROGRESS",
      },
    ],
    blockers: [],
    nextAction: "verify remaining DoD",
    updatedAt: "2026-09-13T00:00:00Z",
  };
}

test("material mutation requires a bound active work item", () => {
  const state = baseState();

  assert.deepEqual(
    validateMutationBinding({ materialMutation: true }, state),
    { ok: false, reason: "material_mutation_requires_bound_work_item" },
  );

  assert.deepEqual(
    validateMutationBinding({ materialMutation: true, workItemId: "missing" }, state),
    { ok: false, reason: "bound_work_item_not_found" },
  );

  assert.deepEqual(
    validateMutationBinding({ materialMutation: true, workItemId: "work-1" }, state),
    { ok: true },
  );
});

test("handoff snapshot contains only the state needed to resume work", () => {
  const state = baseState();
  const snapshot = createHandoffSnapshot(state);

  assert.equal(snapshot.goalId, "goal-1");
  assert.equal(snapshot.currentState, "Worker A completed implementation");
  assert.deepEqual(snapshot.remainingDefinitionOfDone.map((item) => item.id), ["dod-2"]);
  assert.equal(snapshot.nextAction, "verify remaining DoD");
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.artifacts.length, 1);
});

test("work cannot complete until every required DoD item has evidence", () => {
  const state = baseState();
  assert.equal(canCompleteWorkState(state), false);
  assert.deepEqual(remainingDefinitionOfDone(state).map((item) => item.id), ["dod-2"]);

  const completed = mergeDefinitionOfDoneResults(
    state,
    [{ itemId: "dod-2", passed: true, evidence: "independent verifier" }],
    "2026-09-13T00:10:00Z",
  );

  assert.equal(canCompleteWorkState(completed), true);
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(remainingDefinitionOfDone(completed), []);
});

test("blockers prevent completion even when DoD evidence passes", () => {
  const state = mergeDefinitionOfDoneResults(
    { ...baseState(), blockers: ["external dependency unavailable"] },
    [{ itemId: "dod-2", passed: true }],
    "2026-09-13T00:10:00Z",
  );

  assert.equal(canCompleteWorkState(state), false);
  assert.equal(state.status, "BLOCKED");
});
