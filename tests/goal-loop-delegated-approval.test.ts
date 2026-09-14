import assert from "node:assert/strict";
import test from "node:test";

import { DelegatedApprovalPolicy } from "../src/orchestrator/delegated-approval-policy.ts";
import {
  GoalDrivenLoop,
  type ActionResult,
  type Goal,
  type InferredIntent,
  type ProposedAction,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const now = new Date("2026-09-15T00:00:00.000Z");
const goal: Goal = {
  title: "Finish delegated task",
  successCriteria: ["verified"],
  constraints: [],
};
const intent: InferredIntent = { summary: "finish it", confidence: 1, evidence: [] };

test("Goal Loop executes delegated production action without repetitive human approval", async () => {
  const authorization = createTaskCompletionAuthorization("Issue #123 を最後まで進めて", { now });
  assert.ok(authorization);

  const action: ProposedAction = {
    id: "deploy",
    description: "deploy verified task result",
    capability: "deploy.test",
    risk: "high",
    riskSignals: { productionDeploy: true },
    completesBoundedCommand: true,
  };
  let executions = 0;
  const writes: WriteBackRecord[] = [];

  const loop = new GoalDrivenLoop(
    {
      async inferIntent() { return intent; },
      async proposeNextAction() { return action; },
    },
    [],
    {
      async execute(): Promise<ActionResult> {
        executions += 1;
        return { actionId: action.id, ok: true, summary: "deployed" };
      },
    },
    {
      async verify() { return { ok: true, summary: "verified" }; },
    },
    {
      async getState() { return { completed: [], blockers: [] }; },
      async writeBack(record) { writes.push(record); },
    },
    new DelegatedApprovalPolicy(authorization, "issue:123", { now: () => now }),
  );

  const report = await loop.runCycle({ goal });
  assert.equal(executions, 1);
  assert.equal(report.stopReason, "goal_complete");
  assert.equal(report.approvalSatisfied, true);
  assert.equal(report.approvalKey, null);
  assert.equal(writes.at(-1)?.stopReason, "goal_complete");
});

test("Goal Loop still blocks CRITICAL actions even when task delegation is active", async () => {
  const authorization = createTaskCompletionAuthorization("Issue #123 を最後まで進めて", { now });
  assert.ok(authorization);
  let executions = 0;

  const loop = new GoalDrivenLoop(
    {
      async inferIntent() { return intent; },
      async proposeNextAction() {
        return {
          id: "disable-audit",
          description: "disable audit protection",
          capability: "unsafe",
          risk: "high" as const,
          riskSignals: { protectionOrAuditDisable: true },
        };
      },
    },
    [],
    {
      async execute() {
        executions += 1;
        return { actionId: "disable-audit", ok: true, summary: "should not run" };
      },
    },
    { async verify() { return { ok: true, summary: "unused" }; } },
    {
      async getState() { return { completed: [], blockers: [] }; },
      async writeBack() {},
    },
    new DelegatedApprovalPolicy(authorization, "issue:123", { now: () => now }),
  );

  const report = await loop.runCycle({ goal });
  assert.equal(executions, 0);
  assert.equal(report.stopReason, "blocked");
  assert.equal(report.riskDecision?.level, "CRITICAL");
});
