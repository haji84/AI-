import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import {
  CompassGoalDecisionStoreAdapter,
  CompassGoalRegistryAdapter,
  CompassSharedContextStoreAdapter,
} from "../src/orchestrator/compass-goal-controller.ts";
import { GoalControllerRuntime, normalizeIntake } from "../src/orchestrator/goal-controller-runtime.ts";
import { ContextResolver, contextRecordFromIntake } from "../src/orchestrator/shared-context.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-compass-goal-controller-"));
  return { dir, path: join(dir, "compass.db") };
}

test("Goal registry reuses the canonical Compass Goal and stable WorkState identity", async () => {
  const compass = new CompassStore(":memory:");
  try {
    const registry = new CompassGoalRegistryAdapter(compass);
    const created = await registry.create({
      title: "JARVIS completion",
      description: "Finish the product safely",
      successCriteria: ["verified"],
      constraints: ["preserve gates"],
    });
    const canonical = compass.getGoal();
    assert.ok(canonical);
    assert.equal(canonical.title, "JARVIS completion");
    assert.equal(created.goalId, goalWorkStateId(created.goal));

    const active = await registry.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.goalId, created.goalId);

    await assert.rejects(
      registry.create({
        title: "competing goal",
        description: "must not silently overwrite",
        successCriteria: [],
        constraints: [],
      }),
      /active Compass Goal already exists/,
    );
    assert.equal(compass.getGoal()?.title, "JARVIS completion");
  } finally {
    compass.close();
  }
});

test("material intake decision survives restart without storing the raw idempotency key", async () => {
  const fixture = tempDb();
  try {
    const firstCompass = new CompassStore(fixture.path);
    const firstRuntime = new GoalControllerRuntime({
      registry: new CompassGoalRegistryAdapter(firstCompass),
      decisionStore: new CompassGoalDecisionStoreAdapter(firstCompass),
    });
    const first = await firstRuntime.handle({
      source: "chat",
      text: "JARVISの登録機能を最後まで完成させて",
      idempotencyKey: "owner-secret-ish-request-key",
    });
    assert.equal(first.resolution.kind, "NEW_GOAL");
    assert.equal(JSON.stringify(firstCompass.getState().active).includes("owner-secret-ish-request-key"), false);
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const secondRuntime = new GoalControllerRuntime({
      registry: new CompassGoalRegistryAdapter(secondCompass),
      decisionStore: new CompassGoalDecisionStoreAdapter(secondCompass),
    });
    const repeated = await secondRuntime.handle({
      source: "codex",
      text: "JARVISの登録機能を最後まで完成させて",
      idempotencyKey: "owner-secret-ish-request-key",
    });
    assert.equal(repeated.goalId, first.goalId);
    assert.equal((await new CompassGoalRegistryAdapter(secondCompass).listActive()).length, 1);
    secondCompass.close();
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("same Goal text from another entry point converges after restart", async () => {
  const fixture = tempDb();
  try {
    const firstCompass = new CompassStore(fixture.path);
    const first = await new GoalControllerRuntime({
      registry: new CompassGoalRegistryAdapter(firstCompass),
      decisionStore: new CompassGoalDecisionStoreAdapter(firstCompass),
    }).handle({ source: "chat", text: "端末登録フローを最後まで完成させて" });
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const second = await new GoalControllerRuntime({
      registry: new CompassGoalRegistryAdapter(secondCompass),
      decisionStore: new CompassGoalDecisionStoreAdapter(secondCompass),
    }).handle({ source: "codex", text: "端末登録フローを最後まで完成させて" });
    assert.equal(second.resolution.kind, "EXISTING_GOAL");
    assert.equal(second.goalId, first.goalId);
    secondCompass.close();
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("Shared Context persists in Compass, resolves relevant context, and supersedes old records", async () => {
  const fixture = tempDb();
  try {
    const firstCompass = new CompassStore(fixture.path);
    firstCompass.updateState({ status: "RUNNING", nextAction: "keep-authoritative-state" });
    const store = new CompassSharedContextStoreAdapter(firstCompass);
    const inspectionIntake = normalizeIntake({ source: "chat", text: "端末登録 nonce 検証を確認して" });
    const firstRecord = contextRecordFromIntake(inspectionIntake, "INSPECTION", {
      summary: "端末登録 nonce 検証が不足している",
    });
    await store.put(firstRecord);
    await store.put({
      ...firstRecord,
      id: "ctx-correction",
      type: "CORRECTION",
      summary: "端末登録 nonce 検証を追加する必要がある",
      supersedes: firstRecord.id,
      createdAt: new Date(Date.parse(firstRecord.createdAt) + 1_000).toISOString(),
    });
    firstCompass.close();

    const secondCompass = new CompassStore(fixture.path);
    const reopened = new CompassSharedContextStoreAdapter(secondCompass);
    const all = await reopened.list({ limit: 10 });
    assert.equal(all.find((record) => record.id === firstRecord.id)?.status, "SUPERSEDED");
    assert.equal(all.find((record) => record.id === "ctx-correction")?.status, "ACTIVE");
    assert.equal(secondCompass.getState().status, "RUNNING");
    assert.equal(secondCompass.getState().nextAction, "keep-authoritative-state");

    const resolver = new ContextResolver(reopened);
    const relevant = await resolver.resolve({
      intake: normalizeIntake({ source: "codex", text: "端末登録 nonce 検証を修正して" }),
      limit: 5,
    });
    assert.equal(relevant.some((record) => record.id === "ctx-correction"), true);
    assert.equal(relevant.some((record) => record.id === firstRecord.id), false);
    secondCompass.close();
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("context-only EVIDENCE does not overwrite canonical Compass verification", async () => {
  const compass = new CompassStore(":memory:");
  try {
    const verification = compass.recordVerification({ status: "PASS", summary: "canonical verifier result" });
    const store = new CompassSharedContextStoreAdapter(compass);
    const intake = normalizeIntake({ source: "github", text: "CI evidence recorded" });
    await store.put({
      ...contextRecordFromIntake(intake, "COMMAND", { summary: "CI evidence reference" }),
      type: "EVIDENCE",
      evidenceIds: [`verification:${verification.id}`],
    });
    assert.equal(compass.getHistory().length, 0);
    assert.equal((await store.list({ limit: 10 })).length, 1);
  } finally {
    compass.close();
  }
});
