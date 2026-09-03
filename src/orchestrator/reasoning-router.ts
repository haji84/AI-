export type ReasoningSurface = "chat" | "work" | "codex";
export type ReasoningRouteStatus = "ready" | "defer_heavy_reasoning";

export interface ReasoningUsage {
  work: number;
  codex: number;
}

export interface ReasoningSoftBudgets {
  work: number;
  codex: number;
}

export interface ReasoningTaskSignals {
  text: string;
  sourceCount?: number;
  crossApp?: boolean;
  recurring?: boolean;
  longRunning?: boolean;
  changesCode?: boolean;
  debugging?: boolean;
  testing?: boolean;
  refactoring?: boolean;
  fallbackToChatSafe?: boolean;
}

export interface ReasoningRoutingDecision {
  surface: ReasoningSurface;
  status: ReasoningRouteStatus;
  reason: string;
  usage: ReasoningUsage;
  softBudgets: ReasoningSoftBudgets;
  budgetRemaining: number | null;
}

export const DEFAULT_REASONING_SOFT_BUDGETS: ReasoningSoftBudgets = {
  work: 2,
  codex: 3,
};

function validBudget(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function codeSignals(text: string): boolean {
  return /(?:implement|debug|refactor|write|change|modify|fix|test|patch|commit).{0,24}(?:code|repo|repository|typescript|javascript|python|test|pr|branch)|(?:コード|実装|デバッグ|リファクタ|修正|テスト|変更).{0,20}(?:コード|リポジトリ|GitHub|PR|ブランチ)/i.test(text);
}

function workSignals(text: string): boolean {
  return /(?:cross[- ]app|multiple sources|multi[- ]source|recurring workflow|long[- ]running|gmail.{0,20}calendar|calendar.{0,20}gmail|複数(?:サービス|アプリ|資料)|定期(?:処理|作業)|長時間(?:処理|作業)|Gmail.{0,20}カレンダー)/i.test(text);
}

export function inferReasoningTaskSignals(text: string): ReasoningTaskSignals {
  const trimmed = text.trim();
  return {
    text: trimmed,
    changesCode: codeSignals(trimmed),
    crossApp: workSignals(trimmed),
  };
}

export function routeReasoningTask(
  signals: ReasoningTaskSignals,
  usage: ReasoningUsage = { work: 0, codex: 0 },
  softBudgets: ReasoningSoftBudgets = DEFAULT_REASONING_SOFT_BUDGETS,
): ReasoningRoutingDecision {
  const budgets = {
    work: validBudget(softBudgets.work, "work soft budget"),
    codex: validBudget(softBudgets.codex, "codex soft budget"),
  };
  const normalizedUsage = {
    work: validBudget(usage.work, "work usage"),
    codex: validBudget(usage.codex, "codex usage"),
  };

  const needsCodex = Boolean(signals.changesCode || signals.debugging || signals.testing || signals.refactoring || codeSignals(signals.text));
  const needsWork = !needsCodex && Boolean(
    signals.crossApp
    || signals.recurring
    || signals.longRunning
    || (signals.sourceCount ?? 0) >= 3
    || workSignals(signals.text)
  );

  const requested: ReasoningSurface = needsCodex ? "codex" : needsWork ? "work" : "chat";
  if (requested === "chat") {
    return {
      surface: "chat",
      status: "ready",
      reason: "Routine reasoning stays in Chat to preserve heavier Plus capacity",
      usage: normalizedUsage,
      softBudgets: budgets,
      budgetRemaining: null,
    };
  }

  const remaining = Math.max(0, budgets[requested] - normalizedUsage[requested]);
  if (remaining > 0) {
    return {
      surface: requested,
      status: "ready",
      reason: requested === "codex"
        ? "Code-changing or code-verification work is reserved for Codex"
        : "Material multi-source, cross-app, recurring, or long-running coordination is reserved for Work",
      usage: normalizedUsage,
      softBudgets: budgets,
      budgetRemaining: remaining,
    };
  }

  if (signals.fallbackToChatSafe) {
    return {
      surface: "chat",
      status: "ready",
      reason: `${requested} soft budget is exhausted; this step is safe to keep in Chat`,
      usage: normalizedUsage,
      softBudgets: budgets,
      budgetRemaining: 0,
    };
  }

  return {
    surface: requested,
    status: "defer_heavy_reasoning",
    reason: `${requested} soft budget is exhausted; defer this heavy step instead of consuming additional capacity`,
    usage: normalizedUsage,
    softBudgets: budgets,
    budgetRemaining: 0,
  };
}
