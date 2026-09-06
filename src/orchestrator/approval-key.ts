import { createHash } from "node:crypto";
import type { Goal, ProposedAction } from "./goal-loop.ts";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

export function createApprovalKey(goal: Goal, action: ProposedAction): string {
  const payload = stable({
    goal: {
      title: goal.title,
      description: goal.description ?? null,
      successCriteria: goal.successCriteria,
      constraints: goal.constraints,
    },
    action: {
      description: action.description,
      capability: action.capability,
      risk: action.risk,
      irreversible: action.irreversible ?? false,
      externalSideEffect: action.externalSideEffect ?? false,
      requiresHumanApproval: action.requiresHumanApproval ?? false,
      riskSignals: action.riskSignals ?? null,
      input: action.input ?? null,
    },
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
