import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReasoningFeedback } from "../orchestrator/reasoning-feedback.ts";
import type { ReasoningExecutionMode, ReasoningRouteStatus, ReasoningSurface } from "../orchestrator/reasoning-router.ts";
import { readReasoningFeedbackFromGitHubArtifact } from "./github-artifact-state.ts";

export interface DashboardDecision {
  title: string;
  detail: string;
  risk: "HIGH";
  reasons: string[];
  approvalKey: string;
}

export interface DashboardReasoningState {
  surface: ReasoningSurface;
  routeStatus: ReasoningRouteStatus;
  reason: string;
  executionMode: ReasoningExecutionMode;
  maxChunkSteps: number | null;
  approvalRequired: boolean;
  approvalSurface: Exclude<ReasoningSurface, "chat"> | null;
  continuationSurfaceOptions: ReasoningSurface[];
}

export interface DashboardState {
  status: string;
  generatedAt: string | null;
  decisions: DashboardDecision[];
  riskLevel: string | null;
  nextAction: string | null;
  verificationSummary: string | null;
  reasoning: DashboardReasoningState | null;
}

const FEEDBACK_PATH = join(process.cwd(), ".autonomy-state", "reasoning-feedback.json");

export function dashboardStateFromFeedback(feedback: ReasoningFeedback | null): DashboardState {
  if (!feedback) {
    return {
      status: "待機中",
      generatedAt: null,
      decisions: [],
      riskLevel: null,
      nextAction: null,
      verificationSummary: null,
      reasoning: null,
    };
  }

  const risk = feedback.riskDecision;
  const needsOwner = feedback.humanApprovalRequired
    && !feedback.approvalSatisfied
    && risk?.level === "HIGH"
    && Boolean(feedback.approvalKey);
  const route = feedback.reasoningRoute;
  return {
    status: feedback.status ?? "稼働中",
    generatedAt: feedback.generatedAt,
    decisions: needsOwner
      ? [{
          title: feedback.nextAction?.trim() || "高リスク操作の承認",
          detail: "AI社員はここで停止しています。内容を確認して判断してください。",
          risk: "HIGH",
          reasons: risk.reasons,
          approvalKey: feedback.approvalKey as string,
        }]
      : [],
    riskLevel: risk?.level ?? null,
    nextAction: feedback.nextAction,
    verificationSummary: feedback.verificationSummary,
    reasoning: {
      surface: route.surface,
      routeStatus: route.status,
      reason: route.reason,
      executionMode: route.executionMode,
      maxChunkSteps: route.maxChunkSteps,
      approvalRequired: route.approvalRequired,
      approvalSurface: route.approvalSurface,
      continuationSurfaceOptions: [...route.continuationSurfaceOptions],
    },
  };
}

async function readLocalReasoningFeedback(): Promise<ReasoningFeedback | null> {
  try {
    const raw = await readFile(FEEDBACK_PATH, "utf-8");
    return JSON.parse(raw) as ReasoningFeedback;
  } catch {
    return null;
  }
}

export async function readDashboardState(): Promise<DashboardState> {
  const local = await readLocalReasoningFeedback();
  if (local) return dashboardStateFromFeedback(local);

  const remote = await readReasoningFeedbackFromGitHubArtifact();
  return dashboardStateFromFeedback(remote);
}
