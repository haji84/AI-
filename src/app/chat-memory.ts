export type ChatMemory = {
  decisions: string[];
  constraints: string[];
  unfinished: string[];
  references: string[];
};

export type ChatGithubBridgeState = {
  pendingOwnerMessageId: string | null;
  pendingAt: string | null;
  lastAiMessageId: string | null;
  lastSyncedAt: string | null;
};

export type ConversationMeta = {
  version: 1;
  pinned: boolean;
  project: string | null;
  memory: ChatMemory;
  githubBridge?: ChatGithubBridgeState;
};

export type PersistedChatMessage = {
  id: string;
  role: "owner" | "ai" | "system";
  text: string;
  meta?: string;
  createdAt: string;
  attachments?: Array<{ name: string; type: string; size: number; pathname?: string }>;
};

const META_START = "<!-- ai-chat-conversation:v1\n";
const META_END = "\n-->";
const ENTRY_START = "<!-- ai-chat-entry:v1\n";
const ENTRY_END = "\n-->";

function defaultGithubBridge(): ChatGithubBridgeState {
  return { pendingOwnerMessageId: null, pendingAt: null, lastAiMessageId: null, lastSyncedAt: null };
}

function normalizedGithubBridge(meta: ConversationMeta): ChatGithubBridgeState {
  return meta.githubBridge ?? defaultGithubBridge();
}

export function defaultConversationMeta(): ConversationMeta {
  return {
    version: 1,
    pinned: false,
    project: null,
    memory: { decisions: [], constraints: [], unfinished: [], references: [] },
    githubBridge: defaultGithubBridge(),
  };
}

function bounded(values: string[], value: string, limit = 16): string[] {
  const clean = value.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return values;
  return [clean, ...values.filter((item) => item !== clean)].slice(0, limit);
}

