import { createHash } from "node:crypto";
import type { NormalizedCommand } from "./command-ingress.ts";
import type {
  GoalControllerDecision,
  GoalControllerRuntime,
  IntakeIntent,
  IntakeSource,
} from "./goal-controller-runtime.ts";
import type { SharedContextKind, SharedContextRecord, SharedContextStore } from "./shared-context.ts";
import { SharedContextResolver } from "./shared-context.ts";

export interface UnifiedIntakeRouteResult {
  decision: GoalControllerDecision;
  relevantContext: SharedContextRecord[];
  recordedContext: SharedContextRecord;
}

function runtimeSource(source: NormalizedCommand["source"]): IntakeSource {
  if (source === "chat") return "chat";
  return "codex";
}

function stableIdempotencyKey(command: NormalizedCommand): string {
  const stable = JSON.stringify({
    source: runtimeSource(command.source),
    command: command.command,
    goalId: command.goalId ?? null,
    conversationId: command.conversationId ?? null,
  });
  return `command-${createHash("sha256").update(stable).digest("hex")}`;
}

function contextKind(intent: IntakeIntent): SharedContextKind {
  if (intent === "QUESTION") return "QUESTION";
  if (intent === "INSPECTION") return "INSPECTION";
  if (intent === "GOAL") return "GOAL";
  if (intent === "DEVELOPMENT_TASK") return "DEVELOPMENT_TASK";
  return "COMMAND";
}

/**
 * Common adapter for Chat/Work/Codex development commands.
 *
 * It deliberately does not execute capabilities. It only resolves bounded shared
 * context, routes the request through GoalControllerRuntime, and records a
 * context-only projection. Existing Goal/WorkState/Evidence stores remain the
 * authority for execution and completion.
 */
export async function routeCommandThroughUnifiedIntake(input: {
  command: NormalizedCommand;
  runtime: GoalControllerRuntime;
  contextStore: SharedContextStore;
}): Promise<UnifiedIntakeRouteResult> {
  const resolver = new SharedContextResolver(input.contextStore);
  const relevantContext = await resolver.resolve({
    text: input.command.command,
    goalId: input.command.goalId,
  });
  const idempotencyKey = stableIdempotencyKey(input.command);
  const source = runtimeSource(input.command.source);
  const decision = await input.runtime.handle({
    source,
    text: input.command.command,
    idempotencyKey,
    goalHint: input.command.goalId,
    sourceContext: {
      ...(input.command.conversationId ? { conversationId: input.command.conversationId } : {}),
      relevantContext: relevantContext.map((record) => ({
        id: record.id,
        kind: record.kind,
        text: record.text,
        goalId: record.goalId,
        authority: record.authority,
      })),
    },
  });

  const recordedContext = await input.contextStore.put({
    id: `intake-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20)}`,
    kind: contextKind(decision.resolution.intent),
    source,
    text: input.command.command,
    goalId: decision.goalId ?? input.command.goalId,
    metadata: {
      resolution: decision.resolution.kind,
      action: decision.action,
      ...(input.command.conversationId ? { conversationId: input.command.conversationId } : {}),
    },
  });

  return { decision, relevantContext, recordedContext };
}
