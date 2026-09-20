import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import {
  CompassGoalControllerDecisionStore,
  CompassGoalRegistry,
} from "../src/orchestrator/compass-goal-controller-store.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { normalizeCommandEnvelope } from "../src/orchestrator/command-ingress.ts";
import { CompassSharedContextStore, SharedContextResolver } from "../src/orchestrator/shared-context.ts";
import { routeCommandThroughUnifiedIntake } from "../src/orchestrator/unified-intake-adapter.ts";

function databasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-unified-intake-"));
  return { directory, path: join(directory, "compass.sqlite") };
}

function runtime(compass: CompassStore): GoalControllerRuntime {
  return new GoalControllerRuntime({
    registry: new CompassGoalRegistry(compass),
    decisionStore: new CompassGoalControllerDecisionStore(compass),
  });
}

test("material intake remains idempotent across process restart", async () => {
  const fixture = databasePath();
  try {
    const firstCompass = new CompassStore(fixture.path);
    const firstRegistry = new CompassGoalRegistry(firstCompass);
    const firstRuntime = new GoalControllerRuntime({
      registry: firstRegistry,
      decisionStore: new CompassGoalControllerDecisionStore(firstCompass),
    });
    const first = await firstRuntime.handle({
      source: "chat",
      text: "JARVISの登録機能を最後まで完成させて",
      idempotencyKey: "owner-request-910",
    });
    assert.equal(first.resolution.kind, "NEW_GOAL");
    assert.equal((await firstRegistry.listActive()).length, 1);
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const secondRegistry = new CompassGoalRegistry(secondCompass);
    const secondRuntime = new GoalControllerRuntime({
      registry: secondRegistry,
      decisionStore: new CompassGoalControllerDecisionStore(secondCompass),
    });
    const repeated = await secondRuntime.handle({
      source: "codex",
      text: "JARVISの登録機能を最後まで完成させて",
      idempotencyKey: "owner-request-910",
    });
    assert.equal(repeated.goalId, first.goalId);
    assert.equal((await secondRegistry.listActive()).length, 1);
    secondCompass.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("same material goal converges across chat and codex after restart without a shared caller key", async () => {
  const fixture = databasePath();
  try {
    const firstCompass = new CompassStore(fixture.path);
    const first = await routeCommandThroughUnifiedIntake({
      command: normalizeCommandEnvelope({
        source: "chat",
        command: "端末登録フローを最後まで完成させて",
        conversationId: "chat-1",
      }),
      runtime: runtime(firstCompass),
      contextStore: new CompassSharedContextStore(firstCompass),
    });
    assert.equal(first.decision.resolution.kind, "NEW_GOAL");
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const secondRegistry = new CompassGoalRegistry(secondCompass);
    const second = await routeCommandThroughUnifiedIntake({
      command: normalizeCommandEnvelope({
        source: "codex",
        command: "端末登録フローを最後まで完成させて",
        conversationId: "codex-1",
      }),
      runtime: new GoalControllerRuntime({
        registry: secondRegistry,
        decisionStore: new CompassGoalControllerDecisionStore(secondCompass),
      }),
      contextStore: new CompassSharedContextStore(secondCompass),
    });
    assert.equal(second.decision.resolution.kind, "EXISTING_GOAL");
    assert.equal(second.decision.goalId, first.decision.goalId);
    assert.equal((await secondRegistry.listActive()).length, 1);
    secondCompass.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("question persists as shared context without creating a Goal", async () => {
  const fixture = databasePath();
  try {
    const firstCompass = new CompassStore(fixture.path);
    const firstRegistry = new CompassGoalRegistry(firstCompass);
    const result = await routeCommandThroughUnifiedIntake({
      command: normalizeCommandEnvelope({ source: "chat", command: "このエラーの意味教えて？" }),
      runtime: new GoalControllerRuntime({
        registry: firstRegistry,
        decisionStore: new CompassGoalControllerDecisionStore(firstCompass),
      }),
      contextStore: new CompassSharedContextStore(firstCompass),
    });
    assert.equal(result.decision.action, "ANSWER");
    assert.equal((await firstRegistry.listActive()).length, 0);
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const secondRegistry = new CompassGoalRegistry(secondCompass);
    const records = await new CompassSharedContextStore(secondCompass).list();
    assert.equal((await secondRegistry.listActive()).length, 0);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, "QUESTION");
    assert.equal(records[0]?.authority, "CONTEXT_ONLY");
    secondCompass.close();
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("resolver returns relevant cross-entry inspection context and excludes unrelated context", async () => {
  const compass = new CompassStore(":memory:");
  try {
    const contextStore = new CompassSharedContextStore(compass);
    await contextStore.put({
      id: "inspection-registration",
      kind: "INSPECTION",
      source: "chat",
      text: "端末登録コードのnonce検証が不足している",
    });
    await contextStore.put({
      id: "inspection-weather",
      kind: "INSPECTION",
      source: "event",
      text: "明日の天気と気温を確認した",
    });

    const resolved = await new SharedContextResolver(contextStore).resolve({
      text: "端末登録コードのnonce検証を修正して",
    });
    assert.deepEqual(resolved.map((record) => record.id), ["inspection-registration"]);

    const routed = await routeCommandThroughUnifiedIntake({
      command: normalizeCommandEnvelope({ source: "codex", command: "端末登録コードのnonce検証を修正して" }),
      runtime: runtime(compass),
      contextStore,
    });
    assert.equal(routed.relevantContext.some((record) => record.id === "inspection-registration"), true);
    assert.equal(routed.relevantContext.some((record) => record.id === "inspection-weather"), false);
  } finally {
    compass.close();
  }
});

test("shared context does not overwrite authoritative Compass Goal, state, or verification", async () => {
  const compass = new CompassStore(":memory:");
  try {
    const canonicalGoal = compass.setGoal({
      title: "Canonical Goal",
      description: "authoritative",
      successCriteria: ["verified"],
      constraints: ["safe"],
    });
    compass.updateState({ status: "RUNNING", nextAction: "keep-going" });
    const verification = compass.recordVerification({ status: "PASS", summary: "canonical evidence" });

    const contextStore = new CompassSharedContextStore(compass);
    await contextStore.put({
      kind: "EVIDENCE",
      source: "github",
      text: "context-only evidence reference",
      metadata: { verificationId: verification.id },
    });

    assert.deepEqual(compass.getGoal(), canonicalGoal);
    assert.equal(compass.getState().status, "RUNNING");
    assert.equal(compass.getState().nextAction, "keep-going");
    const contexts = await contextStore.list();
    assert.equal(contexts[0]?.authority, "CONTEXT_ONLY");
  } finally {
    compass.close();
  }
});
