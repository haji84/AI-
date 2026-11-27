import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeConversationBody,
  defaultConversationMeta,
  encodeConversationBody,
  evolveMemory,
  mergePendingOwnerFallback,
  withPendingOwnerFallback,
  type PersistedChatMessage,
} from "./chat-memory.ts";

function message(role: PersistedChatMessage["role"], id: string, text: string, createdAt: string): PersistedChatMessage {
  return { id, role, text, createdAt };
}

test("legacy conversation metadata remains readable with a default GitHub bridge state", () => {
  const legacy = '<!-- ai-chat-conversation:v1\n{"version":1,"pinned":true,"project":"AI会社","memory":{"decisions":[],"constraints":[],"unfinished":[],"references":[]}}\n-->';
  const meta = decodeConversationBody(legacy);
  assert.equal(meta.pinned, true);
  assert.equal(meta.project, "AI会社");
  assert.deepEqual(meta.githubBridge, {
    pendingOwnerMessageId: null,
    pendingAt: null,
    lastAiMessageId: null,
    lastSyncedAt: null,
    pendingOwnerPayload: null,
  });
});

test("owner message marks the GitHub bridge pending and AI reply clears it", () => {
  const owner = message("owner", "owner-1", "続きを完成させて", "2026-09-10T01:00:00.000Z");
  const pending = evolveMemory(defaultConversationMeta(), owner);
  assert.equal(pending.githubBridge!.pendingOwnerMessageId, "owner-1");
  assert.equal(pending.githubBridge!.pendingAt, owner.createdAt);
  assert.match(encodeConversationBody(pending), /CHATGPT-GITHUB-BRIDGE: pending/);

  const ai = message("ai", "ai-1", "完了しました", "2026-09-10T01:01:00.000Z");
  const synced = evolveMemory(pending, ai);
  assert.equal(synced.githubBridge!.pendingOwnerMessageId, null);
  assert.equal(synced.githubBridge!.pendingAt, null);
  assert.equal(synced.githubBridge!.lastAiMessageId, "ai-1");
  assert.equal(synced.githubBridge!.lastSyncedAt, ai.createdAt);
  assert.equal(synced.githubBridge!.pendingOwnerPayload, null);
  assert.match(encodeConversationBody(synced), /CHATGPT-GITHUB-BRIDGE: synced/);
});

test("issue-body fallback preserves owner message and is deduplicated against comments", () => {
  const owner = message("owner", "owner-fallback", "MacBookブリッジ接続テスト", "2026-09-12T01:00:00.000Z");
  const pending = withPendingOwnerFallback(defaultConversationMeta(), owner);
  assert.equal(pending.githubBridge!.pendingOwnerMessageId, owner.id);
  assert.deepEqual(pending.githubBridge!.pendingOwnerPayload, owner);

  const roundTrip = decodeConversationBody(encodeConversationBody(pending));
  assert.deepEqual(mergePendingOwnerFallback(roundTrip, []), [owner]);
  assert.deepEqual(mergePendingOwnerFallback(roundTrip, [owner]), [owner]);

  const ai = message("ai", "ai-fallback", "MacBookブリッジ正常", "2026-09-12T01:01:00.000Z");
  const synced = evolveMemory(roundTrip, ai);
  assert.equal(synced.githubBridge!.pendingOwnerPayload, null);
  assert.equal(synced.githubBridge!.pendingOwnerMessageId, null);
});

test("command status remains in history without acknowledging the pending owner", () => {
  const owner = message("owner", "owner-status", "調査を完成させて", "2026-11-27T01:00:00.000Z");
  const pending = withPendingOwnerFallback(defaultConversationMeta(), owner);
  for (const role of ["system", "ai"] as const) {
    const status = { ...message(role, `status-${role}`, "次に実行結果を確認します", "2026-11-27T01:01:00.000Z"), meta: "状態: RUNNING / リスク: LOW / Human Gate: なし" };
    const next = evolveMemory(pending, status);
    assert.deepEqual(next.githubBridge, pending.githubBridge);
    assert.match(encodeConversationBody(next), /CHATGPT-GITHUB-BRIDGE: pending/);
    assert.equal(next.memory.unfinished[0], status.text);
  }
});

test("an old or differently correlated answer cannot acknowledge a newer owner request", () => {
  const owner = message("owner", "owner-new", "次の依頼", "2026-11-27T01:02:00.000Z");
  const pending = withPendingOwnerFallback(defaultConversationMeta(), owner);
  const old = message("ai", "old-answer", "先の依頼への回答", "2026-11-27T01:01:00.000Z");
  const unrelated = { ...message("ai", "other-answer", "別の依頼への回答", "2026-11-27T01:03:00.000Z"), meta: "pending-owner-message-id:owner-other" };
  for (const reply of [old, unrelated]) assert.deepEqual(evolveMemory(pending, reply).githubBridge, pending.githubBridge);

  const answer = { ...message("ai", "actual-answer", "依頼への回答", "2026-11-27T01:03:00.000Z"), meta: "pending-owner-message-id:owner-new" };
  assert.equal(evolveMemory(pending, answer).githubBridge!.pendingOwnerMessageId, null);
});
