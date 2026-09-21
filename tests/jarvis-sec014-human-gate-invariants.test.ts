import assert from "node:assert/strict";
import test from "node:test";

import { DelegatedApprovalPolicy } from "../src/orchestrator/delegated-approval-policy.ts";
import type { Goal, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import { evaluateRiskPolicy, type RiskSignals } from "../src/orchestrator/risk-policy.ts";
import {
  createTaskCompletionAuthorization,
  type TaskCompletionAuthorization,
} from "../src/orchestrator/task-authorization.ts";

const NOW = new Date("2026-09-21T04:40:00.000Z");
const GOAL: Goal = {
  title: "Certify SEC-014",
  successCriteria: ["protected actions remain Human-Gated"],
  constraints: ["do not weaken Human Gates"],
};

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: "sec014-action",
    description: "SEC-014 protected action",
    capability: "sec014.test",
    risk: "high",
    ...overrides,
  };
}

const NON_DELEGABLE_HIGH: (keyof RiskSignals)[] = [
  "secretsOrCredentialsChange",
  "permissionChange",
  "billingOrContractChange",
  "destructiveSchemaChange",
  "destructiveOrHardToRecoverDelete",
  "securityWeakening",
  "majorExternalPublicationChange",
  "highRiskMainMerge",
];

const CRITICAL_BLOCKS: (keyof RiskSignals)[] = [
  "humanGatePolicyRelaxation",
  "protectionOrAuditDisable",
  "unrecoverableProductionDestruction",
];

test("SEC-014 classifies every non-delegable privileged category as HIGH and Human-Gated", () => {
  for (const reason of NON_DELEGABLE_HIGH) {
    const decision = evaluateRiskPolicy({ [reason]: true } as RiskSignals);
    assert.equal(decision.level, "HIGH", reason);
    assert.equal(decision.autoExecutionAllowed, false, reason);
    assert.equal(decision.humanApprovalRequired, true, reason);
    assert.equal(decision.executionBlocked, false, reason);
    assert.ok(decision.reasons.includes(reason), reason);
  }
});

test("SEC-014 task-completion delegation cannot authorize privileged HIGH categories", () => {
  const authorization = createTaskCompletionAuthorization("Issue #964を最後まで進めて", { now: NOW });
  assert.ok(authorization);
  const policy = new DelegatedApprovalPolicy(authorization, "issue:964", { now: () => NOW });

  for (const reason of NON_DELEGABLE_HIGH) {
    const decision = evaluateRiskPolicy({ [reason]: true } as RiskSignals);
    assert.equal(policy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: decision }), false, reason);
  }
});

test("SEC-014 CRITICAL safety/governance weakening stays blocked even with active delegation", () => {
  const authorization = createTaskCompletionAuthorization("Issue #964を最後まで進めて", { now: NOW });
  assert.ok(authorization);
  const policy = new DelegatedApprovalPolicy(authorization, "issue:964", { now: () => NOW });

  for (const reason of CRITICAL_BLOCKS) {
    const decision = evaluateRiskPolicy({ [reason]: true } as RiskSignals);
    assert.equal(decision.level, "CRITICAL", reason);
    assert.equal(decision.executionBlocked, true, reason);
    assert.equal(decision.autoExecutionAllowed, false, reason);
    assert.equal(policy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: decision }), false, reason);
  }
});

test("SEC-014 irreversible and explicitly approval-required actions cannot ride task delegation", () => {
  const authorization = createTaskCompletionAuthorization("Issue #964を最後まで進めて", { now: NOW });
  assert.ok(authorization);
  const policy = new DelegatedApprovalPolicy(authorization, "issue:964", { now: () => NOW });
  const productionDecision = evaluateRiskPolicy({ productionDeploy: true });

  assert.equal(
    policy.authorizesRisk({ goal: GOAL, action: action({ irreversible: true }), riskDecision: productionDecision }),
    false,
  );
  assert.equal(
    policy.authorizesRisk({ goal: GOAL, action: action({ requiresHumanApproval: true }), riskDecision: productionDecision }),
    false,
  );
});

test("SEC-014 Production authorization is exact-scope, active, and not implied by a stripped authorization", () => {
  const authorization = createTaskCompletionAuthorization("Issue #964を最後まで進めて", { now: NOW });
  assert.ok(authorization);
  const productionDecision = evaluateRiskPolicy({ productionDeploy: true });

  const exactPolicy = new DelegatedApprovalPolicy(authorization, "issue:964", { now: () => NOW });
  assert.equal(
    exactPolicy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: productionDecision }),
    true,
  );

  const wrongScopePolicy = new DelegatedApprovalPolicy(authorization, "issue:965", { now: () => NOW });
  assert.equal(
    wrongScopePolicy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: productionDecision }),
    false,
  );

  const expiredPolicy = new DelegatedApprovalPolicy(authorization, "issue:964", {
    now: () => new Date(authorization.expiresAt),
  });
  assert.equal(
    expiredPolicy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: productionDecision }),
    false,
  );

  const { allowProductionDeploy: _ignored, ...withoutProduction } = authorization;
  const noProductionAuthorization = withoutProduction as TaskCompletionAuthorization;
  const noProductionPolicy = new DelegatedApprovalPolicy(noProductionAuthorization, "issue:964", { now: () => NOW });
  assert.equal(
    noProductionPolicy.authorizesRisk({ goal: GOAL, action: action(), riskDecision: productionDecision }),
    false,
  );
});
