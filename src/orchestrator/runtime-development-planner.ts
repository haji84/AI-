import type { ActionResult, ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { goalWorkStateId } from "./work-state-integration.ts";

const DEVELOPMENT_MARKERS = /(code|coding|implement|implementation|fix|repair|refactor|test|build|source|repository|script|patch|develop|development|コード|実装|修正|改修|開発|テスト)/i;
const IMPLEMENTATION_DOD_MARKERS = /(code|implement|implementation|fix|repair|refactor|source|script|patch|develop|development|コード|実装|修正|改修|開発)/i;
const VERIFICATION_DOD_MARKERS = /(^|[^a-z])(test|tests|verify|verification|lint|build|security|review|deploy)([^a-z]|$)|テスト|検証|確認|ビルド|セキュリティ|レビュー|デプロイ/i;
const PROMOTION_DOD_MARKERS = /(^|[^a-z])(test|tests|lint|build|pull request|pr|proposal|review)([^a-z]|$)|テスト|ビルド|プルリク|PR作成|レビュー/i;
const PROMOTION_EXCLUDE_MARKERS = /(^|[^a-z])(security|merge|deploy)([^a-z]|$)|セキュリティ|マージ|デプロイ/i;

interface WorkStateSnapshotData {
  status?: unknown;
  blockers?: unknown;
  remainingDefinitionOfDone?: unknown;
}

interface RemainingDefinitionOfDoneItem {
  id?: unknown;
  description?: unknown;
}

function workStateSnapshot(context: ContextItem[]): WorkStateSnapshotData | null {
  const item = context.find((entry) => entry.source === "gai-work-state");
  if (!item?.data || typeof item.data !== "object" || Array.isArray(item.data)) return null;
  return item.data as WorkStateSnapshotData;
}

function workStateCompleted(context: ContextItem[]): boolean {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || snapshot.status !== "COMPLETED") return false;
  const blockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
  return blockers.length === 0;
}

function promotionDefinitionOfDoneIds(context: ContextItem[]): string[] {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || !Array.isArray(snapshot.remainingDefinitionOfDone)) return [];
  return snapshot.remainingDefinitionOfDone.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as RemainingDefinitionOfDoneItem;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!id || !description) return [];
    if (!PROMOTION_DOD_MARKERS.test(description) || PROMOTION_EXCLUDE_MARKERS.test(description)) return [];
    return [id];
  });
}

function implementationDefinitionOfDoneIds(context: ContextItem[]): string[] {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || !Array.isArray(snapshot.remainingDefinitionOfDone)) return [];
  return snapshot.remainingDefinitionOfDone.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as RemainingDefinitionOfDoneItem;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!id || !description) return [];
    if (!IMPLEMENTATION_DOD_MARKERS.test(description) || VERIFICATION_DOD_MARKERS.test(description)) return [];
    return [id];
  });
}

function nextAction(context: ContextItem[]): string | null {
  const direct = context.find((item) => item.source === "state.next_action")?.summary?.trim();
  if (direct && !["none", "null", "undefined"].includes(direct.toLowerCase())) return direct;
  for (const item of context) {
    if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
    const value = (item.data as { nextAction?: unknown }).nextAction;
    if (typeof value === "string" && value.trim() && !["none", "null", "undefined"].includes(value.trim().toLowerCase())) return value.trim();
  }
  return null;
}

function extractFiles(value: string): string[] {
  const matches = value.match(/(?:src|tests|scripts|docs)\/[A-Za-z0-9_./-]+/g) ?? [];
  return [...new Set(matches.map((item) => item.replace(/[),.;:]+$/, "")))].slice(0, 20);
}

function failureSignature(result?: ActionResult | null): string[] {
  if (!result || result.ok) return [];
  const detail = (result.blocker || result.summary || "unknown-failure")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return [`${result.actionId}:${detail}`];
}

export class RuntimeDevelopmentPlanner implements Planner {
  readonly supersedesPriorExecutionState?: boolean;
  private readonly delegate: Planner;

  constructor(delegate: Planner) {
    this.delegate = delegate;
    this.supersedesPriorExecutionState = delegate.supersedesPriorExecutionState;
  }

  inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent> {
    return this.delegate.inferIntent(input);
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
    previousResult?: ActionResult | null;
  }): Promise<ProposedAction | null> {
    if (input.context.some((item) => item.source === "goal.complete" && item.summary === "true")) return null;
    if (workStateCompleted(input.context)) return null;

    const next = nextAction(input.context);
    const scope = [input.goal.title, input.goal.description ?? "", next ?? "", input.intent.summary].join("\n");
    if (!DEVELOPMENT_MARKERS.test(scope)) {
      return this.delegate.proposeNextAction(input);
    }

    const recovery = input.previousResult && !input.previousResult.ok;
    const now = Date.now();
    const objective = next || input.goal.description?.trim() || input.goal.title;
    const files = extractFiles(scope);
    const satisfiesDefinitionOfDone = implementationDefinitionOfDoneIds(input.context);
    const promotionDoD = promotionDefinitionOfDoneIds(input.context);

    if (satisfiesDefinitionOfDone.length === 0 && promotionDoD.length > 0) {
      return {
        id: `runtime-promote:${now}`,
        description: `Promote verified Builder changes for ${input.goal.title}`,
        capability: "repository.promote_builder_changes",
        risk: "low",
        irreversible: false,
        externalSideEffect: true,
        satisfiesDefinitionOfDone: promotionDoD,
        input: {
          title: `JARVIS: ${input.goal.title}`,
          body: `Autonomous promotion for Goal ${goalWorkStateId(input.goal)} after real Builder execution.`,
        },
      };
    }

    return {
      id: `runtime-builder:${now}`,
      description: objective,
      capability: "code.builder",
      risk: "low",
      irreversible: false,
      externalSideEffect: false,
      ...(satisfiesDefinitionOfDone.length > 0 ? { satisfiesDefinitionOfDone } : {}),
      input: {
        goalId: goalWorkStateId(input.goal),
        attemptId: `attempt-${now}`,
        strategyId: recovery ? `recovery-${now}` : `initial-${now}`,
        objective: recovery
          ? `${objective}. Previous attempt failed: ${input.previousResult?.summary ?? "unknown failure"}. Use a materially different implementation strategy.`
          : objective,
        ...(files.length > 0 ? { files } : {}),
        previousFailureSignatures: failureSignature(input.previousResult),
      },
    };
  }
}
