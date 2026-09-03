import type { ModelPlan } from "./model-planner.ts";

export type CommandIngressSource = "chat" | "work" | "codex";

export interface UnifiedCommandEnvelope {
  source: CommandIngressSource;
  command: string;
  goalId?: string;
  conversationId?: string;
  plan?: ModelPlan;
}

export interface NormalizedCommand {
  source: CommandIngressSource;
  command: string;
  goalId?: string;
  conversationId?: string;
  plan?: ModelPlan;
}

const SOURCES: readonly CommandIngressSource[] = ["chat", "work", "codex"];

export function normalizeCommandEnvelope(value: unknown): NormalizedCommand {
  if (!value || typeof value !== "object") throw new Error("Chat/Work/Codex command envelope is missing or invalid");
  const envelope = value as Partial<UnifiedCommandEnvelope>;
  if (!envelope.source || !SOURCES.includes(envelope.source as CommandIngressSource)) {
    throw new Error("Chat/Work/Codex command source must be chat, work, or codex");
  }
  if (typeof envelope.command !== "string" || !envelope.command.trim()) {
    throw new Error("Chat/Work/Codex command must be a non-empty string");
  }
  return {
    source: envelope.source as CommandIngressSource,
    command: envelope.command.trim(),
    goalId: envelope.goalId?.trim() || undefined,
    conversationId: envelope.conversationId?.trim() || undefined,
    plan: envelope.plan,
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
