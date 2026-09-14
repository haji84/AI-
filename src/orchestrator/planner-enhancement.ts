import type {
  ActionResult,
  ContextItem,
  Goal,
  InferredIntent,
  Planner,
  ProposedAction,
  RiskLevel,
} from "./goal-loop.ts";

export type PlannerConnectivity = "online" | "degraded" | "offline" | "recovering" | "unknown";
export type PlannerNetworkRequirement = "offline-capable" | "offline-preferred" | "online-required" | "unknown";

export interface PlannerCapabilityState {
  capability: string;
  available: boolean;
  networkRequirement: PlannerNetworkRequirement;
  resources: string[];
  reason?: string;
}

export interface PlannerResourceState {
  resource: string;
  available: boolean;
  reason?: string;
}

export interface PlannerEnhancementEvidence {
  connectivity: PlannerConnectivity;
  satisfiedCriteria: string[];
  unsatisfiedCriteria: string[];
  capabilities: PlannerCapabilityState[];
  resources: PlannerResourceState[];
  verifierFailures: string[];
  recoveryAvoidActionIds: string[];
  recoveryAvoidCapabilities: string[];
  previousFailure?: { actionId: string; summary: string; blocker?: string };
  riskCeiling?: RiskLevel;
  replanReasons: string[];
}

export interface PlannerEnhancementDecision {
  evidence: PlannerEnhancementEvidence;
  contextItem: ContextItem;
}

interface PlannerContextData {
  connectivity?: unknown;
  status?: unknown;
  satisfiedCriteria?: unknown;
  unsatisfiedCriteria?: unknown;
  capabilities?: unknown;
  resources?: unknown;
  verifierFailures?: unknown;
  avoidActionIds?: unknown;
  avoidCapabilities?: unknown;
  riskCeiling?: unknown;
}

interface CapabilityData {
  id?: unknown;
  capability?: unknown;
  name?: unknown;
  available?: unknown;
  status?: unknown;
  networkRequirement?: unknown;
  connectivity?: unknown;
  resources?: unknown;
  reason?: unknown;
}

interface ResourceData {
  id?: unknown;
  resource?: unknown;
  name?: unknown;
  available?: unknown;
  status?: unknown;
  reason?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function normalizeConnectivity(value: unknown): PlannerConnectivity {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "online" || normalized === "degraded" || normalized === "offline" || normalized === "recovering") {
    return normalized;
  }
  return "unknown";
}

function normalizeNetworkRequirement(value: unknown): PlannerNetworkRequirement {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "offline-capable" || normalized === "offline-preferred" || normalized === "online-required") {
    return normalized;
  }
  return "unknown";
}

function normalizeRisk(value: unknown): RiskLevel | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return undefined;
}

function availableFrom(value: CapabilityData | ResourceData): boolean {
  if (typeof value.available === "boolean") return value.available;
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
  if (["offline", "unavailable", "missing", "blocked", "failed"].includes(status)) return false;
  if (["online", "available", "ready", "healthy", "idle", "busy"].includes(status)) return true;
  return true;
}

function parseCapability(value: unknown): PlannerCapabilityState | null {
  const record = asRecord(value) as CapabilityData | null;
  if (!record) return null;
  const capability = firstString(record.capability, record.id, record.name);
  if (!capability) return null;
  return {
    capability,
    available: availableFrom(record),
    networkRequirement: normalizeNetworkRequirement(record.networkRequirement ?? record.connectivity),
    resources: stringList(record.resources),
    reason: firstString(record.reason),
  };
}

