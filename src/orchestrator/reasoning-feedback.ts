import type { GoalRecord, StateRecord } from "../compass/store.ts";
import type { CommandIngressSource } from "./command-ingress.ts";
import type { RiskDecision } from "./risk-policy.ts";
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
  riskDecision: RiskDecision | null;
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

function findRiskDecision(value: unknown): RiskDecision | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findRiskDecision(value[index]);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidate = record.riskDecision;
  if (candidate && typeof candidate === "object") return candidate as RiskDecision;
  for (const nested of Object.values(record)) {
    const found = findRiskDecision(nested);
    if (found) return found;
  }
  return null;
}

export function buildReasoningFeedback(input: BuildReasoningFeedbackInput): ReasoningFeedback {
  const blockers = input.blockers ?? input.state.blockers;
  const verificationSummary = input.verificationSummary === undefined
    ? input.state.verificationSummary
    : input.verificationSummary;
  const nextAction = input.nextAction === undefined ? input.state.nextAction : input.nextAction;
  const status = input.status ?? input.state.status;
  const riskDecision = findRiskDecision(input.report);
  const humanApprovalRequired = riskDecision?.humanApprovalRequired === true
    || textSignalsApproval(status)
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
    riskDecision,
    reasoningRequired,
    humanApprovalRequired,
    reasoningRoute,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
