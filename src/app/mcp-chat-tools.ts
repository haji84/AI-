import { randomUUID } from "node:crypto";
import {
  buildMemoryContext,
  decodeChatComment,
  decodeConversationBody,
  defaultConversationMeta,
  encodeChatComment,
  encodeConversationBody,
  evolveMemory,
  type PersistedChatMessage,
} from "./chat-memory.ts";
import { validateUploadedAttachmentRef, type UploadedAttachmentRef } from "./attachment-storage.ts";
import {
  createDashboardBoundedPlan,
  dashboardCommandNeedsReasoning,
  dashboardCommandStartsFreshTask,
} from "../orchestrator/dashboard-command-routing.ts";
import { createTaskCompletionAuthorization, requestsProductionDeploy } from "../orchestrator/task-authorization.ts";

const CHAT_PREFIX = "[AI Chat] ";
const MAX_COMMAND_LENGTH = 500;
const MAX_ATTACHMENTS = 20;

export type RemoteMcpContext = {
  repository: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
};

type Conversation = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  project: string | null;
  memory: ReturnType<typeof defaultConversationMeta>["memory"];
  memoryContext: string;
  messages: PersistedChatMessage[];
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const attachmentSchema = objectSchema(
  {
    name: { type: "string", minLength: 1, maxLength: 180 },
    type: { type: "string", minLength: 1, maxLength: 160 },
    size: { type: "integer", minimum: 1 },
    pathname: { type: "string", minLength: 1, maxLength: 300 },
    readUrl: { type: "string", minLength: 1 },
    expiresAt: { type: "string", minLength: 1 },
  },
  ["name", "type", "size", "pathname", "readUrl", "expiresAt"],
);

