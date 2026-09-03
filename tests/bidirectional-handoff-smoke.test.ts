import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { applyExecutionReadyGoalDraft } from "../src/orchestrator/goal-draft-compass.ts";
import { buildReasoningFeedback } from "../src/orchestrator/reasoning-feedback.ts";
import { UnifiedPlanningClient } from "../src/orchestrator/unified-planning-client.ts";

test("bounded smoke completes Chat/Work/Codex -> Compass -> execution state -> reasoning feedback", async () => {
  const envelope = JSON.stringify({
    source: "chat",
    command: "Inspect the agreed goal and continue only with this bounded plan",
    goalDraft: {
      title: "Prove the bidirectional autonomy handoff",
      desiredOutcome: "A collaboratively defined goal and explicit bounded plan execute without GitHub Actions inventing reasoning, then verified state returns to Chat/Work/Codex.",
      successCriteria: [
        "The agreed goal is stored in Compass",
        "The explicit bounded plan is the plan consumed by execution",
        "Structured reasoning feedback contains the verified state and next action",
      ],
      constraints: ["No additional AI API billing", "No external write side effects"],
      assumptions: ["Chat/Work/Codex supplied the bounded plan"],
      unresolvedQuestions: [],
      confidence: 0.95,
      approvalRequired: false,
    },
    plan: {
      kind: "inspect",
      description: "Inspect current repository state without external writes",
    },
  });

  const client = new UnifiedPlanningClient(envelope);
  const compass = new CompassStore(":memory:");

  try {
    const goalDraft = client.command.goalDraft;
    assert.ok(goalDraft);
    const goalResult = applyExecutionReadyGoalDraft(compass, goalDraft);
    assert.equal(goalResult.ready, true);
    assert.equal(compass.getGoal()?.title, "Prove the bidirectional autonomy handoff");

    const plan = await client.plan();
    assert.deepEqual(plan, {
      kind: "inspect",
      description: "Inspect current repository state without external writes",
    });

    compass.writeBack({
      status: "completed",
      summary: "Bounded inspect plan completed and verified",
      completed: ["bounded inspect"],
      blockers: [],
      verification: {
        status: "PASS",
        summary: "Bounded handoff smoke verified",
        evidence: { planKind: plan.kind },
      },
      nextAction: "Return verified state to Chat/Work/Codex for the next bounded decision",
    });

    const state = compass.getState();
    const feedback = buildReasoningFeedback({
      goal: compass.getGoal(),
      state,
      status: state.status,
      commandSource: client.command.source,
      command: client.command.command,
      report: { plan },
      generatedAt: "2026-09-03T13:20:00.000Z",
    });

    assert.equal(feedback.goal?.title, "Prove the bidirectional autonomy handoff");
    assert.equal(feedback.commandSource, "chat");
    assert.equal(feedback.status, "completed");
    assert.equal(feedback.verificationSummary, "Bounded handoff smoke verified");
    assert.equal(feedback.nextAction, "Return verified state to Chat/Work/Codex for the next bounded decision");
    assert.equal(feedback.reasoningRequired, false);
    assert.equal(feedback.humanApprovalRequired, false);
    assert.deepEqual(feedback.report, { plan });
  } finally {
    compass.close();
  }
});
