import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalKey } from "../src/orchestrator/approval-key.ts";
import {
  DefaultApprovalPolicy,
  GoalDrivenLoop,
  type ActionResult,
  type ContextItem,
  type Goal,
  type GoalLoopOptions,
  type LoopState,
  type ProposedAction,
  type VerificationResult,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { inferIntentFromSignals } from "../src/orchestrator/intent.ts";

const goal: Goal = {
  title: "Ship the requested feature",
  successCriteria: ["tests pass"],
  constraints: ["preserve Human Gate for genuinely high-risk work"],
};

function makeLoop(action: ProposedAction, onExecute?: () => void, options: GoalLoopOptions = {}) {
  return new GoalDrivenLoop(
    {
      inferIntent: async (input) => inferIntentFromSignals(input),
      proposeNextAction: async () => action,
    },
    [],
    {
      execute: async () => {
        onExecute?.();
        return { actionId: action.id, ok: true, summary: "executed" };
      },
    },
    { verify: async () => ({ ok: true, summary: "verified" }) },
    {
      getState: async () => ({ completed: [], blockers: [] }),
      writeBack: async () => undefined,
    },
    new DefaultApprovalPolicy(),
    options,
  );
}

test("approval policy never auto-approves high-risk or irreversible actions", () => {
  const policy = new DefaultApprovalPolicy();
  assert.equal(policy.requiresApproval({ id: "a", description: "deploy", capability: "deploy", risk: "high" }), true);
  assert.equal(policy.requiresApproval({ id: "b", description: "delete", capability: "fs", risk: "low", irreversible: true }), true);
  assert.equal(policy.requiresApproval({ id: "c", description: "analyze", capability: "read", risk: "low" }), false);
});

test("intent inference includes evidence and bounded confidence", () => {
  const intent = inferIntentFromSignals({
    goal,
    preferences: ["avoid unnecessary questions"],
    recentDecisions: ["continue automatically when low risk"],
  });
  assert.match(intent.summary, /Likely intent/);
  assert.ok(intent.confidence >= 0 && intent.confidence <= 1);
  assert.ok(intent.evidence.some((item) => item.source === "goal"));
  assert.ok(intent.evidence.some((item) => item.source === "preference"));
});

test("low-risk cycle executes, verifies, and writes back", async () => {
  const records: WriteBackRecord[] = [];
  const state: LoopState = { completed: [], blockers: [], nextAction: "inspect" };
  const action: ProposedAction = { id: "inspect", description: "Inspect current state", capability: "read", risk: "low" };
  const result: ActionResult = { actionId: action.id, ok: true, summary: "inspected" };
  const verification: VerificationResult = { ok: true, summary: "verified" };

  const loop = new GoalDrivenLoop(
    {
      inferIntent: async (input) => inferIntentFromSignals(input),
      proposeNextAction: async () => action,
    },
    [{ name: "repo", collect: async (): Promise<ContextItem[]> => [{ source: "repo", summary: "state loaded" }] }],
    { execute: async () => result },
    { verify: async () => verification },
    {
      getState: async () => state,
      writeBack: async (record) => { records.push(record); },
    },
  );

  const report = await loop.runCycle({ goal });
  assert.equal(report.result?.ok, true);
  assert.equal(report.verification?.ok, true);
  assert.equal(report.riskDecision?.level, "LOW");
  assert.equal(report.stopReason, "continue");
  assert.deepEqual(report.contextSources, ["repo"]);
  assert.equal(records.length, 1);
});

test("human-gated legacy high-risk action stops before execution", async () => {
  let executed = false;
  const action: ProposedAction = {
    id: "publish",
    description: "Publish externally",
    capability: "external",
    risk: "high",
    externalSideEffect: true,
  };
  const loop = makeLoop(action, () => { executed = true; });

  const report = await loop.runCycle({ goal });
  assert.equal(report.stopReason, "approval_required");
  assert.equal(report.approvalKey, createApprovalKey(goal, action));
  assert.equal(executed, false);
});

test("exact matching approval key executes HIGH action once", async () => {
  let executions = 0;
  const action: ProposedAction = {
    id: "deploy-runtime-id-can-change",
    description: "Deploy production",
    capability: "deploy",
    risk: "low",
    riskSignals: { productionDeploy: true },
    input: { release: "v1" },
  };
  const loop = makeLoop(action, () => { executions += 1; }, { approvedActionKey: createApprovalKey(goal, action) });

  const first = await loop.runCycle({ goal });
  assert.equal(first.approvalSatisfied, true);
  assert.equal(first.stopReason, "continue");
  assert.equal(executions, 1);

  const second = await loop.runCycle({ goal });
  assert.equal(second.stopReason, "approval_required");
  assert.equal(second.approvalSatisfied, false);
  assert.equal(executions, 1);
});

test("wrong approval key never executes HIGH action", async () => {
  let executed = false;
  const action: ProposedAction = {
    id: "deploy",
    description: "Deploy production",
    capability: "deploy",
    risk: "low",
    riskSignals: { productionDeploy: true },
  };
  const loop = makeLoop(action, () => { executed = true; }, { approvedActionKey: "not-the-right-key" });
  const report = await loop.runCycle({ goal });
  assert.equal(report.stopReason, "approval_required");
  assert.equal(executed, false);
});

test("explicit HIGH policy signal requires Human Gate even when legacy risk is low", async () => {
  let executed = false;
  const loop = makeLoop({
    id: "deploy",
    description: "Deploy production",
    capability: "deploy",
    risk: "low",
    riskSignals: { productionDeploy: true },
  }, () => { executed = true; });

  const report = await loop.runCycle({ goal });
  assert.equal(report.riskDecision?.level, "HIGH");
  assert.equal(report.stopReason, "approval_required");
  assert.equal(executed, false);
});

test("CRITICAL policy signal blocks even when an approval key is supplied", async () => {
  let executed = false;
  const action: ProposedAction = {
    id: "relax-policy",
    description: "Relax the Human Gate policy",
    capability: "policy",
    risk: "low",
    riskSignals: { humanGatePolicyRelaxation: true },
  };
  const loop = makeLoop(action, () => { executed = true; }, { approvedActionKey: createApprovalKey(goal, action) });

  const report = await loop.runCycle({ goal });
  assert.equal(report.riskDecision?.level, "CRITICAL");
  assert.equal(report.stopReason, "blocked");
  assert.equal(executed, false);
});

test("MEDIUM action waits for automated verification without creating a Human Gate", async () => {
  let executed = false;
  const loop = makeLoop({
    id: "merge",
    description: "Merge verified low-impact PR",
    capability: "merge",
    risk: "low",
    riskSignals: { mainMerge: true },
  }, () => { executed = true; });

  const report = await loop.runCycle({ goal });
  assert.equal(report.riskDecision?.level, "MEDIUM");
  assert.equal(report.riskDecision?.humanApprovalRequired, false);
  assert.equal(report.stopReason, "continue");
  assert.match(report.nextAction ?? "", /automated MEDIUM-risk verification/);
  assert.equal(executed, false);
});

test("verified MEDIUM action executes automatically", async () => {
  let executed = false;
  const loop = makeLoop({
    id: "merge",
    description: "Merge verified low-impact PR",
    capability: "merge",
    risk: "low",
    riskSignals: { mainMerge: true },
    mediumRiskChecks: {
      ciPassed: true,
      qaPassed: true,
      reviewerPassed: true,
      unresolvedReviewThreads: 0,
      destructiveChangeAbsent: true,
      privilegedChangeAbsent: true,
    },
  }, () => { executed = true; });

  const report = await loop.runCycle({ goal });
  assert.equal(report.riskDecision?.level, "MEDIUM");
  assert.equal(report.riskDecision?.autoExecutionAllowed, true);
  assert.equal(report.stopReason, "continue");
  assert.equal(executed, true);
});
