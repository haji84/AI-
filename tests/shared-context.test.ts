import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIntake } from "../src/orchestrator/goal-controller-runtime.ts";
import { ContextResolver, contextRecordFromIntake } from "../src/orchestrator/shared-context.ts";
import { SqliteSharedContextStore } from "../src/orchestrator/shared-context-store.ts";

test("inspection context from Chat is available to related Codex development task", async () => {
  const store = new SqliteSharedContextStore(":memory:");
  const inspection = normalizeIntake({ source: "chat", text: "端末登録エラーの原因を調べて", idempotencyKey: "inspect" });
  await store.put(contextRecordFromIntake(inspection, "INSPECTION", {
    summary: "端末登録エラーは期限切れトークン処理で発生",
    result: { cause: "expired_token" },
    goalId: "goal-device",
  }));
  const task = normalizeIntake({ source: "codex", text: "端末登録エラーを修正して", idempotencyKey: "fix" });
  const resolved = await new ContextResolver(store).resolve({ intake: task, goalId: "goal-device" });
  assert.equal(resolved.length, 1);
  assert.equal((resolved[0].result as { cause: string }).cause, "expired_token");
  store.close();
});

test("unrelated context is not injected without shared goal", async () => {
  const store = new SqliteSharedContextStore(":memory:");
  const unrelated = normalizeIntake({ source: "chat", text: "画像生成UIを確認して", idempotencyKey: "other" });
  await store.put(contextRecordFromIntake(unrelated, "INSPECTION", { summary: "画像生成UIのボタン配置", goalId: "goal-image" }));
  const task = normalizeIntake({ source: "codex", text: "端末登録エラーを修正して", idempotencyKey: "device" });
  const resolved = await new ContextResolver(store).resolve({ intake: task, goalId: "goal-device" });
  assert.equal(resolved.length, 0);
  store.close();
});

test("question context can persist without creating a goal linkage", async () => {
  const store = new SqliteSharedContextStore(":memory:");
  const question = normalizeIntake({ source: "jarvis", text: "このエラーの意味は？", idempotencyKey: "q1" });
  const record = contextRecordFromIntake(question, "QUESTION", { summary: "エラーコードの説明" });
  await store.put(record);
  const records = await store.list({ status: "ACTIVE" });
  assert.equal(records.length, 1);
  assert.equal(records[0].goalId, undefined);
  store.close();
});