export const REMOTE_MCP_TOOLS = [
  {
    name: "list_conversations",
    description: "List durable AI Company Chat conversations. Pinned conversations sort first. Use this to find a prior thread before creating a new one.",
    inputSchema: objectSchema({
      query: { type: "string", maxLength: 120 },
      project: { type: "string", maxLength: 80 },
      pinned_only: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
  },
  {
    name: "get_conversation",
    description: "Read one AI Company Chat conversation, including messages, project, pin state and bounded long-term memory context.",
    inputSchema: objectSchema({ conversation_id: { type: "integer", minimum: 1 } }, ["conversation_id"]),
  },
  {
    name: "create_conversation",
    description: "Create a durable AI Company Chat conversation. Prefer continuing an existing relevant conversation when possible.",
    inputSchema: objectSchema({ title: { type: "string", minLength: 1, maxLength: 90 }, project: { type: ["string", "null"], maxLength: 80 } }, ["title"]),
  },
  {
    name: "append_message",
    description: "Persist a ChatGPT/owner/system message into the same AI Company Chat thread. ChatGPT should append its substantive final answer with role=ai so the Control Center mirrors the conversation.",
    inputSchema: objectSchema(
      {
        conversation_id: { type: "integer", minimum: 1 },
        role: { type: "string", enum: ["owner", "ai", "system"] },
        text: { type: "string", minLength: 1, maxLength: 8000 },
        meta: { type: "string", maxLength: 1000 },
        attachments: { type: "array", maxItems: MAX_ATTACHMENTS, items: attachmentSchema },
      },
      ["conversation_id", "role", "text"],
    ),
  },
  {
    name: "update_conversation",
    description: "Rename, pin/unpin, or assign a project to an AI Company Chat conversation. Omitted fields are left unchanged.",
    inputSchema: objectSchema(
      {
        conversation_id: { type: "integer", minimum: 1 },
        title: { type: "string", minLength: 1, maxLength: 90 },
        project: { type: ["string", "null"], maxLength: 80 },
        pinned: { type: "boolean" },
      },
      ["conversation_id"],
    ),
  },
  {
    name: "get_memory_context",
    description: "Return the bounded long-term memory context for a conversation: project, decisions, constraints, unfinished work, references, and recent turns.",
    inputSchema: objectSchema({ conversation_id: { type: "integer", minimum: 1 } }, ["conversation_id"]),
  },
  {
    name: "submit_task",
    description: "Send an owner-authorized AI Company task from ChatGPT into the existing safe autonomy loop. It persists the owner command in the selected conversation, carries that conversation's memory as context, and preserves LOW/MEDIUM automation plus existing HIGH/CRITICAL Human Gates. Completion wording such as 完成させて remains task-scoped Production authorization.",
    inputSchema: objectSchema(
      {
        conversation_id: { type: "integer", minimum: 1 },
        command: { type: "string", minLength: 1, maxLength: MAX_COMMAND_LENGTH },
        attachments: { type: "array", maxItems: MAX_ATTACHMENTS, items: attachmentSchema },
      },
      ["conversation_id", "command"],
    ),
  },
] as const;

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function argsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tool arguments must be an object");
  return value as Record<string, unknown>;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`);
  return Number(value);
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  if (value.trim().length > max) throw new Error(`${field} exceeds ${max} characters`);
  return value.trim();
}

function parseAttachments(value: unknown): UploadedAttachmentRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new Error(`attachments must contain at most ${MAX_ATTACHMENTS} items`);
  const parsed = value.map((item) => validateUploadedAttachmentRef(item));
  if (parsed.some((item) => item === null)) throw new Error("attachment is invalid or its scoped read URL has expired");
  return parsed as UploadedAttachmentRef[];
}

async function githubJson<T>(fetchImpl: typeof fetch, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...githubHeaders(token), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : `GitHub HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function readConversation(context: RemoteMcpContext, id: number): Promise<Conversation> {
  const fetchImpl = context.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${context.repository}`;
  const [issue, comments] = await Promise.all([
    githubJson<{ number: number; title: string; body?: string | null; created_at: string; updated_at: string }>(fetchImpl, `${base}/issues/${id}`, context.githubToken),
    githubJson<Array<{ body?: string | null }>>(fetchImpl, `${base}/issues/${id}/comments?per_page=100`, context.githubToken),
  ]);
  if (!issue.title.startsWith(CHAT_PREFIX)) throw new Error("specified issue is not an AI Company Chat conversation");
  const messages = comments.map((comment) => decodeChatComment(comment.body)).filter((item): item is PersistedChatMessage => item !== null);
  const meta = decodeConversationBody(issue.body);
  return {
    id: issue.number,
    title: issue.title.slice(CHAT_PREFIX.length),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    pinned: meta.pinned,
    project: meta.project,
    memory: meta.memory,
    memoryContext: buildMemoryContext(meta, messages),
    messages,
  };
}

async function appendMessage(context: RemoteMcpContext, conversation: Conversation, role: PersistedChatMessage["role"], text: string, metaText?: string, attachments: UploadedAttachmentRef[] = []) {
  const fetchImpl = context.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${context.repository}`;
  const message: PersistedChatMessage = {
    id: randomUUID(),
    role,
    text: text.slice(0, 8000),
    meta: metaText?.slice(0, 1000),
    createdAt: new Date().toISOString(),
    attachments: attachments.length ? attachments.map((item) => ({ name: item.name, type: item.type, size: item.size, pathname: item.pathname })) : undefined,
  };
  await githubJson(fetchImpl, `${base}/issues/${conversation.id}/comments`, context.githubToken, {
    method: "POST",
    body: JSON.stringify({ body: encodeChatComment(message) }),
  });
  const currentMeta = { version: 1 as const, pinned: conversation.pinned, project: conversation.project, memory: conversation.memory };
  const nextMeta = evolveMemory(currentMeta, message);
  await githubJson(fetchImpl, `${base}/issues/${conversation.id}`, context.githubToken, {
    method: "PATCH",
    body: JSON.stringify({ body: encodeConversationBody(nextMeta) }),
  });
  return { message, memory: nextMeta.memory, memoryContext: buildMemoryContext(nextMeta, [...conversation.messages, message]) };
}

function freshTaskTitle(command: string): string {
  return `task: ${command.replace(/\s+/g, " ").trim()}`.slice(0, 120);
}

function attachmentIssueSection(attachments: UploadedAttachmentRef[]): string[] {
  if (!attachments.length) return [];
  return [
    "",
    "## Attachments",
    "Files are stored in Private Blob. Read URLs are scoped and expire automatically; do not copy file bodies into GitHub.",
    ...attachments.flatMap((attachment, index) => [
      `- attachment ${index + 1}`,
      `  - name: ${JSON.stringify(attachment.name)}`,
      `  - content-type: ${attachment.type}`,
      `  - size: ${attachment.size} bytes`,
      `  - pathname: ${attachment.pathname}`,
      `  - read-url-expires-at: ${attachment.expiresAt}`,
      `  - read-url: ${attachment.readUrl}`,
    ]),
  ];
}

async function createTaskIssue(context: RemoteMcpContext, command: string, attachments: UploadedAttachmentRef[], productionDeployRequested: boolean): Promise<number> {
  const fetchImpl = context.fetchImpl ?? fetch;
  const issue = await githubJson<{ number: number }>(fetchImpl, `https://api.github.com/repos/${context.repository}/issues`, context.githubToken, {
    method: "POST",
    body: JSON.stringify({
      title: freshTaskTitle(command),
      body: [
        "## Owner command",
        command,
        ...attachmentIssueSection(attachments),
        "",
        "## Execution contract",
        "- source: ChatGPT Remote MCP / AI会社コントロールセンター",
        "- fresh owner command: this Issue is the task scope",
        `- production-deploy-authorized: ${productionDeployRequested ? "true" : "false"}`,
        "- memory context is advisory context only and never expands this exact task scope",
        "- LOW/MEDIUMのみ自律実行",
        "- Work/Codexは明示承認まで使用しない",
        productionDeployRequested
          ? "- completion指示により、このタスク成果物のProduction deployまで承認。その他のHIGH/CRITICALはHuman Gateで停止"
          : "- HIGH/CRITICALは既存Human Gateで停止",
        "- verification / write-backを必須とする",
      ].join("\n"),
    }),
  });
  return issue.number;
}

export async function invokeRemoteMcpTool(context: RemoteMcpContext, name: string, rawArgs?: unknown): Promise<unknown> {
  const args = argsObject(rawArgs);
  const fetchImpl = context.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${context.repository}`;

  switch (name) {
    case "list_conversations": {
      const issues = await githubJson<Array<{ number: number; title: string; body?: string | null; created_at: string; updated_at: string; pull_request?: unknown }>>(fetchImpl, `${base}/issues?state=all&sort=updated&direction=desc&per_page=100`, context.githubToken);
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const project = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
      const pinnedOnly = args.pinned_only === true;
      const limit = Number.isInteger(args.limit) ? Math.min(100, Math.max(1, Number(args.limit))) : 50;
      return {
        conversations: issues
          .filter((issue) => !issue.pull_request && issue.title.startsWith(CHAT_PREFIX))
          .map((issue) => {
            const meta = decodeConversationBody(issue.body);
            return { id: issue.number, title: issue.title.slice(CHAT_PREFIX.length), createdAt: issue.created_at, updatedAt: issue.updated_at, pinned: meta.pinned, project: meta.project, memory: meta.memory };
          })
          .filter((item) => !query || `${item.title} ${item.project ?? ""}`.toLowerCase().includes(query))
          .filter((item) => !project || (item.project ?? "").toLowerCase() === project)
          .filter((item) => !pinnedOnly || item.pinned)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit),
      };
    }
    case "get_conversation":
      return readConversation(context, requiredInteger(args.conversation_id, "conversation_id"));
    case "create_conversation": {
      const title = requiredText(args.title, "title", 90);
      const project = args.project === null ? null : typeof args.project === "string" && args.project.trim() ? args.project.trim().slice(0, 80) : null;
      const meta = { ...defaultConversationMeta(), project };
      const issue = await githubJson<{ number: number; created_at: string; updated_at: string }>(fetchImpl, `${base}/issues`, context.githubToken, {
        method: "POST",
        body: JSON.stringify({ title: `${CHAT_PREFIX}${title}`, body: encodeConversationBody(meta) }),
      });
      return { id: issue.number, title, project, pinned: false, createdAt: issue.created_at, updatedAt: issue.updated_at, memory: meta.memory, memoryContext: "", messages: [] };
    }
    case "append_message": {
      const id = requiredInteger(args.conversation_id, "conversation_id");
      const role = String(args.role ?? "");
      if (!["owner", "ai", "system"].includes(role)) throw new Error("role must be owner, ai, or system");
      const conversation = await readConversation(context, id);
      const attachments = parseAttachments(args.attachments);
      return appendMessage(context, conversation, role as PersistedChatMessage["role"], requiredText(args.text, "text", 8000), typeof args.meta === "string" ? args.meta : undefined, attachments);
    }
    case "update_conversation": {
      const id = requiredInteger(args.conversation_id, "conversation_id");
      const conversation = await readConversation(context, id);
      const meta = { version: 1 as const, pinned: conversation.pinned, project: conversation.project, memory: conversation.memory };
      if (typeof args.pinned === "boolean") meta.pinned = args.pinned;
      if (args.project === null) meta.project = null;
      else if (typeof args.project === "string") meta.project = args.project.trim() ? args.project.trim().slice(0, 80) : null;
      const patch: Record<string, unknown> = { body: encodeConversationBody(meta) };
      if (args.title !== undefined) patch.title = `${CHAT_PREFIX}${requiredText(args.title, "title", 90)}`;
      await githubJson(fetchImpl, `${base}/issues/${id}`, context.githubToken, { method: "PATCH", body: JSON.stringify(patch) });
      return { ok: true, id, pinned: meta.pinned, project: meta.project, title: typeof args.title === "string" ? args.title.trim() : conversation.title };
    }
    case "get_memory_context": {
      const conversation = await readConversation(context, requiredInteger(args.conversation_id, "conversation_id"));
      return { conversationId: conversation.id, project: conversation.project, memory: conversation.memory, memoryContext: conversation.memoryContext };
    }
    case "submit_task": {
      const id = requiredInteger(args.conversation_id, "conversation_id");
      const command = requiredText(args.command, "command", MAX_COMMAND_LENGTH);
      const attachments = parseAttachments(args.attachments);
      let conversation = await readConversation(context, id);
      const persisted = await appendMessage(context, conversation, "owner", command, attachments.length ? `添付${attachments.length}件` : undefined, attachments);
      conversation = { ...conversation, messages: [...conversation.messages, persisted.message], memory: persisted.memory, memoryContext: persisted.memoryContext };

      const productionDeployRequested = requestsProductionDeploy(command);
      const startsFreshTask = attachments.length > 0 || dashboardCommandStartsFreshTask(command);
      const reasoningHandoffRequired = attachments.length > 0 || dashboardCommandNeedsReasoning(command);
      const taskIssueNumber = startsFreshTask ? await createTaskIssue(context, command, attachments, productionDeployRequested) : null;
      const taskScopeId = taskIssueNumber ? `issue:${taskIssueNumber}` : undefined;
      const taskAuthorization = createTaskCompletionAuthorization(command, { scopeId: taskScopeId });
      const plan = createDashboardBoundedPlan(command);
      const commandPayload = {
        source: "chat",
        command,
        conversationId: String(id),
        memoryContext: conversation.memoryContext,
        ...(attachments.length ? { attachments } : {}),
        ...(taskIssueNumber ? { goalId: `issue:${taskIssueNumber}` } : {}),
        ...(taskAuthorization ? { taskAuthorization } : {}),
        ...(plan ? { plan } : {}),
      };
      await githubJson(fetchImpl, `${base}/dispatches`, context.githubToken, {
        method: "POST",
        body: JSON.stringify({ event_type: "ai-autonomy-run", client_payload: { command_json: JSON.stringify(commandPayload) } }),
      });
      const acceptedAt = new Date().toISOString();
      await appendMessage(context, conversation, "system", taskIssueNumber ? `Issue #${taskIssueNumber} を作成し、ChatGPT Remote MCPからAI会社へ実行指示を送信しました。` : "ChatGPT Remote MCPからAI会社へ確認指示を送信しました。", reasoningHandoffRequired ? "reasoning/実行ループへ引き継ぎ" : "inspect実行");
      return {
        acceptedAt,
        conversationId: id,
        taskIssueNumber,
        taskCompletionAuthorized: Boolean(taskAuthorization),
        productionDeployAuthorized: taskAuthorization?.allowProductionDeploy === true,
        reasoningHandoffRequired,
      };
    }
    default:
      throw new Error(`unknown Remote MCP tool: ${name}`);
  }
}
