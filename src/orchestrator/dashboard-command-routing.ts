import type { ModelPlan } from "./model-planner.ts";

const EXECUTION_PATTERNS = [
  /最後まで/u,
  /完了まで/u,
  /完成させ/u,
  /進めて/u,
  /任せる/u,
  /作って/u,
  /作成して/u,
  /実装して/u,
  /修正して/u,
  /直して/u,
  /改善して/u,
  /追加して/u,
  /削除して/u,
  /変更して/u,
  /マージして/u,
  /ビルドして/u,
  /exe(?:化)?/iu,
  /package|packaging/i,
  /implement|build|fix|create|change|update|delete|merge|finish|complete/i,
];

const INSPECT_PATTERNS = [
  /確認して/u,
  /確認$/u,
  /調べて/u,
  /状態/u,
  /現在地/u,
  /状況/u,
  /どうなって/u,
  /見て$/u,
  /教えて/u,
  /inspect|check|status|review|investigate/i,
];

const ISSUE_REFERENCE_PATTERN = /(?:Issue\s*)?#\d+/i;

const CONTINUATION_ONLY_PATTERNS = [
  /^(?:安全に)?進めて[。！!]?$/u,
  /^次(?:へ|に)?進んで[。！!]?$/u,
  /^続けて[。！!]?$/u,
  /^そのまま進めて[。！!]?$/u,
  /^任せる[。！!]?$/u,
  /^完成させて[。！!]?$/u,
  /^最後まで進めて[。！!]?$/u,
  /^finish(?: it| this)?[.!]?$/i,
  /^continue[.!]?$/i,
];

export function dashboardCommandNeedsReasoning(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) return false;
  if (EXECUTION_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return !INSPECT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function dashboardCommandStartsFreshTask(command: string): boolean {
  const normalized = command.trim();
  if (!normalized || !dashboardCommandNeedsReasoning(normalized)) return false;
  if (ISSUE_REFERENCE_PATTERN.test(normalized)) return false;
  if (CONTINUATION_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return true;
}

export function createDashboardBoundedPlan(command: string): ModelPlan | undefined {
  const normalized = command.trim();
  if (!normalized || dashboardCommandNeedsReasoning(normalized)) return undefined;
  return {
    kind: "inspect",
    description: normalized,
  };
}
