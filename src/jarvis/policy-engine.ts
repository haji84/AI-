import type { JarvisNode, JarvisTask } from "./types.ts";

export type JarvisInteractionOrigin = "planner" | "owner-manual" | "pointer" | "gesture" | "voice" | "text";

export interface JarvisPolicyInput {
  task: JarvisTask;
  node: JarvisNode;
  incrementalCostYen: number;
  destructive?: boolean;
  externalPublication?: boolean;
  requiresSecret?: boolean;
  requiresPermissionChange?: boolean;
  interactionOrigin?: JarvisInteractionOrigin;
}

export interface JarvisPolicyDecision {
  allowed: boolean;
  requiresHumanGate: boolean;
  reasons: string[];
}

function isImplicitPointingSignal(origin?: JarvisInteractionOrigin): boolean {
  return origin === "pointer" || origin === "gesture";
}

export function evaluateJarvisPolicy(input: JarvisPolicyInput): JarvisPolicyDecision {
  const reasons: string[] = [];
  const implicitPointingSignal = isImplicitPointingSignal(input.interactionOrigin);
  const protectedIntent = input.incrementalCostYen > 0
    || Boolean(input.destructive)
    || Boolean(input.externalPublication)
    || Boolean(input.requiresSecret)
    || Boolean(input.requiresPermissionChange);

  if (input.incrementalCostYen > 0 || input.node.policy.allowPaidServices !== false) {
    reasons.push("additional paid service is not allowed by default");
  }

  if (input.destructive && (!input.node.policy.allowDestructiveActions || implicitPointingSignal)) {
    reasons.push("destructive action requires Human Gate");
  }
  if (input.externalPublication && (!input.node.policy.allowExternalPublication || implicitPointingSignal)) {
    reasons.push("external publication requires Human Gate");
  }
  if (input.requiresSecret) reasons.push("secret access requires Human Gate");
  if (input.requiresPermissionChange) reasons.push("permission change requires Human Gate");
  if (implicitPointingSignal && protectedIntent) {
    reasons.push(`${input.interactionOrigin} input cannot authorize a Human-Gated action`);
  }
  if (input.node.status === "locked" && input.node.policy.requireHumanForLockedDevice) {
    reasons.push("locked personal device requires Human Takeover");
  }
  if (input.task.type === "remote-control" && !input.node.policy.allowRemoteControl) {
    reasons.push("remote control is disabled for this node");
  }

  if (reasons.length > 0) return { allowed: false, requiresHumanGate: true, reasons };
  return { allowed: true, requiresHumanGate: false, reasons: ["zero-cost route and node policy satisfied"] };
}
