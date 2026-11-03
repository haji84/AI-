import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentVerificationPlan,
  evaluateDevelopmentVerification,
  type DevelopmentVerificationEvidence,
} from "../src/orchestrator/development-verification-plan.ts";

test("affected surfaces select platform, visual, security, and physical iPhone checks", () => {
  const plan = createDevelopmentVerificationPlan({
    builderId: "builder:zbook",
    sourceRevision: "a".repeat(40),
    artifactDigest: "b".repeat(64),
    changedPaths: [
      "src/orchestrator/release.ts",
      "src/app/settings.tsx",
      "ios/GORIQ/App.swift",
      "scripts/windows/verify.ps1",
    ],
  });

  assert.deepEqual(plan.requiredChecks, [
    "lint",
    "typecheck",
    "unit",
    "integration",
    "security",
    "build",
    "visual",
    "windows",
    "macos",
    "physical-iphone",
  ]);
});

test("verification fails closed for Builder self-verification and stale evidence", () => {
  const plan = createDevelopmentVerificationPlan({
    builderId: "builder:zbook",
    sourceRevision: "a".repeat(40),
    artifactDigest: "b".repeat(64),
    changedPaths: ["src/orchestrator/release.ts"],
  });
  const evidence: DevelopmentVerificationEvidence[] = plan.requiredChecks.map((check, index) => ({
    check,
    verifierId: index === 0 ? "builder:zbook" : "verifier:macbook",
    sourceRevision: index === 1 ? "c".repeat(40) : plan.sourceRevision,
    artifactDigest: plan.artifactDigest,
    status: "passed",
    recordedAt: "2026-09-26T12:00:00.000Z",
  }));

  const result = evaluateDevelopmentVerification(plan, evidence);

  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("builder_verifier_not_independent:lint"));
  assert.ok(result.reasons.includes("stale_revision:typecheck"));
});

test("verification accepts only complete evidence bound to the exact revision and artifact", () => {
  const plan = createDevelopmentVerificationPlan({
    builderId: "builder:zbook",
    sourceRevision: "a".repeat(40),
    artifactDigest: "b".repeat(64),
    changedPaths: ["docs/evidence/release.md"],
  });
  const evidence: DevelopmentVerificationEvidence[] = plan.requiredChecks.map((check) => ({
    check,
    verifierId: "verifier:macbook",
    sourceRevision: plan.sourceRevision,
    artifactDigest: plan.artifactDigest,
    status: "passed",
    recordedAt: "2026-09-26T12:00:00.000Z",
  }));

  assert.deepEqual(evaluateDevelopmentVerification(plan, evidence), { passed: true, reasons: [] });
});
