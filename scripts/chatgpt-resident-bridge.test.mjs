import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBridgePrompt,
  decodeChatComment,
  decodeConversationBody,
  encodeChatComment,
  encodeConversationBody,
  evolveMemoryForAi,
  findExistingAiReplyAfterPending,
  isPendingConversationIssue,
  mergePendingOwnerFallback,
  selectPendingOwnerMessage,
} from "./chatgpt-resident-bridge-lib.mjs";

function meta(pendingOwnerMessageId = "owner-1", pendingOwnerPayload = null) {
  return {
    version: 1,
    pinned: false,
    project: "AGI",
    memory: { decisions: ["GitHub is canonical"], constraints: ["追加料金なし"], unfinished: [], references: [] },
    githubBridge: {
      pendingOwnerMessageId,
      pendingAt: pendingOwnerMessageId ? "2026-09-10T00:00:00.000Z" : null,
      lastAiMessageId: null,
      lastSyncedAt: null,
      pendingOwnerPayload,
    },
  };
}

const owner = { id: "owner-1", role: "owner", text: "この方法で進めて", createdAt: "2026-09-10T00:00:00.000Z" };
const ai = { id: "ai-1", role: "ai", text: "完了しました", createdAt: "2026-09-10T00:01:00.000Z" };

test("pending conversation issue is detected from canonical metadata", () => {
  const issue = { title: "[AI Chat] test", body: encodeConversationBody(meta()) };
  assert.equal(isPendingConversationIssue(issue), true);
  assert.equal(isPendingConversationIssue({ ...issue, title: "ordinary issue" }), false);
});

test("pending owner message is selected by exact message id", () => {
  assert.deepEqual(selectPendingOwnerMessage(meta(), [owner]), owner);
  assert.equal(selectPendingOwnerMessage(meta("missing"), [owner]), null);
});

test("issue-body fallback is consumed when comment persistence is unavailable", () => {
  const fallbackMeta = meta(owner.id, owner);
  assert.deepEqual(mergePendingOwnerFallback(fallbackMeta, []), [owner]);
  assert.deepEqual(selectPendingOwnerMessage(fallbackMeta, []), owner);
  assert.deepEqual(mergePendingOwnerFallback(fallbackMeta, [owner]), [owner]);
  const prompt = buildBridgePrompt({ issueNumber: 375, meta: fallbackMeta, messages: [], pending: owner });
  assert.match(prompt, /この方法で進めて/);
});

test("existing AI reply after pending is recognized for crash reconciliation", () => {
  assert.deepEqual(findExistingAiReplyAfterPending(meta(), [owner, ai]), ai);
  assert.equal(findExistingAiReplyAfterPending(meta(), [ai, owner]), null);
});

test("status-only history cannot reconcile or produce an AI sync receipt", () => {
  const pending = meta(owner.id, owner);
  const status = { ...ai, id: "status-ai", text: "実行状態を確認しました", meta: "状態: RUNNING / リスク: LOW / Human Gate: なし" };
  assert.equal(findExistingAiReplyAfterPending(pending, [owner, status]), null);
  assert.deepEqual(evolveMemoryForAi(pending, status).githubBridge, pending.githubBridge);
  assert.equal(isPendingConversationIssue({ title: "[AI Chat] status only", body: encodeConversationBody(evolveMemoryForAi(pending, status)) }), true);
  assert.deepEqual(findExistingAiReplyAfterPending(pending, [owner, status, ai]), ai);
});

test("reconciliation rejects replayed and unrelated replies but accepts exact pending correlation", () => {
  const stale = { ...ai, createdAt: "2026-09-09T23:59:00.000Z" };
  const unrelated = { ...ai, meta: "pending-owner-message-id:owner-other" };
  for (const reply of [stale, unrelated]) {
    assert.equal(findExistingAiReplyAfterPending(meta(), [owner, reply]), null);
    assert.equal(evolveMemoryForAi(meta(), reply).githubBridge.pendingOwnerMessageId, owner.id);
  }
  const answer = { ...ai, meta: "pending-owner-message-id:owner-1" };
  assert.deepEqual(findExistingAiReplyAfterPending(meta(), [owner, answer]), answer);
  const synced = evolveMemoryForAi(meta(), answer);
  assert.equal(findExistingAiReplyAfterPending(synced, [owner, answer]), null);
});

test("an uncorrelated legacy answer after a different owner turn cannot acknowledge the pending turn", () => {
  const nextOwner = { ...owner, id: "owner-2", createdAt: "2026-09-10T00:00:30.000Z" };
  assert.equal(findExistingAiReplyAfterPending(meta(), [owner, nextOwner, ai]), null);
});

test("AI write-back clears pending fallback and keeps canonical encoding readable", () => {
  const next = evolveMemoryForAi(meta(owner.id, owner), ai);
  assert.equal(next.githubBridge.pendingOwnerMessageId, null);
  assert.equal(next.githubBridge.pendingOwnerPayload, null);
  assert.equal(next.githubBridge.lastAiMessageId, "ai-1");
  const roundTrip = decodeConversationBody(encodeConversationBody(next));
  assert.equal(roundTrip.githubBridge.lastSyncedAt, ai.createdAt);
});

test("chat comments use the existing canonical envelope", () => {
  const body = encodeChatComment(ai);
  assert.match(body, /CHATGPT-GITHUB-BRIDGE-MESSAGE: ai:ai-1/);
  assert.deepEqual(decodeChatComment(body), ai);
});

test("bridge prompt carries bounded memory and the exact pending request", () => {
  const prompt = buildBridgePrompt({ issueNumber: 296, meta: meta(), messages: [owner], pending: owner });
  assert.match(prompt, /Issue #296/);
  assert.match(prompt, /GitHub is canonical/);
  assert.match(prompt, /追加料金なし/);
  assert.match(prompt, /この方法で進めて/);
  assert.ok(prompt.length <= 18000);
});
