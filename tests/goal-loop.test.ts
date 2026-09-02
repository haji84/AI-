import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultApprovalPolicy,
  GoalDrivenLoop,
  type ActionResult,
  type ContextItem,
  type Goal,
  type LoopState,
  type ProposedAction,
  type VerificationResult,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { inferIntentFromSignals } from "../src/orchestrator/intent.ts";

const goal: Goal = {
  title: "Ship the requested feature",
  successCriteria: ["tests pass"],
  constraints: ["preserve Human Gate"],
};

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
  assert.equal(report.stopReason, "continue");
  assert.deepEqual(report.contextSources, ["repo"]);
  assert.equal(records.length, 1);
});

test("human-gated action stops before execution", async () => {
  let executed = false;
  const loop = new GoalDrivenLoop(
    {
      inferIntent: async (input) => inferIntentFromSignals(input),
      proposeNextAction: async () => ({
        id: "publish",
        description: "Publish externally",
        capability: "external",
        risk: "high",
        externalSideEffect: true,
      }),
    },
    [],
    { execute: async () => { executed = true; return { actionId: "publish", ok: true, summary: "published" }; } },
    { verify: async () => ({ ok: true, summary: "verified" }) },
    {
      getState: async () => ({ completed: [], blockers: [] }),
      writeBack: async () => undefined,
    },
  );

  const report = await loop.runCycle({ goal });
  assert.equal(report.stopReason, "approval_required");
  assert.equal(executed, false);
});
