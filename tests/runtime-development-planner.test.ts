import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeDevelopmentPlanner } from "../src/orchestrator/runtime-development-planner.ts";
import { BaselinePlanner } from "../src/orchestrator/baseline-planner.ts";
import type { Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Implement runtime builder integration",
  description: "Update tests/fixtures/runtime-builder-smoke.txt safely",
  successCriteria: ["runtime builder is verified"],
  constraints: [],
};

const intent = { summary: "implement code change", confidence: 1, evidence: [] };

test("development goal routes to code.builder with scoped files", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({ goal, context: [], intent });
  assert.equal(action?.capability, "code.builder");
  assert.deepEqual((action?.input as { files?: string[] }).files, ["tests/fixtures/runtime-builder-smoke.txt"]);
  assert.match(String((action?.input as { strategyId?: string }).strategyId), /^initial-/);
});

test("failed Builder result creates a different recovery strategy and carries failure signature", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{ source: "state.next_action", summary: "Fix tests/fixtures/runtime-builder-smoke.txt using another implementation" }],
    intent,
    previousResult: { actionId: "a1", ok: false, summary: "Verification failed: wrong content" },
  });
  const input = action?.input as { strategyId?: string; objective?: string; previousFailureSignatures?: string[] };
  assert.match(String(input.strategyId), /^recovery-/);
  assert.match(String(input.objective), /materially different implementation strategy/);
  assert.deepEqual(input.previousFailureSignatures, ["a1:verification failed: wrong content"]);
});

test("non-development goal delegates to baseline planner", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal: { title: "Inspect current status", successCriteria: ["status known"], constraints: [] },
    context: [],
    intent: { summary: "inspect context", confidence: 1, evidence: [] },
  });
  assert.equal(action?.capability, "context.inspect");
});


test("development planner binds Builder success only to implementation DoD", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{
      source: "gai-work-state",
      summary: "work state",
      data: {
        status: "IN_PROGRESS",
        blockers: [],
        remainingDefinitionOfDone: [
          { id: "implement", description: "Implement the requested code change" },
          { id: "tests", description: "All tests and verification pass" },
        ],
      },
    }],
    intent,
  });
  assert.deepEqual((action as { satisfiesDefinitionOfDone?: string[] })?.satisfiesDefinitionOfDone, ["implement"]);
});

test("completed WorkState stops normal development planning", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{
      source: "gai-work-state",
      summary: "completed",
      data: { status: "COMPLETED", blockers: [], remainingDefinitionOfDone: [] },
    }],
    intent,
  });
  assert.equal(action, null);
});


test("Builder wording in implementation DoD is not misclassified as build verification", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{
      source: "gai-work-state",
      summary: "work state",
      data: {
        status: "IN_PROGRESS",
        blockers: [],
        remainingDefinitionOfDone: [
          { id: "criterion-1", description: "Normal JARVIS runtime routes a development action to the real Builder" },
        ],
        nextAction: null,
      },
    }, { source: "state.next_action", summary: "none" }],
    intent,
  });
  assert.deepEqual((action as { satisfiesDefinitionOfDone?: string[] })?.satisfiesDefinitionOfDone, ["criterion-1"]);
  assert.notEqual(action?.description, "none");
});


test("remaining PR/test DoD promotes Builder changes instead of rebuilding", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{
      source: "gai-work-state",
      summary: "verification pending",
      data: {
        status: "VERIFYING",
        blockers: [],
        remainingDefinitionOfDone: [
          { id: "tests", description: "Tests and build pass" },
          { id: "pr", description: "Pull request is created" },
        ],
        nextAction: null,
      },
    }, { source: "state.next_action", summary: "none" }],
    intent,
  });
  assert.equal(action?.capability, "repository.promote_builder_changes");
  assert.deepEqual((action as { satisfiesDefinitionOfDone?: string[] })?.satisfiesDefinitionOfDone, ["tests", "pr"]);
});

test("security or merge DoD is never auto-satisfied by PR promotion", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{
      source: "gai-work-state",
      summary: "security pending",
      data: {
        status: "VERIFYING",
        blockers: [],
        remainingDefinitionOfDone: [
          { id: "security", description: "Security review passes" },
          { id: "merge", description: "PR is merged to main" },
        ],
        nextAction: null,
      },
    }],
    intent,
  });
  assert.notEqual(action?.capability, "repository.promote_builder_changes");
});
