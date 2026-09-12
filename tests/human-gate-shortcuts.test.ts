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
      approvalRequired: false,
      approvalSurface: null,
      executionMode: "single",
      maxChunkSteps: null,
      continuationSurfaceOptions: ["chat"],
    },
    generatedAt: "2026-09-07T08:00:00+09:00",
    ...overrides,
  };
}

test("parses explicit Japanese Human Gate commands", () => {
  assert.deepEqual(parseHumanGateShortcut("チェック"), { kind: "check" });
  assert.deepEqual(parseHumanGateShortcut("判子！"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("承認"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("許可"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("最後まで完成させて"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("任せる"), { kind: "approve" });
  assert.deepEqual(parseHumanGateShortcut("次へ進んで"), { kind: "none" });
});

test("check reports one pending HIGH before approval", () => {
  const result = resolveHumanGateShortcut({ kind: "check" }, feedback());
  assert.equal(result.state.pendingCount, 1);
  assert.equal(result.approvedActionKey, null);
  assert.match(result.message, /事前報告/);
  assert.match(result.message, /本番反映を実行/);
});

test("explicit approval returns the exact approval key only for one active HIGH", () => {
  const result = resolveHumanGateShortcut(parseHumanGateShortcut("許可") as { kind: "approve" }, feedback());
  assert.equal(result.state.pendingCount, 1);
  assert.equal(result.approvedActionKey, "approval-123");
});

test("completion language can approve only an already-present single HIGH", () => {
  const result = resolveHumanGateShortcut(parseHumanGateShortcut("最後まで完成させて") as { kind: "approve" }, feedback());
  assert.equal(result.approvedActionKey, "approval-123");
});

test("approval language does nothing when no approval was pre-reported", () => {
  const result = resolveHumanGateShortcut(parseHumanGateShortcut("許可") as { kind: "approve" }, feedback({
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
  assert.match(result.message, /実行しません/);
});

test("CRITICAL can never be released by chat approval language", () => {
  const result = resolveHumanGateShortcut(parseHumanGateShortcut("最後まで完成させて") as { kind: "approve" }, feedback({
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
