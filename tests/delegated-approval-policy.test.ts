import assert from "node:assert/strict";
import test from "node:test";

import { DelegatedApprovalPolicy } from "../src/orchestrator/delegated-approval-policy.ts";
import { evaluateRiskPolicy } from "../src/orchestrator/risk-policy.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";
import type { Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";

const now = new Date("2026-09-15T00:00:00.000Z");
const goal: Goal = {
  title: "Finish issue 123",
  successCriteria: ["verified"],
  constraints: [],
};

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "a1",
    description: "deploy verified result",
    capability: "test",
    risk: "high",
    ...overrides,
  };
}

function policy() {
  const authorization = createTaskCompletionAuthorization("Issue #123 を最後まで進めて", { now });
  assert.ok(authorization);
  return new DelegatedApprovalPolicy(authorization, "issue:123", { now: () => now });
}

test("active task delegation authorizes production deploy when explicitly included", () => {
  const delegated = policy();
  const candidate = action({ riskSignals: { productionDeploy: true } });
  const decision = evaluateRiskPolicy(candidate.riskSignals);
  assert.equal(decision.level, "HIGH");
  assert.equal(delegated.requiresApproval(candidate), false);
  assert.equal(delegated.authorizesRisk({ goal, action: candidate, riskDecision: decision }), true);
});

test("delegation never auto-authorizes credential, permission, billing, destructive, or security weakening changes", () => {
  const delegated = policy();
  for (const riskSignals of [
    { secretsOrCredentialsChange: true },
    { permissionChange: true },
    { billingOrContractChange: true },
    { destructiveSchemaChange: true },
    { destructiveOrHardToRecoverDelete: true },
    { securityWeakening: true },
    { majorExternalPublicationChange: true },
    { highRiskMainMerge: true },
  ]) {
    const candidate = action({ riskSignals });
    const decision = evaluateRiskPolicy(riskSignals);
    assert.equal(delegated.authorizesRisk({ goal, action: candidate, riskDecision: decision }), false);
  }
});

test("explicit human gate and irreversible action remain approval gated", () => {
  const delegated = policy();
  assert.equal(delegated.requiresApproval(action({ requiresHumanApproval: true })), true);
  assert.equal(delegated.requiresApproval(action({ irreversible: true })), true);
});

test("expired or mismatched delegation does not authorize high risk", () => {
  const authorization = createTaskCompletionAuthorization("Issue #123 を最後まで進めて", { now, ttlHours: 1 });
  assert.ok(authorization);
  const expired = new DelegatedApprovalPolicy(authorization, "issue:123", {
    now: () => new Date("2026-09-15T02:00:00.000Z"),
  });
  const mismatched = new DelegatedApprovalPolicy(authorization, "issue:999", { now: () => now });
  const candidate = action({ riskSignals: { productionDeploy: true } });
  const decision = evaluateRiskPolicy(candidate.riskSignals);
  assert.equal(expired.authorizesRisk({ goal, action: candidate, riskDecision: decision }), false);
  assert.equal(mismatched.authorizesRisk({ goal, action: candidate, riskDecision: decision }), false);
});