export function evolveMemory(meta: ConversationMeta, message: PersistedChatMessage): ConversationMeta {
  const memory = { ...meta.memory };
  const text = message.text.replace(/\s+/g, " ").trim();
  if (/(決定|採用|これでいく|方針|確定|decided|decision)/i.test(text)) memory.decisions = bounded(memory.decisions, text);
  if (/(条件|制約|禁止|しない|必須|追加料金なし|must|constraint|never)/i.test(text)) memory.constraints = bounded(memory.constraints, text);
  if (/(未完了|次に|次は|残り|待ち|進める|todo|next|pending)/i.test(text)) memory.unfinished = bounded(memory.unfinished, text);
  const refs = text.match(/(?:Issue|PR)\s*#\d+|https?:\/\/[^\s)]+/gi) ?? [];
  for (const ref of refs) memory.references = bounded(memory.references, ref, 24);
  for (const attachment of message.attachments ?? []) memory.references = bounded(memory.references, `file:${attachment.name}`, 24);

  let githubBridge = { ...normalizedGithubBridge(meta) };
  if (message.role === "owner") {
    githubBridge = { ...githubBridge, pendingOwnerMessageId: message.id, pendingAt: message.createdAt };
  } else if (message.role === "ai") {
    githubBridge = {
      pendingOwnerMessageId: null,
      pendingAt: null,
      lastAiMessageId: message.id,
      lastSyncedAt: message.createdAt,
    };
  }

  return { ...meta, memory, githubBridge };
}

export function encodeConversationBody(meta: ConversationMeta): string {
  const githubBridge = normalizedGithubBridge(meta);
  const normalized = { ...meta, githubBridge };
  const bridgeStatus = githubBridge.pendingOwnerMessageId ? "pending" : "synced";
  const pendingId = githubBridge.pendingOwnerMessageId ?? "none";
  return `${META_START}${JSON.stringify(normalized)}${META_END}\n\nAI会社コントロールセンターの長期会話記憶。本文のJSONはUI/APIから管理します。\n\nCHATGPT-GITHUB-BRIDGE: ${bridgeStatus}\npending-owner-message-id: ${pendingId}`;
}

export function decodeConversationBody(body: string | null | undefined): ConversationMeta {
  if (!body) return defaultConversationMeta();
  const start = body.indexOf(META_START);
  if (start < 0) return defaultConversationMeta();
  const end = body.indexOf(META_END, start + META_START.length);
  if (end < 0) return defaultConversationMeta();
  try {
    const value = JSON.parse(body.slice(start + META_START.length, end)) as Partial<ConversationMeta>;
    const base = defaultConversationMeta();
    const bridge = value.githubBridge && typeof value.githubBridge === "object" ? value.githubBridge : defaultGithubBridge();
    return {
      version: 1,
      pinned: value.pinned === true,
      project: typeof value.project === "string" && value.project.trim() ? value.project.trim().slice(0, 80) : null,
      memory: {
        decisions: Array.isArray(value.memory?.decisions) ? value.memory!.decisions.filter((x): x is string => typeof x === "string").slice(0, 16) : base.memory.decisions,
        constraints: Array.isArray(value.memory?.constraints) ? value.memory!.constraints.filter((x): x is string => typeof x === "string").slice(0, 16) : base.memory.constraints,
        unfinished: Array.isArray(value.memory?.unfinished) ? value.memory!.unfinished.filter((x): x is string => typeof x === "string").slice(0, 16) : base.memory.unfinished,
        references: Array.isArray(value.memory?.references) ? value.memory!.references.filter((x): x is string => typeof x === "string").slice(0, 24) : base.memory.references,
      },
      githubBridge: {
        pendingOwnerMessageId: typeof bridge.pendingOwnerMessageId === "string" ? bridge.pendingOwnerMessageId : null,
        pendingAt: typeof bridge.pendingAt === "string" ? bridge.pendingAt : null,
        lastAiMessageId: typeof bridge.lastAiMessageId === "string" ? bridge.lastAiMessageId : null,
        lastSyncedAt: typeof bridge.lastSyncedAt === "string" ? bridge.lastSyncedAt : null,
      },
    };
  } catch {
    return defaultConversationMeta();
  }
}

export function encodeChatComment(message: PersistedChatMessage): string {
  const safe = { ...message, text: message.text.slice(0, 8000), meta: message.meta?.slice(0, 1000) };
  const bridgeLine = message.role === "owner"
    ? `\n\nCHATGPT-GITHUB-BRIDGE-MESSAGE: pending:${message.id}`
    : message.role === "ai"
      ? `\n\nCHATGPT-GITHUB-BRIDGE-MESSAGE: ai:${message.id}`
      : "";
  return `${ENTRY_START}${JSON.stringify(safe)}${ENTRY_END}\n\n${message.role === "owner" ? "**あなた**" : message.role === "ai" ? "**AI会社**" : "**システム**"}: ${message.text}${bridgeLine}`;
}

export function decodeChatComment(body: string | null | undefined): PersistedChatMessage | null {
  if (!body) return null;
  const start = body.indexOf(ENTRY_START);
  const end = body.indexOf(ENTRY_END, start + ENTRY_START.length);
  if (start < 0 || end < 0) return null;
  try {
    const value = JSON.parse(body.slice(start + ENTRY_START.length, end)) as Partial<PersistedChatMessage>;
    if (!value.id || !value.createdAt || !value.text || !["owner", "ai", "system"].includes(value.role ?? "")) return null;
    return value as PersistedChatMessage;
  } catch {
    return null;
  }
}

export function buildMemoryContext(meta: ConversationMeta, messages: PersistedChatMessage[]): string {
  const recent = messages.slice(-12).map((m) => `${m.role}: ${m.text.replace(/\s+/g, " ").slice(0, 600)}`);
  const sections = [
    meta.project ? `Project: ${meta.project}` : "",
    meta.memory.decisions.length ? `Decisions: ${meta.memory.decisions.join(" | ")}` : "",
    meta.memory.constraints.length ? `Constraints: ${meta.memory.constraints.join(" | ")}` : "",
    meta.memory.unfinished.length ? `Unfinished: ${meta.memory.unfinished.join(" | ")}` : "",
    meta.memory.references.length ? `References: ${meta.memory.references.join(" | ")}` : "",
    recent.length ? `Recent conversation:\n${recent.join("\n")}` : "",
  ].filter(Boolean);
  return sections.join("\n").slice(0, 12000);
}
