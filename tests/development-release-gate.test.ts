import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDevelopmentReleaseGate,
  type DevelopmentReleaseGateInput,
  type NonBypassableDevelopmentGate,
} from "../src/orchestrator/development-release-gate.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const REVISION = "a".repeat(40);
const ARTIFACT = "b".repeat(64);

function input(overrides: Partial<DevelopmentReleaseGateInput> = {}): DevelopmentReleaseGateInput {
  const verificationPlan = createDevelopmentVerificationPlan({
    builderId: "builder:zbook",
    sourceRevision: REVISION,
    artifactDigest: ARTIFACT,
    changedPaths: ["src/orchestrator/example.ts", "tests/example.test.ts"],
  });
  return {
    phase: "READY_TO_PUBLISH",
    connected: true,
    risk: "medium",
    taskScopeId: "issue:681",
    taskAuthorization: createTaskCompletionAuthorization("Issue #681を完成させて", { now: NOW }),
    changedFiles: ["src/orchestrator/example.ts", "tests/example.test.ts"],
    verificationPlan,
    verificationEvidence: verificationPlan.requiredChecks.map((check) => ({
      check,
      verifierId: "verifier:macbook",
      sourceRevision: REVISION,
      artifactDigest: ARTIFACT,
      status: "passed",
      recordedAt: NOW.toISOString(),
    })),
    protectedConditions: [],
    pullRequest: null,
    mainCi: null,
    deployment: null,
    postDeploymentEvidence: null,
    now: NOW,
    ...overrides,
  };
}

test("offline verified work remains READY_TO_PUBLISH without consuming release authority", () => {
  assert.deepEqual(evaluateDevelopmentReleaseGate(input({ connected: false })), {
    action: "READY_TO_PUBLISH",
    reasons: ["publication_connectivity_unavailable"],
  });
});

test("every non-bypassable category requires a distinct Human Gate", () => {
  const categories: NonBypassableDevelopmentGate[] = [
    "secrets_or_credentials",
    "permission_or_token_scope",
    "billing_or_contract",
    "destructive_or_hard_to_recover",
    "governance_or_safety_weakening",
  ];
  for (const category of categories) {
    const decision = evaluateDevelopmentReleaseGate(input({ protectedConditions: [category] }));
    assert.equal(decision.action, "HUMAN_GATE", category);
    assert.deepEqual(decision.reasons, [`non_bypassable:${category}`], category);
  }
});

test("expired task authorization blocks publication even when verification passed", () => {
  const authorization = createTaskCompletionAuthorization("Issue #681を完成させて", {
    now: new Date("2026-09-01T00:00:00.000Z"),
    ttlHours: 1,
  });
  const decision = evaluateDevelopmentReleaseGate(input({ taskAuthorization: authorization }));
  assert.equal(decision.action, "HUMAN_GATE");
  assert.ok(decision.reasons.includes("task_completion_authorization_missing_or_invalid"));
});

test("protected publication advances through PR, merge, and exact main CI in order", () => {
  assert.equal(evaluateDevelopmentReleaseGate(input()).action, "OPEN_PR");

  const pr = {
    url: "https://github.example/pr/1",
    headRevision: REVISION,
    baseBranch: "main",
    draft: false,
    autoMergeEnabled: false,
    mergedRevision: null,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
  };
  assert.equal(evaluateDevelopmentReleaseGate(input({ pullRequest: pr })).action, "ENABLE_AUTO_MERGE");
  assert.equal(evaluateDevelopmentReleaseGate(input({ pullRequest: { ...pr, autoMergeEnabled: true } })).action, "WAIT_FOR_MERGE");
  assert.equal(evaluateDevelopmentReleaseGate(input({ pullRequest: { ...pr, autoMergeEnabled: true, mergedRevision: REVISION } })).action, "WAIT_MAIN_CI");
  assert.equal(evaluateDevelopmentReleaseGate(input({
    pullRequest: { ...pr, autoMergeEnabled: true, mergedRevision: REVISION },
    mainCi: { revision: "c".repeat(40), passed: true },
  })).action, "BLOCKED");
});

test("Production completion requires exact deployed artifact and post-deployment evidence", () => {
  const pullRequest = {
    url: "https://github.example/pr/1",
    headRevision: REVISION,
    baseBranch: "main",
    draft: false,
    autoMergeEnabled: true,
    mergedRevision: REVISION,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
  };
  const mainCi = { revision: REVISION, passed: true };
  assert.equal(evaluateDevelopmentReleaseGate(input({ pullRequest, mainCi })).action, "DEPLOY_PRODUCTION");
  assert.equal(evaluateDevelopmentReleaseGate(input({
    pullRequest,
    mainCi,
    deployment: { revision: REVISION, artifactDigest: "c".repeat(64), environment: "production" },
  })).action, "BLOCKED");
  assert.equal(evaluateDevelopmentReleaseGate(input({
    pullRequest,
    mainCi,
    deployment: { revision: REVISION, artifactDigest: ARTIFACT, environment: "production" },
  })).action, "VERIFY_PRODUCTION");
  assert.equal(evaluateDevelopmentReleaseGate(input({
    pullRequest,
    mainCi,
    deployment: { revision: REVISION, artifactDigest: ARTIFACT, environment: "production" },
    postDeploymentEvidence: {
      verifierId: "verifier:iphone-1",
      revision: REVISION,
      artifactDigest: ARTIFACT,
      passed: true,
      recordedAt: NOW.toISOString(),
    },
  })).action, "COMPLETE");
});
