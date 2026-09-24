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
  assert.deepEqual((action?.input as { verificationContract?: unknown }).verificationContract, {
    kind: "repository_checks",
    profile: "standard",
  });
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


test("repository check verification can satisfy automated test/build DoD without claiming review or deploy", async () => {
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
          { id: "tests", description: "Lint, tests, security verification and build pass" },
          { id: "review", description: "Open a reviewed pull request" },
          { id: "deploy", description: "Deploy to Production" },
        ],
      },
    }],
    intent,
  });
  assert.deepEqual((action as { satisfiesDefinitionOfDone?: string[] })?.satisfiesDefinitionOfDone, ["implement", "tests"]);
});

test("exact-file Builder verification does not claim repository-wide test DoD", async () => {
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
    }, {
      source: "development.verification_contract",
      summary: "trusted exact-file oracle",
      data: { kind: "file_exact", path: "tests/fixtures/runtime-builder-smoke.txt", expected: "verified" },
    }],
    intent,
  });
  assert.deepEqual((action?.input as { verificationContract?: unknown }).verificationContract, {
    kind: "file_exact", path: "tests/fixtures/runtime-builder-smoke.txt", expected: "verified",
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


test("exact-content development goal emits a deterministic file verification contract", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const exactGoal: Goal = {
    title: "Implement exact fixture",
    description: "Edit only tests/fixtures/exact.txt. Make its complete content exactly runtime-daily. Do not modify any other file.",
    successCriteria: ["Implement the requested code change"],
    constraints: [],
  };
  const action = await planner.proposeNextAction({
    goal: exactGoal,
    context: [{ source: "state.next_action", summary: "Initial strategy: make tests/fixtures/exact.txt runtime-wrong" }],
    intent,
  });
  const input = action?.input as { verificationContract?: unknown };
  assert.deepEqual(input.verificationContract, {
    kind: "file_exact",
    path: "tests/fixtures/exact.txt",
    expected: "runtime-daily",
  });
});

test("runtime Builder action id stays stable across recovery attempts", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const first = await planner.proposeNextAction({ goal, context: [], intent });
  const second = await planner.proposeNextAction({
    goal,
    context: [{ source: "state.next_action", summary: "Retry implementation" }],
    intent,
    previousResult: { actionId: first?.id ?? "missing", ok: false, summary: "verification failed" },
  });
  assert.equal(first?.id, second?.id);
});


test("trusted verification oracle is consumed even when expected value is absent from goal text", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const oracleGoal: Goal = {
    title: "Implement controlled fixture",
    description: "Edit only tests/fixtures/oracle.txt using the current implementation strategy.",
    successCriteria: ["Implement the requested controlled change"],
    constraints: [],
  };
  const action = await planner.proposeNextAction({
    goal: oracleGoal,
    context: [
      { source: "state.next_action", summary: "Initial strategy: make tests/fixtures/oracle.txt runtime-wrong" },
      {
        source: "unified-entry:1",
        summary: "trusted deterministic oracle",
        data: {
          source: "development.verification_contract",
          data: { kind: "file_exact", path: "tests/fixtures/oracle.txt", expected: "runtime-daily" },
        },
      },
    ],
    intent,
  });
  assert.deepEqual((action?.input as { verificationContract?: unknown }).verificationContract, {
    kind: "file_exact",
    path: "tests/fixtures/oracle.txt",
    expected: "runtime-daily",
  });
});

test("recovery objective uses verifier evidence only after failure", async () => {
  const planner = new RuntimeDevelopmentPlanner(new BaselinePlanner());
  const action = await planner.proposeNextAction({
    goal,
    context: [{ source: "state.next_action", summary: "Retry tests/fixtures/runtime-builder-smoke.txt" }],
    intent,
    previousResult: {
      actionId: "a1",
      ok: false,
      summary: "Verification failed",
      evidence: { kind: "file_exact", path: "tests/fixtures/runtime-builder-smoke.txt", expected: "runtime-daily", actual: "runtime-wrong" },
    },
  });
  const objective = String((action?.input as { objective?: string }).objective);
  assert.match(objective, /runtime-daily/);
  assert.match(objective, /runtime-wrong/);
  assert.match(objective, /available only after failure/);
});
