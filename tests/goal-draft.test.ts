import assert from "node:assert/strict";
import test from "node:test";
import { assessGoalReadiness, normalizeGoalDraft } from "../src/orchestrator/goal-draft.ts";
import { normalizeCommandEnvelope } from "../src/orchestrator/command-ingress.ts";

function readyDraft() {
  return {
    title: "Ship mobile autonomy safely",
    desiredOutcome: "A user can hand a bounded plan from Chat/Work/Codex to GitHub Actions and receive verified results.",
    successCriteria: ["Bounded plan executes", "Verification is written back"],
    constraints: ["No additional AI API billing"],
    assumptions: ["GitHub connector is available"],
    unresolvedQuestions: [],
    confidence: 0.9,
    approvalRequired: false,
  };
}

test("marks a complete collaborative goal draft execution-ready", () => {
  const draft = normalizeGoalDraft(readyDraft());
  assert.deepEqual(assessGoalReadiness(draft), { ready: true, reasons: [] });
});

test("keeps a draft non-ready when high-impact questions, low confidence, or approval remain", () => {
  const draft = normalizeGoalDraft({
    ...readyDraft(),
    unresolvedQuestions: [{ question: "May this publish externally?", impact: "high" }],
    confidence: 0.55,
    approvalRequired: true,
  });
  assert.deepEqual(assessGoalReadiness(draft), {
    ready: false,
    reasons: ["high_impact_question_unresolved", "low_confidence", "user_approval_required"],
  });
});

test("keeps legacy command envelopes valid without goal metadata", () => {
  assert.deepEqual(normalizeCommandEnvelope({ source: "chat", command: "Inspect Issue #144" }), {
    source: "chat",
    command: "Inspect Issue #144",
    goalId: undefined,
    conversationId: undefined,
    goalDraft: undefined,
    plan: undefined,
  });
});

test("carries normalized structured goal metadata with a command envelope", () => {
  const normalized = normalizeCommandEnvelope({
    source: "work",
    command: "Execute the approved bounded plan",
    goalDraft: readyDraft(),
    plan: { kind: "inspect", description: "Inspect current repository state" },
  });
  assert.equal(normalized.goalDraft?.title, "Ship mobile autonomy safely");
  assert.equal(assessGoalReadiness(normalized.goalDraft!).ready, true);
  assert.equal(normalized.plan?.kind, "inspect");
});
