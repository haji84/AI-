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
    "create_private_repository",
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

test("create_private_repository requires exact owner approval before any GitHub write", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return json({ message: "unexpected call" }, 500);
  };

  await assert.rejects(
    () => invokeRemoteMcpTool(
      { repository: "owner/repo", githubToken: "token", fetchImpl: fakeFetch },
      "create_private_repository",
      { name: "fire-ai-os-private", owner_approved: false, approval_text: "承認: fire-ai-os-private" },
    ),
    /Human Gate approval required/,
  );
  assert.equal(calls, 0);
});

test("create_private_repository creates only a private initialized personal repository", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenInit = init;
    return json({
      id: 123,
      name: "fire-ai-os-private",
      full_name: "owner/fire-ai-os-private",
      html_url: "https://github.com/owner/fire-ai-os-private",
      private: true,
      visibility: "private",
      default_branch: "main",
      owner: { login: "owner" },
    });
  };

  const result = await invokeRemoteMcpTool(
    { repository: "owner/repo", githubToken: "token", fetchImpl: fakeFetch },
    "create_private_repository",
    {
      name: "fire-ai-os-private",
      description: "消防AI OS",
      owner_approved: true,
      approval_text: "承認: fire-ai-os-private",
    },
  ) as { created: boolean; repository: string; private: boolean; defaultBranch: string };

  assert.equal(seenUrl, "https://api.github.com/user/repos");
  assert.equal(seenInit?.method, "POST");
  const body = JSON.parse(String(seenInit?.body));
  assert.deepEqual(body, {
    name: "fire-ai-os-private",
    description: "消防AI OS",
    private: true,
    auto_init: true,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
  });
  assert.equal(result.created, true);
  assert.equal(result.repository, "owner/fire-ai-os-private");
  assert.equal(result.private, true);
  assert.equal(result.defaultBranch, "main");
});

test("create_private_repository rejects invalid names before calling GitHub", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  await assert.rejects(
    () => invokeRemoteMcpTool(
      { repository: "owner/repo", githubToken: "token", fetchImpl: fakeFetch },
      "create_private_repository",
      { name: "bad/name", owner_approved: true, approval_text: "CREATE PRIVATE REPOSITORY bad/name" },
    ),
    /repository name/,
  );
  assert.equal(calls, 0);
});

test("unknown Remote MCP tools fail closed", async () => {
  await assert.rejects(() => invokeRemoteMcpTool({ repository: "owner/repo", githubToken: "token", fetchImpl: fetch }, "delete_everything", {}), /unknown Remote MCP tool/);
});
