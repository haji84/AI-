import assert from "node:assert/strict";
import test from "node:test";
import { REMOTE_MCP_TOOLS, invokeRemoteMcpTool } from "./mcp-chat-tools.ts";
import { encodeChatComment, encodeConversationBody, defaultConversationMeta } from "./chat-memory.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

test("Remote MCP exposes durable chat, memory, and task tools", () => {
  assert.deepEqual(REMOTE_MCP_TOOLS.map((tool) => tool.name), [
    "list_conversations",
    "get_conversation",
    "create_conversation",
    "append_message",
    "update_conversation",
    "get_memory_context",
    "submit_task",
  ]);
});

test("get_memory_context returns durable conversation memory and recent messages", async () => {
  const meta = defaultConversationMeta();
  meta.project = "AI会社";
  meta.memory.decisions = ["MCPを本命にする"];
  meta.memory.constraints = ["追加料金なし"];
  const comment = encodeChatComment({ id: "m1", role: "owner", text: "MCPを本命にする。追加料金なし。", createdAt: "2026-09-10T00:00:00.000Z" });

  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/issues/42")) return json({ number: 42, title: "[AI Chat] MCP統合", body: encodeConversationBody(meta), created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:01:00Z" });
    if (url.includes("/issues/42/comments")) return json([{ body: comment }]);
    return json({ message: `unexpected ${url}` }, 500);
  };

  const result = await invokeRemoteMcpTool({ repository: "owner/repo", githubToken: "token", fetchImpl: fakeFetch }, "get_memory_context", { conversation_id: 42 }) as { memoryContext: string };
  assert.match(result.memoryContext, /Project: AI会社/);
  assert.match(result.memoryContext, /MCPを本命にする/);
  assert.match(result.memoryContext, /追加料金なし/);
  assert.match(result.memoryContext, /Recent conversation/);
});

test("list_conversations filters projects and keeps pinned conversations first", async () => {
  const pinned = defaultConversationMeta();
  pinned.pinned = true;
  pinned.project = "AI会社";
  const other = defaultConversationMeta();
  other.project = "別件";
  const fakeFetch: typeof fetch = async () => json([
    { number: 3, title: "[AI Chat] MCP", body: encodeConversationBody(pinned), created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T01:00:00Z" },
    { number: 2, title: "[AI Chat] Other", body: encodeConversationBody(other), created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T01:00:00Z" },
    { number: 1, title: "ordinary issue", body: "", created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T01:00:00Z" },
  ]);

  const result = await invokeRemoteMcpTool({ repository: "owner/repo", githubToken: "token", fetchImpl: fakeFetch }, "list_conversations", { project: "AI会社" }) as { conversations: Array<{ id: number; pinned: boolean }> };
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].id, 3);
  assert.equal(result.conversations[0].pinned, true);
});

test("unknown Remote MCP tools fail closed", async () => {
  await assert.rejects(() => invokeRemoteMcpTool({ repository: "owner/repo", githubToken: "token", fetchImpl: fetch }, "delete_everything", {}), /unknown Remote MCP tool/);
});
