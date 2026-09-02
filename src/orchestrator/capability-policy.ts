import type { ActionResult, ContextItem, ProposedAction, RiskLevel } from "./goal-loop.ts";

export type CapabilityAccess = "read" | "write";

export interface CapabilityMetadata {
  access: CapabilityAccess;
  externalSideEffect: boolean;
  risk: RiskLevel;
  requiresHumanApproval: boolean;
}

export interface ManagedCapabilityHandler {
  name: string;
  metadata: CapabilityMetadata;
  execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult>;
}

export interface CapabilityPolicyDecision {
  allowed: boolean;
  reason: string;
}

export function evaluateCapabilityPolicy(
  action: ProposedAction,
  capability: ManagedCapabilityHandler,
): CapabilityPolicyDecision {
  if (capability.metadata.requiresHumanApproval) {
    return { allowed: false, reason: "capability_requires_human_approval" };
  }
  if (capability.metadata.access === "write" && capability.metadata.externalSideEffect) {
    return { allowed: false, reason: "external_write_requires_human_approval" };
  }
  if (capability.metadata.risk === "high") {
    return { allowed: false, reason: "high_risk_capability_requires_human_approval" };
  }
  if (action.irreversible || action.requiresHumanApproval || action.risk === "high") {
    return { allowed: false, reason: "action_requires_human_approval" };
  }
  return { allowed: true, reason: "approved_bounded_capability" };
}
