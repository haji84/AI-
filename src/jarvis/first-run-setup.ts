import type {
  JarvisDiagnosticCode,
  JarvisDiagnosticItem,
  JarvisDiagnosticState,
} from "./self-diagnostics.ts";

export type JarvisSetupStepId = "host" | "connection" | "permissions";

export interface JarvisSetupStep {
  id: JarvisSetupStepId;
  title: string;
  state: JarvisDiagnosticState;
  detail: string;
  actions: string[];
  diagnostics: JarvisDiagnosticItem[];
}

export interface JarvisFirstRunSetup {
  overall: JarvisDiagnosticState;
  steps: JarvisSetupStep[];
}

const stateRank: Record<JarvisDiagnosticState, number> = {
  ready: 0,
  unknown: 1,
  pending: 2,
  blocked: 3,
};

const stepDefinitions: Array<{
  id: JarvisSetupStepId;
  title: string;
  codes: JarvisDiagnosticCode[];
}> = [
  {
    id: "host",
    title: "1. ホスト",
    codes: ["BUILD", "HOST", "FIRMWARE_GATE"],
  },
  {
    id: "connection",
    title: "2. 接続",
    codes: ["TAILSCALE", "BROKER", "GATEWAY", "WORKER"],
  },
  {
    id: "permissions",
    title: "3. 権限",
    codes: ["AUTH", "DEVICE_PERMISSION"],
  },
];

function worstState(states: JarvisDiagnosticState[]): JarvisDiagnosticState {
  if (states.length === 0) return "unknown";
  return states.reduce<JarvisDiagnosticState>((worst, state) => (
    stateRank[state] > stateRank[worst] ? state : worst
  ), "ready");
}

function stepDetail(state: JarvisDiagnosticState, items: JarvisDiagnosticItem[], complete: boolean): string {
  if (items.length === 0) return "必要な診断結果を確認できません。詳細診断を実行してください。";
  if (!complete && state === "unknown") return "一部の診断結果が不足しています。詳細診断を実行してください。";
  if (state === "ready") return "このステップで確認できるソフトウェア条件は整っています。";

  const relevant = items.filter((entry) => entry.state === state);
  return relevant.map((entry) => `${entry.label}: ${entry.detail}`).join(" / ");
}

export function buildJarvisFirstRunSetup(items: JarvisDiagnosticItem[]): JarvisFirstRunSetup {
  const byCode = new Map(items.map((entry) => [entry.code, entry]));

  const steps = stepDefinitions.map<JarvisSetupStep>((definition) => {
    const diagnostics = definition.codes
      .map((code) => byCode.get(code))
      .filter((entry): entry is JarvisDiagnosticItem => Boolean(entry));
    const complete = diagnostics.length === definition.codes.length;
    const states = diagnostics.map((entry) => entry.state);
    if (!complete) states.push("unknown");
    const state = worstState(states);
    const actions = [...new Set(
      diagnostics
        .filter((entry) => entry.state !== "ready" && entry.action)
        .map((entry) => entry.action as string),
    )];

    return {
      id: definition.id,
      title: definition.title,
      state,
      detail: stepDetail(state, diagnostics, complete),
      actions,
      diagnostics,
    };
  });

  return {
    overall: worstState(steps.map((step) => step.state)),
    steps,
  };
}
