import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRiskPolicy } from "../src/orchestrator/risk-policy.ts";

test("LOW work continues without Human Gate", () => {
  const decision = evaluateRiskPolicy({});
  assert.equal(decision.level, "LOW");
  assert.equal(decision.autoExecutionAllowed, true);
  assert.equal(decision.humanApprovalRequired, false);
  assert.equal(decision.executionBlocked, false);
});

test("MEDIUM work auto-continues only after all verification checks pass", () => {
  const pending = evaluateRiskPolicy({ mainMerge: true }, {
    ciPassed: true,
    qaPassed: true,
    reviewerPassed: false,
    unresolvedReviewThreads: 0,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
  });
  assert.equal(pending.level, "MEDIUM");
  assert.equal(pending.autoExecutionAllowed, false);
  assert.equal(pending.humanApprovalRequired, false);
  assert.ok(pending.reasons.includes("medium_verification_required"));

  const verified = evaluateRiskPolicy({ mainMerge: true }, {
    ciPassed: true,
    qaPassed: true,
    reviewerPassed: true,
    unresolvedReviewThreads: 0,
    destructiveChangeAbsent: true,
    privilegedChangeAbsent: true,
  });
  assert.equal(verified.level, "MEDIUM");
  assert.equal(verified.autoExecutionAllowed, true);
  assert.equal(verified.humanApprovalRequired, false);
});

test("HIGH work requires Human Gate", () => {
  const decision = evaluateRiskPolicy({ productionDeploy: true });
  assert.equal(decision.level, "HIGH");
  assert.equal(decision.autoExecutionAllowed, false);
  assert.equal(decision.humanApprovalRequired, true);
  assert.equal(decision.executionBlocked, false);
});

test("CRITICAL work is blocked instead of becoming a normal approval", () => {
  const decision = evaluateRiskPolicy({ humanGatePolicyRelaxation: true });
  assert.equal(decision.level, "CRITICAL");
  assert.equal(decision.autoExecutionAllowed, false);
  assert.equal(decision.humanApprovalRequired, false);
  assert.equal(decision.executionBlocked, true);
});

test("CRITICAL signals take precedence over HIGH signals", () => {
  const decision = evaluateRiskPolicy({
    productionDeploy: true,
    protectionOrAuditDisable: true,
  });
  assert.equal(decision.level, "CRITICAL");
  assert.equal(decision.executionBlocked, true);
});
