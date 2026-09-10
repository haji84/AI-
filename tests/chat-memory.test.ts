import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemoryContext,
  decodeChatComment,
  decodeConversationBody,
  defaultConversationMeta,
  encodeChatComment,
  encodeConversationBody,
  evolveMemory,
  type PersistedChatMessage,
} from "../src/app/chat-memory.ts";
import { normalizeCommandEnvelope } from "../src/orchestrator/command-ingress.ts";

const message = (text: string, role: PersistedChatMessage["role"] = "owner"): PersistedChatMessage => ({
  id: `m-${text.length}`,
  role,
  text,
  createdAt: "2026-09-10T01:00:00.000Z",
});

test("conversation metadata round-trips pin, project, and memory", () => {
  const meta = {
    ...defaultConversationMeta(),
    pinned: true,
    project: "AI Company",
    memory: {
      decisions: ["MCPを本命にすると決定"],
      constraints: ["追加料金なしが必須"],
      unfinished: ["次にE2Eを実施"],
      references: ["Issue #290"],
    },
  };
  assert.deepEqual(decodeConversationBody(encodeConversationBody(meta)), meta);
});

test("chat entry round-trips with attachment metadata", () => {
  const entry: PersistedChatMessage = {
    ...message("この画像を使って完成させて"),
    attachments: [{ name: "screen.png", type: "image/png", size: 1234, pathname: "ai-chat/2026-09/x.png" }],
  };
  assert.deepEqual(decodeChatComment(encodeChatComment(entry)), entry);
});

test("memory evolves into decisions, constraints, unfinished work and references", () => {
  let meta = defaultConversationMeta();
  meta = evolveMemory(meta, message("方針はMCPを採用で確定。追加料金なしが必須。次にIssue #290を完成させる"));
  assert.equal(meta.memory.decisions.length, 1);
  assert.equal(meta.memory.constraints.length, 1);
  assert.equal(meta.memory.unfinished.length, 1);
  assert.deepEqual(meta.memory.references, ["Issue #290"]);
});

test("memory context includes project and recent conversation without exceeding bound", () => {
  const meta = { ...defaultConversationMeta(), project: "自動化" };
  const context = buildMemoryContext(meta, [message("前の設計を引き継いで"), message("了解", "ai")]);
  assert.match(context, /Project: 自動化/);
  assert.match(context, /owner: 前の設計を引き継いで/);
  assert.match(context, /ai: 了解/);
  assert.ok(context.length <= 12000);
});

test("command ingress preserves bounded long-term memory for planners and MCP", () => {
  const normalized = normalizeCommandEnvelope({
    source: "chat",
    command: "続きを完成させて",
    conversationId: "conversation:42",
    memoryContext: "Project: AI Company\nDecisions: MCPを本命にする",
  });
  assert.equal(normalized.conversationId, "conversation:42");
  assert.match(normalized.memoryContext ?? "", /MCPを本命/);
});
