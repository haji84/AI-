import type { JarvisNode, JarvisTask } from "./types.ts";

export interface JarvisPolicyInput {
  task: JarvisTask;
  node: JarvisNode;
  incrementalCostYen: number;
  destructive?: boolean;
  externalPublication?: boolean;
  requiresSecret?: boolean;
  requiresPermissionChange?: boolean;
}

export interface JarvisPolicyDecision {
  allowed: boolean;
  requiresHumanGate: boolean;
  reasons: string[];
}

export function evaluateJarvisPolicy(input: JarvisPolicyInput): JarvisPolicyDecision {
  const reasons: string[] = [];

  if (input.incrementalCostYen > 0 || input.node.policy.allowPaidServices !== false) {
    reasons.push("additional paid service is not allowed by default");
    return { allowed: false, requiresHumanGate: true, reasons };
  }

  if (input.destructive && !input.node.policy.allowDestructiveActions) {
    reasons.push("destructive action requires Human Gate");
  }
  if (input.externalPublication && !input.node.policy.allowExternalPublication) {
    reasons.push("external publication requires Human Gate");
  }
  if (input.requiresSecret) reasons.push("secret access requires Human Gate");
  if (input.requiresPermissionChange) reasons.push("permission change requires Human Gate");
  if (input.node.status === "locked" && input.node.policy.requireHumanForLockedDevice) {
    reasons.push("locked personal device requires Human Takeover");
  }
  if (input.task.type === "remote-control" && !input.node.policy.allowRemoteControl) {
    reasons.push("remote control is disabled for this node");
  }

  if (reasons.length > 0) return { allowed: false, requiresHumanGate: true, reasons };
  return { allowed: true, requiresHumanGate: false, reasons: ["zero-cost route and node policy satisfied"] };
}
