import assert from "node:assert/strict";
import test from "node:test";
import type { ReasoningFeedback } from "../src/orchestrator/reasoning-feedback.ts";
import { parseHumanGateShortcut, resolveHumanGateShortcut } from "../src/orchestrator/human-gate-shortcuts.ts";

function feedback(overrides: Partial<ReasoningFeedback> = {}): ReasoningFeedback {
  return {
    version: 1,
    goal: null,
    status: "approval_required",
    commandSource: "chat",
    command: "continue",
    blockers: [],
    verificationSummary: null,
    nextAction: "本番反映を実行",
    report: null,
    riskDecision: {
      level: "HIGH",
      autoExecutionAllowed: false,
      humanApprovalRequired: true,
      executionBlocked: false,
      reasons: ["Production deployment requires owner approval"],
    },
    approvalKey: "approval-123",
    approvalSatisfied: false,
    reasoningRequired: true,
    humanApprovalRequired: true,
    reasoningRoute: {
      surface: "chat",
      status: "ready",
      reason: "lightweight",
      usage: { work: 0, codex: 0 },
      softBudgets: { work: 2, codex: 3 },
      budgetRemaining: null,
    },
    generatedAt: "2026-09-07T08:00:00+09:00",
    ...overrides,
  };
}

test("parses short Japanese check and stamp commands only", () => {
  assert.deepEqual(parseHumanGateShortcut("チェック"), { kind: "check" });
  assert.deepEqual(parseHumanGateShortcut("判子！"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("承認"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("次へ進んで"), { kind: "none" });
});

test("check reports one pending HIGH without approving it", () => {
  const result = resolveHumanGateShortcut({ kind: "check" }, feedback());
  assert.equal(result.state.pendingCount, 1);
  assert.equal(result.approvedActionKey, null);
  assert.match(result.message, /判子待ちが1件/);
});

test("stamp returns the exact approval key only for one active HIGH", () => {
  const result = resolveHumanGateShortcut({ kind: "approve" }, feedback());
  assert.equal(result.state.pendingCount, 1);
  assert.equal(result.approvedActionKey, "approval-123");
});

test("stamp does nothing when no approval is pending", () => {
  const result = resolveHumanGateShortcut({ kind: "approve" }, feedback({
    humanApprovalRequired: false,
    approvalKey: null,
    riskDecision: {
      level: "LOW",
      autoExecutionAllowed: true,
      humanApprovalRequired: false,
      executionBlocked: false,
      reasons: [],
    },
  }));
  assert.equal(result.state.pendingCount, 0);
  assert.equal(result.approvedActionKey, null);
});

test("CRITICAL can never be released by the stamp shortcut", () => {
  const result = resolveHumanGateShortcut({ kind: "approve" }, feedback({
    humanApprovalRequired: false,
    riskDecision: {
      level: "CRITICAL",
      autoExecutionAllowed: false,
      humanApprovalRequired: false,
      executionBlocked: true,
      reasons: ["Human Gate policy relaxation is blocked"],
    },
  }));
  assert.equal(result.state.blocked, true);
  assert.equal(result.approvedActionKey, null);
  assert.match(result.message, /承認できません/);
});
