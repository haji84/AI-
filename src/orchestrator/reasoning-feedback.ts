import type { GoalRecord, StateRecord } from "../compass/store.ts";
import { parseUnifiedCommandEnvelope, type CommandAttachment, type CommandIngressSource } from "./command-ingress.ts";
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
  attachments: CommandAttachment[];
  blockers: unknown[];
  verificationSummary: string | null;
  nextAction: string | null;
  report: unknown;
  riskDecision: RiskDecision | null;
  approvalKey: string | null;
  approvalSatisfied: boolean;
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
  attachments?: CommandAttachment[];
  blockers?: unknown[];
  verificationSummary?: string | null;
  nextAction?: string | null;
  report?: unknown;
  reasoningUsage?: ReasoningUsage;
  reasoningSoftBudgets?: ReasoningSoftBudgets;
  generatedAt?: string;
}

function attachmentsFromFreshCommandEnv(): CommandAttachment[] {
  const raw = process.env.AUTONOMY_COMMAND_JSON?.trim() || "";
  if (!raw) return [];
  try {
    return parseUnifiedCommandEnvelope(raw).attachments ?? [];
  } catch {
    return [];
  }
}

function textSignalsApproval(value: unknown): boolean {
  if (typeof value === "string") return /approval_required|human[_ -]?gate|human approval/i.test(value);
  if (Array.isArray(value)) return value.some(textSignalsApproval);
  if (value && typeof value === "object") return Object.values(value).some(textSignalsApproval);
  return false;
}

function findLatestRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findLatestRecord(value[index]);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.riskDecision || record.approvalKey || record.approvalSatisfied !== undefined) return record;
  const nestedValues = Object.values(record);
  for (let index = nestedValues.length - 1; index >= 0; index -= 1) {
    const found = findLatestRecord(nestedValues[index]);
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
  const latest = findLatestRecord(input.report);
  const riskDecision = latest?.riskDecision && typeof latest.riskDecision === "object"
    ? latest.riskDecision as RiskDecision
    : null;
  const approvalKey = typeof latest?.approvalKey === "string" && latest.approvalKey.trim()
    ? latest.approvalKey
    : null;
  const approvalSatisfied = latest?.approvalSatisfied === true;
  const humanApprovalRequired = !approvalSatisfied && (
    riskDecision?.humanApprovalRequired === true
    || textSignalsApproval(status)
    || textSignalsApproval(blockers)
    || textSignalsApproval(input.report)
  );
  const reasoningRequired = humanApprovalRequired
    || blockers.length > 0
    || status === "awaiting_command"
    || status === "goal_draft_not_ready"
    || status === "stale_command_invalidated";
  const routeText = nextAction?.trim() || input.command?.trim() || "Review current status and decide the next bounded step";
  const routeSignals = inferReasoningTaskSignals(routeText);
  const commandSignals = input.command ? inferReasoningTaskSignals(input.command) : null;
  if (commandSignals?.approvedSurface) routeSignals.approvedSurface = commandSignals.approvedSurface;
  const reasoningRoute = routeReasoningTask(
    routeSignals,
    input.reasoningUsage,
    input.reasoningSoftBudgets,
  );

  return {
    version: 1,
    goal: input.goal,
    status,
    commandSource: input.commandSource,
    command: input.command,
    attachments: input.attachments ?? attachmentsFromFreshCommandEnv(),
    blockers,
    verificationSummary,
    nextAction,
    report: input.report ?? null,
    riskDecision,
    approvalKey,
    approvalSatisfied,
    reasoningRequired,
    humanApprovalRequired,
    reasoningRoute,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}
