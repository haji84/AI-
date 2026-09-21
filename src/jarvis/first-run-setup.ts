import type {
  JarvisDiagnosticCode,
  JarvisDiagnosticItem,
  JarvisDiagnosticState,
  JarvisSelfDiagnosticReport,
} from "./self-diagnostics.ts";

export type JarvisFirstRunStepId = "host" | "connection" | "permission";

export interface JarvisFirstRunStep {
  id: JarvisFirstRunStepId;
  label: string;
  state: JarvisDiagnosticState;
  detail: string;
  diagnosticCodes: JarvisDiagnosticCode[];
  actionHref: string;
  actionLabel: string;
}

export interface JarvisFirstRunSetup {
  overall: JarvisDiagnosticState;
  steps: JarvisFirstRunStep[];
}

type StepDefinition = Omit<JarvisFirstRunStep, "state" | "detail">;

const definitions: StepDefinition[] = [
  {
    id: "host",
    label: "Host",
    diagnosticCodes: ["AUTH", "BUILD", "HOST"],
    actionHref: "/jarvis/diagnostics",
    actionLabel: "自己診断を確認",
  },
  {
    id: "connection",
    label: "Connection",
    diagnosticCodes: ["TAILSCALE", "BROKER", "GATEWAY", "WORKER"],
    actionHref: "/jarvis/diagnostics",
    actionLabel: "接続状態を確認",
  },
  {
    id: "permission",
    label: "Permission",
    diagnosticCodes: ["DEVICE_PERMISSION"],
    actionHref: "/jarvis/enroll",
    actionLabel: "端末登録・権限案内へ",
  },
];

function aggregate(states: JarvisDiagnosticState[]): JarvisDiagnosticState {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("pending")) return "pending";
  if (states.includes("unknown")) return "unknown";
  return "ready";
}

function buildStep(definition: StepDefinition, byCode: Map<JarvisDiagnosticCode, JarvisDiagnosticItem>): JarvisFirstRunStep {
  const evidence = definition.diagnosticCodes.map((code) => byCode.get(code));
  const state = aggregate(evidence.map((entry) => entry?.state ?? "unknown"));
  const detail = evidence
    .map((entry, index) => entry?.detail ?? `${definition.diagnosticCodes[index]}の状態を確認できません`)
    .join(" / ");

  return { ...definition, state, detail };
}

export function buildJarvisFirstRunSetup(report: JarvisSelfDiagnosticReport): JarvisFirstRunSetup {
  const byCode = new Map<JarvisDiagnosticCode, JarvisDiagnosticItem>(
    report.items.map((entry) => [entry.code, entry] as const),
  );
  const steps = definitions.map((definition) => buildStep(definition, byCode));
  return {
    overall: aggregate(steps.map((step) => step.state)),
    steps,
  };
}
