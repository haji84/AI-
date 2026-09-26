import assert from "node:assert/strict";
import test from "node:test";
import {
  DevelopmentJobStateController,
  createDevelopmentJob,
  type DevelopmentJobCreateInput,
} from "../src/orchestrator/development-job.ts";

function input(): DevelopmentJobCreateInput {
  return {
    jobId: "dev-job-1",
    goalId: "goal-681",
    requirementIds: ["CORE-014"],
    acceptanceCriteria: ["local-only development is verified"],
    definitionOfDone: [
      { id: "dod-code", description: "implementation exists", required: true },
      { id: "dod-test", description: "independent tests pass", required: true },
    ],
    baseRevision: "a".repeat(40),
    approvalScope: { taskScopeId: "issue-681", maxRisk: "medium" },
    workItems: [
      {
        id: "work-1",
        objective: "implement durable development state",
        dependsOn: [],
        requiredCapabilities: ["code-builder"],
      },
    ],
  };
}

test("development job requires authoritative goal, DoD, base revision, approval scope, and work", () => {
  for (const invalid of [
    { ...input(), goalId: "" },
    { ...input(), definitionOfDone: [] },
    { ...input(), baseRevision: "not-a-revision" },
    { ...input(), approvalScope: { taskScopeId: "", maxRisk: "medium" as const } },
    { ...input(), workItems: [] },
  ]) {
    assert.throws(() => createDevelopmentJob(invalid), /required|invalid/i);
  }
});
test("state controller commits legal append-only idempotent transitions", () => {
  const controller = new DevelopmentJobStateController();
  const created = createDevelopmentJob(input(), new Date("2026-09-26T00:00:00.000Z"));
  const planning = controller.apply(created, {
    transitionId: "transition-1",
    actor: "state-controller",
    to: "PLANNING",
    reason: "goal accepted",
    at: "2026-09-26T00:01:00.000Z",
  });
  assert.equal(planning.phase, "PLANNING");
  assert.equal(planning.history.length, 2);

  const replay = controller.apply(planning, {
    transitionId: "transition-1",
    actor: "state-controller",
    to: "PLANNING",
    reason: "goal accepted",
    at: "2026-09-26T00:01:00.000Z",
  });
  assert.deepEqual(replay, planning);
  assert.throws(() => controller.apply(planning, {
    transitionId: "transition-2",
    actor: "builder",
    to: "IMPLEMENTING",
    reason: "builder requested authority",
    at: "2026-09-26T00:02:00.000Z",
  }), /state controller/i);
  assert.throws(() => controller.apply(planning, {
    transitionId: "transition-3",
    actor: "state-controller",
    to: "COMPLETED",
    reason: "skip verification",
    at: "2026-09-26T00:03:00.000Z",
  }), /illegal transition/i);
});

test("completion without every required independent evidence item blocks", () => {
  const controller = new DevelopmentJobStateController();
  let job = createDevelopmentJob(input());
  for (const [transitionId, to] of [
    ["t-plan", "PLANNING"],
    ["t-build", "IMPLEMENTING"],
    ["t-verify", "VERIFYING"],
  ] as const) {
    job = controller.apply(job, { transitionId, actor: "state-controller", to, reason: to });
  }
  job = controller.apply(job, {
    transitionId: "t-complete",
    actor: "state-controller",
    to: "COMPLETED",
    reason: "builder says done",
    evidence: [{ id: "e-code", criterionId: "dod-code", kind: "test", issuer: "builder", verified: true }],
  });
  assert.equal(job.phase, "BLOCKED");
  assert.deepEqual(job.blockers, ["missing_verified_evidence:dod-test"]);
});

test("connectivity, recovery, publication, and Human Gate are distinct states", () => {
  const controller = new DevelopmentJobStateController();
  let job = createDevelopmentJob(input());
  job = controller.apply(job, { transitionId: "p", actor: "state-controller", to: "PLANNING", reason: "plan" });
  job = controller.apply(job, { transitionId: "i", actor: "state-controller", to: "IMPLEMENTING", reason: "build" });
  job = controller.apply(job, { transitionId: "w", actor: "state-controller", to: "WAITING_FOR_CONNECTIVITY", reason: "offline" });
  assert.equal(job.phase, "WAITING_FOR_CONNECTIVITY");
  job = controller.apply(job, { transitionId: "r", actor: "state-controller", to: "RECOVERING", reason: "online" });
  assert.equal(job.phase, "RECOVERING");
  job = controller.apply(job, { transitionId: "v", actor: "state-controller", to: "VERIFYING", reason: "reverify" });
  job = controller.apply(job, { transitionId: "pub", actor: "state-controller", to: "READY_TO_PUBLISH", reason: "verified" });
  assert.equal(job.phase, "READY_TO_PUBLISH");
  job = controller.apply(job, { transitionId: "gate", actor: "state-controller", to: "HUMAN_GATE", reason: "permission change" });
  assert.equal(job.phase, "HUMAN_GATE");
});

test("failure signatures and rejected strategies survive state transitions", () => {
  const controller = new DevelopmentJobStateController();
  let job = createDevelopmentJob(input());
  job = controller.apply(job, { transitionId: "p", actor: "state-controller", to: "PLANNING", reason: "plan" });
  job = controller.apply(job, { transitionId: "i", actor: "state-controller", to: "IMPLEMENTING", reason: "build" });
  job = controller.apply(job, {
    transitionId: "recover",
    actor: "state-controller",
    to: "RECOVERING",
    reason: "tests failed",
    failure: { signature: "test:wrong-output", strategyId: "strategy-a", hypothesis: "fixture is stale" },
  });
  assert.deepEqual(job.failureSignatures, ["test:wrong-output"]);
  assert.deepEqual(job.rejectedStrategyIds, ["strategy-a"]);
  assert.equal(job.attempts.at(-1)?.hypothesis, "fixture is stale");
});
