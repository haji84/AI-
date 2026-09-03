import type { GoalRecord, StateRecord } from "../compass/store.ts";
import type { CommandIngressSource } from "./command-ingress.ts";
import {
  inferReasoningTaskSignals,
  routeReasoningTask,
  type ReasoningRoutingDecision,
  type ReasoningSoftBudgets,
  type ReasoningUsage,
} from "./reasoning-router.ts";

export interface ReasoningFeedback {
  version: 1;
  goal: GoalRecord | null;
  status: string | null;
  commandSource: CommandIngressSource | null;
  command: string | null;
  blockers: unknown[];
  verificationSummary: string | null;
  nextAction: string | null;
  report: unknown;
  reasoningRequired: boolean;
  humanApprovalRequired: boolean;
  reasoningRoute: ReasoningRoutingDecision;
  generatedAt: string;
}

export interface BuildReasoningFeedbackInput {
  goal: GoalRecord | null;
  state: StateRecord;
  status: string | null;
  commandSource: CommandIngressSource | null;
  command: string | null;
  blockers?: unknown[];
  verificationSummary?: string | null;
  nextAction?: string | null;
  report?: unknown;
  reasoningUsage?: ReasoningUsage;
  reasoningSoftBudgets?: ReasoningSoftBudgets;
  generatedAt?: string;
}

function textSignalsApproval(value: unknown): boolean {
  if (typeof value === "string") return /approval_required|human[_ -]?gate|human approval/i.test(value);
  if (Array.isArray(value)) return value.some(textSignalsApproval);
  if (value && typeof value === "object") return Object.values(value).some(textSignalsApproval);
  return false;
}

export function buildReasoningFeedback(input: BuildReasoningFeedbackInput): ReasoningFeedback {
  const blockers = input.blockers ?? input.state.blockers;
  const verificationSummary = input.verificationSummary === undefined
    ? input.state.verificationSummary
    : input.verificationSummary;
  const nextAction = input.nextAction === undefined ? input.state.nextAction : input.nextAction;
  const status = input.status ?? input.state.status;
  const humanApprovalRequired = textSignalsApproval(status)
    || textSignalsApproval(blockers)
    || textSignalsApproval(input.report);
  const reasoningRequired = humanApprovalRequired
    || blockers.length > 0
    || status === "awaiting_command"
    || status === "goal_draft_not_ready"
    || status === "stale_command_invalidated";
  const routeText = nextAction?.trim() || input.command?.trim() || "Review current status and decide the next bounded step";
  const reasoningRoute = routeReasoningTask(
    inferReasoningTaskSignals(routeText),
    input.reasoningUsage,
    input.reasoningSoftBudgets,
  );

  return {
    version: 1,
    goal: input.goal,
    status,
    commandSource: input.commandSource,
    command: input.command,
    blockers,
    verificationSummary,
    nextAction,
    report: input.report ?? null,
    reasoningRequired,
    humanApprovalRequired,
    reasoningRoute,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
