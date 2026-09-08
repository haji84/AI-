import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommandEnvelope } from "../src/orchestrator/command-ingress.ts";
import { UnifiedPlanningClient } from "../src/orchestrator/unified-planning-client.ts";

for (const source of ["chat", "work", "codex"] as const) {
  test(`${source} normalizes to the same command contract`, () => {
    const normalized = normalizeCommandEnvelope({
      source,
      command: "  continue the current goal  ",
      goalId: "goal-1",
      conversationId: "conversation-1",
      plan: { kind: "inspect", description: "Inspect current state" },
    });

    assert.deepEqual(normalized, {
      source,
      command: "continue the current goal",
      goalId: "goal-1",
      conversationId: "conversation-1",
      plan: { kind: "inspect", description: "Inspect current state" },
    });
  });
}

test("task completion authorization is normalized with the command envelope", () => {
  const normalized = normalizeCommandEnvelope({
    source: "chat",
    command: "Issue #243を最後まで進めて",
    taskAuthorization: {
      kind: "task_completion",
      scopeId: "issue:243",
      allowLowMediumMainMerge: true,
      issuedBy: "owner",
      issuedAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-09-15T00:00:00.000Z",
    },
    plan: { kind: "inspect", description: "Inspect current state" },
  });

  assert.equal(normalized.taskAuthorization?.scopeId, "issue:243");
  assert.equal(normalized.taskAuthorization?.allowLowMediumMainMerge, true);
});

test("all three ingress sources use the same bounded planning path", async () => {
  for (const source of ["chat", "work", "codex"] as const) {
    const client = new UnifiedPlanningClient(JSON.stringify({
      source,
      command: "continue",
      plan: { kind: "inspect", description: "Inspect current state" },
    }));
    const plan = await client.plan();
    assert.equal(plan.kind, "inspect");
  }
});

test("rejects unknown command sources", () => {
  assert.throws(
    () => normalizeCommandEnvelope({ source: "other", command: "continue" }),
    /source must be chat, work, or codex/,
  );
});

test("rejects malformed task completion authorization", () => {
  assert.throws(
    () => normalizeCommandEnvelope({
      source: "chat",
      command: "continue",
      taskAuthorization: { kind: "task_completion", scopeId: "issue:243" },
    }),
    /Task completion authorization is invalid/,
  );
});

test("fails visibly when model reasoning is required but no bounded plan is handed off", async () => {
  const client = new UnifiedPlanningClient(JSON.stringify({ source: "chat", command: "continue" }));
  await assert.rejects(() => client.plan(), /requires an explicit bounded plan/);
});
