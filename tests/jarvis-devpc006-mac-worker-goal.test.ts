import assert from "node:assert/strict";
import test from "node:test";
import {
  createMacWorkerGoalExecutor,
  evaluateMacWorkerGoalEvidence,
  type MacWorkerGoalRequest,
  type MacWorkerStepEvidence,
} from "../src/gai/mac-worker-goal.ts";
import type { DevelopmentToolingBridge } from "../src/gai/development-tooling-capability.ts";

function passingStep(operation: "lint" | "test" | "build", taskId = `goal:${operation}`): MacWorkerStepEvidence {
  return {
    taskId,
    operation,
    workerId: "macbook",
    platform: "macos",
    executionPassed: true,
    verifierPassed: true,
    status: "PASS",
    exitCode: 0,
    checkIds: [`${operation}-check`],
    artifactRefs: [],
  };
}

test("DEV-PC-006 Mac Worker automatically completes a bounded medium quality-gate goal with verifier PASS", async () => {
  const seen: unknown[] = [];
  const bridge: DevelopmentToolingBridge = {
    platform: "macos",
    async execute(request) {
      seen.push(request);
      return {
        ok: true,
        status: "PASS",
        exitCode: 0,
        checkIds: [`${request.operation}-check`],
      };
    },
  };
  const runGoal = createMacWorkerGoalExecutor({
    bridge,
    allowedWorkspaces: ["ai-repo"],
    allowedTargets: ["app"],
  });

  const result = await runGoal({
    goalId: "mac-medium-goal",
    kind: "quality-gate",
    workspace: "ai-repo",
    target: "app",
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.verifierPassed, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.steps.map((step) => step.operation), ["lint", "test", "build"]);
  assert.equal(result.steps.every((step) => step.executionPassed && step.verifierPassed), true);
  assert.deepEqual(seen, [
    { taskId: "mac-medium-goal:lint", operation: "lint", workspace: "ai-repo", target: "app" },
    { taskId: "mac-medium-goal:test", operation: "test", workspace: "ai-repo", target: "app" },
    { taskId: "mac-medium-goal:build", operation: "build", workspace: "ai-repo", target: "app" },
  ]);
});

test("Mac Worker fails closed and stops the goal when a step fails verification", async () => {
  const seen: string[] = [];
  const bridge: DevelopmentToolingBridge = {
    platform: "macos",
    async execute(request) {
      seen.push(request.operation);
      if (request.operation === "test") {
        return { ok: false, status: "TEST_FAILED", exitCode: 1, checkIds: ["test-failed"] };
      }
      return { ok: true, status: "PASS", exitCode: 0, checkIds: [`${request.operation}-check`] };
    },
  };
  const runGoal = createMacWorkerGoalExecutor({ bridge, allowedWorkspaces: ["ai-repo"] });
  const result = await runGoal({
    goalId: "mac-failing-goal",
    kind: "quality-gate",
    workspace: "ai-repo",
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.verifierPassed, false);
  assert.deepEqual(seen, ["lint", "test"]);
  assert.match(result.blockers.join("\n"), /execution failed: test/);
  assert.match(result.blockers.join("\n"), /verifier did not PASS: test/);
  assert.match(result.blockers.join("\n"), /missing operation evidence: build/);
});

test("Mac Worker requires evidence-bearing PASS results instead of trusting bridge success alone", async () => {
  let calls = 0;
  const bridge: DevelopmentToolingBridge = {
    platform: "macos",
    async execute() {
      calls += 1;
      return { ok: true, status: "PASS", exitCode: 0 };
    },
  };
  const runGoal = createMacWorkerGoalExecutor({ bridge, allowedWorkspaces: ["ai-repo"] });
  const result = await runGoal({
    goalId: "mac-no-evidence",
    kind: "quality-gate",
    workspace: "ai-repo",
  });

  assert.equal(result.status, "FAIL");
  assert.equal(calls, 1);
  assert.match(result.blockers.join("\n"), /verifier did not PASS: lint/);
  assert.match(result.blockers.join("\n"), /missing operation evidence: test/);
});

test("goal-level evidence rejects missing, duplicate, unexpected, and non-Mac verifier evidence", () => {
  const missing = evaluateMacWorkerGoalEvidence({ steps: [passingStep("lint"), passingStep("test")] });
  assert.equal(missing.satisfied, false);
  assert.match(missing.blockers.join("\n"), /missing operation evidence: build/);

  const duplicate = evaluateMacWorkerGoalEvidence({
    steps: [passingStep("lint", "one"), passingStep("lint", "two"), passingStep("test"), passingStep("build")],
  });
  assert.equal(duplicate.satisfied, false);
  assert.match(duplicate.blockers.join("\n"), /duplicate operation evidence: lint/);

  const unexpected = evaluateMacWorkerGoalEvidence({
    expectedOperations: ["lint", "test"],
    steps: [passingStep("lint"), passingStep("test"), passingStep("build")],
  });
  assert.equal(unexpected.satisfied, false);
  assert.match(unexpected.blockers.join("\n"), /unexpected operation evidence: build/);

  const wrongWorker = passingStep("build");
  wrongWorker.workerId = "other-worker";
  wrongWorker.platform = "windows";
  const wrongPlatform = evaluateMacWorkerGoalEvidence({
    steps: [passingStep("lint"), passingStep("test"), wrongWorker],
  });
  assert.equal(wrongPlatform.satisfied, false);
  assert.match(wrongPlatform.blockers.join("\n"), /non-Mac worker evidence: build/);
});

test("Mac Worker exposes no arbitrary command surface and rejects unapproved scope before bridge execution", async () => {
  let calls = 0;
  const bridge: DevelopmentToolingBridge = {
    platform: "macos",
    async execute(request) {
      calls += 1;
      return { ok: true, status: "PASS", exitCode: 0, checkIds: [`${request.operation}-check`] };
    },
  };
  const runGoal = createMacWorkerGoalExecutor({
    bridge,
    allowedWorkspaces: ["ai-repo"],
    allowedTargets: ["app"],
  });
  const invalid = [
    { goalId: "unsafe", kind: "quality-gate", workspace: "ai-repo", command: "rm -rf /" },
    { goalId: "outside", kind: "quality-gate", workspace: "../ai-repo" },
    { goalId: "wrong-workspace", kind: "quality-gate", workspace: "other-repo" },
    { goalId: "wrong-target", kind: "quality-gate", workspace: "ai-repo", target: "release" },
    { goalId: "wrong-kind", kind: "shell", workspace: "ai-repo" },
  ];

  for (const request of invalid) {
    await assert.rejects(() => runGoal(request as unknown as MacWorkerGoalRequest), /mac_worker_goal_/);
  }
  assert.equal(calls, 0);
});

test("Mac Worker adapter refuses a non-macOS bridge", () => {
  const bridge: DevelopmentToolingBridge = {
    platform: "windows",
    async execute() {
      return { ok: true, status: "PASS", exitCode: 0, checkIds: ["check"] };
    },
  };
  assert.throws(
    () => createMacWorkerGoalExecutor({ bridge, allowedWorkspaces: ["ai-repo"] }),
    /mac_worker_goal_requires_macos_bridge/,
  );
});