function parseResource(value: unknown): PlannerResourceState | null {
  const record = asRecord(value) as ResourceData | null;
  if (!record) return null;
  const resource = firstString(record.resource, record.id, record.name);
  if (!resource) return null;
  return {
    resource,
    available: availableFrom(record),
    reason: firstString(record.reason),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function rankRisk(level: RiskLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  return 3;
}

function collectEvidence(input: {
  goal: Goal;
  context: ContextItem[];
  previousResult?: ActionResult | null;
}): PlannerEnhancementEvidence {
  let connectivity: PlannerConnectivity = "unknown";
  let riskCeiling: RiskLevel | undefined;
  const satisfiedCriteria: string[] = [];
  const explicitUnsatisfied: string[] = [];
  const capabilities: PlannerCapabilityState[] = [];
  const resources: PlannerResourceState[] = [];
  const verifierFailures: string[] = [];
  const recoveryAvoidActionIds: string[] = [];
  const recoveryAvoidCapabilities: string[] = [];

  for (const item of input.context) {
    const data = asRecord(item.data) as PlannerContextData | null;
    if (!data) continue;

    const candidateConnectivity = normalizeConnectivity(data.connectivity ?? (item.source.includes("connectivity") ? data.status : undefined));
    if (candidateConnectivity !== "unknown") connectivity = candidateConnectivity;

    satisfiedCriteria.push(...stringList(data.satisfiedCriteria));
    explicitUnsatisfied.push(...stringList(data.unsatisfiedCriteria));
    verifierFailures.push(...stringList(data.verifierFailures));
    recoveryAvoidActionIds.push(...stringList(data.avoidActionIds));
    recoveryAvoidCapabilities.push(...stringList(data.avoidCapabilities));

    if (Array.isArray(data.capabilities)) {
      for (const raw of data.capabilities) {
        const parsed = parseCapability(raw);
        if (parsed) capabilities.push(parsed);
      }
    }
    if (Array.isArray(data.resources)) {
      for (const raw of data.resources) {
        const parsed = parseResource(raw);
        if (parsed) resources.push(parsed);
      }
    }

    riskCeiling = normalizeRisk(data.riskCeiling) ?? riskCeiling;
  }

  const satisfiedSet = new Set(unique(satisfiedCriteria).map((item) => item.toLowerCase()));
  const unsatisfiedCriteria = unique([
    ...explicitUnsatisfied,
    ...input.goal.successCriteria.filter((criterion) => !satisfiedSet.has(criterion.toLowerCase())),
  ]);

  const previousFailure = input.previousResult && !input.previousResult.ok
    ? {
        actionId: input.previousResult.actionId,
        summary: input.previousResult.summary,
        ...(input.previousResult.blocker ? { blocker: input.previousResult.blocker } : {}),
      }
    : undefined;

  return {
    connectivity,
    satisfiedCriteria: unique(satisfiedCriteria),
    unsatisfiedCriteria,
    capabilities,
    resources,
    verifierFailures: unique(verifierFailures),
    recoveryAvoidActionIds: unique(recoveryAvoidActionIds),
    recoveryAvoidCapabilities: unique(recoveryAvoidCapabilities),
    previousFailure,
    riskCeiling,
    replanReasons: [],
  };
}

function capabilityFor(action: ProposedAction, evidence: PlannerEnhancementEvidence): PlannerCapabilityState | undefined {
  return evidence.capabilities.find((item) => item.capability === action.capability);
}

function actionFeasibility(action: ProposedAction, evidence: PlannerEnhancementEvidence): string[] {
  const reasons: string[] = [];
  const capability = capabilityFor(action, evidence);

  if (capability && !capability.available) {
    reasons.push(`capability ${action.capability} is unavailable${capability.reason ? `: ${capability.reason}` : ""}`);
  }

  if (capability?.networkRequirement === "online-required" && (evidence.connectivity === "offline" || evidence.connectivity === "degraded")) {
    reasons.push(`capability ${action.capability} requires online connectivity while runtime is ${evidence.connectivity}`);
  }

  if (capability) {
    const unavailableResources = capability.resources.filter((required) => {
      const state = evidence.resources.find((item) => item.resource === required);
      return state?.available === false;
    });
    for (const resource of unavailableResources) reasons.push(`required resource ${resource} is unavailable`);
  }

  if (evidence.recoveryAvoidCapabilities.includes(action.capability)) {
    reasons.push(`recovery evidence says to avoid capability ${action.capability}`);
  }
  if (evidence.recoveryAvoidActionIds.includes(action.id)) {
    reasons.push(`recovery evidence says to avoid action ${action.id}`);
  }
  if (evidence.previousFailure?.actionId === action.id) {
    reasons.push(`previous attempt of action ${action.id} failed`);
  }
  if (evidence.riskCeiling && rankRisk(action.risk) > rankRisk(evidence.riskCeiling)) {
    reasons.push(`action risk ${action.risk} exceeds current planner risk ceiling ${evidence.riskCeiling}`);
  }

  return unique(reasons);
}

function planningSummary(evidence: PlannerEnhancementEvidence): string {
  const availableCapabilities = evidence.capabilities.filter((item) => item.available).map((item) => item.capability);
  const unavailableCapabilities = evidence.capabilities.filter((item) => !item.available).map((item) => item.capability);
  return [
    `connectivity=${evidence.connectivity}`,
    `unsatisfiedDoD=${evidence.unsatisfiedCriteria.length}`,
    `availableCapabilities=${availableCapabilities.join(",") || "unknown"}`,
    `unavailableCapabilities=${unavailableCapabilities.join(",") || "none-known"}`,
    `verifierFailures=${evidence.verifierFailures.length}`,
    `previousFailure=${evidence.previousFailure?.actionId ?? "none"}`,
  ].join("; ");
}

export function buildPlannerEnhancementContext(input: {
  goal: Goal;
  context: ContextItem[];
  previousResult?: ActionResult | null;
}): PlannerEnhancementDecision {
  const evidence = collectEvidence(input);
  return {
    evidence,
    contextItem: {
      source: "planner.phase9.runtime",
      summary: planningSummary(evidence),
      data: evidence,
    },
  };
}

type ActionWithMetadata = ProposedAction & { metadata?: Record<string, unknown> };

function attachEvidence(
  action: ProposedAction,
  evidence: PlannerEnhancementEvidence,
  reasons: string[],
  replanned: boolean,
): ProposedAction {
  const current = action as ActionWithMetadata;
  return {
    ...action,
    metadata: {
      ...(current.metadata ?? {}),
      plannerEnhancement: {
        ...evidence,
        replanReasons: reasons,
        replanned,
      },
    },
  } as ActionWithMetadata;
}

export class PlannerEnhancementPlanner implements Planner {
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
    const decision = buildPlannerEnhancementContext(input);
    const firstContext = [...input.context, decision.contextItem];
    const first = await this.delegate.proposeNextAction({ ...input, context: firstContext });
    if (!first) return null;

    const reasons = actionFeasibility(first, decision.evidence);
    if (reasons.length === 0) return attachEvidence(first, decision.evidence, [], false);

    const replanContext: ContextItem = {
      source: "planner.phase9.replan",
      summary: `First proposal is runtime-infeasible. Choose a different strategy if one exists: ${reasons.join("; ")}`,
      data: {
        rejectedActionId: first.id,
        rejectedCapability: first.capability,
        reasons,
        boundedAttemptsRemaining: 1,
      },
    };

    const second = await this.delegate.proposeNextAction({
      ...input,
      context: [...firstContext, replanContext],
    });
    if (!second) return attachEvidence(first, decision.evidence, reasons, true);

    const secondReasons = actionFeasibility(second, decision.evidence);
    return attachEvidence(second, decision.evidence, unique([...reasons, ...secondReasons]), true);
  }
}
