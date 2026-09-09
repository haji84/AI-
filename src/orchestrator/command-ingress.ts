import type { ModelPlan } from "./model-planner.ts";
import { normalizeGoalDraft, type GoalDraft } from "./goal-draft.ts";
import {
  normalizeTaskCompletionAuthorization,
  type TaskCompletionAuthorization,
} from "./task-authorization.ts";

export type CommandIngressSource = "chat" | "work" | "codex";

export interface CommandAttachment {
  name: string;
  contentType: string;
  size: number;
  pathname: string;
  readUrl: string;
  expiresAt: string;
}

export interface UnifiedCommandEnvelope {
  source: CommandIngressSource;
  command: string;
  goalId?: string;
  conversationId?: string;
  goalDraft?: GoalDraft;
  plan?: ModelPlan;
  taskAuthorization?: TaskCompletionAuthorization;
  attachments?: CommandAttachment[];
}

export interface NormalizedCommand {
  source: CommandIngressSource;
  command: string;
  goalId?: string;
  conversationId?: string;
  goalDraft?: GoalDraft;
  plan?: ModelPlan;
  taskAuthorization?: TaskCompletionAuthorization;
  attachments?: CommandAttachment[];
}

const SOURCES: readonly CommandIngressSource[] = ["chat", "work", "codex"];
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 512 * 1024 * 1024;

function normalizeAttachment(value: unknown): CommandAttachment {
  if (!value || typeof value !== "object") throw new Error("Command attachment is invalid");
  const item = value as Partial<CommandAttachment>;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const contentType = typeof item.contentType === "string" && item.contentType.trim()
    ? item.contentType.trim()
    : "application/octet-stream";
  const pathname = typeof item.pathname === "string" ? item.pathname.trim() : "";
  const readUrl = typeof item.readUrl === "string" ? item.readUrl.trim() : "";
  const expiresAt = typeof item.expiresAt === "string" ? item.expiresAt.trim() : "";
  const size = Number(item.size);
  if (!name || name.length > 180) throw new Error("Command attachment name is invalid");
  if (!pathname.startsWith("ai-chat/")) throw new Error("Command attachment pathname is invalid");
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_SIZE) throw new Error("Command attachment size is invalid");
  if (!readUrl.startsWith("https://") || !readUrl.includes(".private.blob.vercel-storage.com/")) {
    throw new Error("Command attachment read URL must be a private Vercel Blob signed URL");
  }
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error("Command attachment expiry is invalid");
  return { name, contentType, size, pathname, readUrl, expiresAt };
}

function normalizeAttachments(value: unknown): CommandAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new Error(`Command attachments must contain at most ${MAX_ATTACHMENTS} files`);
  return value.map(normalizeAttachment);
}

export function normalizeCommandEnvelope(value: unknown): NormalizedCommand {
  if (!value || typeof value !== "object") throw new Error("Chat/Work/Codex command envelope is missing or invalid");
  const envelope = value as Partial<UnifiedCommandEnvelope>;
  if (!envelope.source || !SOURCES.includes(envelope.source as CommandIngressSource)) {
    throw new Error("Chat/Work/Codex command source must be chat, work, or codex");
  }
  if (typeof envelope.command !== "string" || !envelope.command.trim()) {
    throw new Error("Chat/Work/Codex command must be a non-empty string");
  }
  const attachments = normalizeAttachments(envelope.attachments);
  return {
    source: envelope.source as CommandIngressSource,
    command: envelope.command.trim(),
    goalId: envelope.goalId?.trim() || undefined,
    conversationId: envelope.conversationId?.trim() || undefined,
    ...(envelope.goalDraft === undefined ? {} : { goalDraft: normalizeGoalDraft(envelope.goalDraft) }),
    plan: envelope.plan,
    ...(envelope.taskAuthorization === undefined
      ? {}
      : { taskAuthorization: normalizeTaskCompletionAuthorization(envelope.taskAuthorization) }),
    ...(attachments?.length ? { attachments } : {}),
  };
}

export function parseUnifiedCommandEnvelope(json: string): NormalizedCommand {
  if (!json.trim()) throw new Error("Chat/Work/Codex command handoff is required");
  try {
    return normalizeCommandEnvelope(JSON.parse(json));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Chat/Work/Codex command handoff is not valid JSON");
    throw error;
  }
}
