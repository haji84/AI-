import { createHash } from "node:crypto";

export type GoalBridgeEventType = "GOAL_COMPLETED" | "HUMAN_REQUIRED" | "GOAL_BLOCKED" | "IMPORTANT_UPDATE";

export interface GoalBridgeEvent {
  id: string;
  goalId: string;
  type: GoalBridgeEventType;
  summary: string;
  evidenceRefs: string[];
  createdAt: string;
  deliveredAt?: string;
}

export interface GoalBridgeEventStore {
  append(event: GoalBridgeEvent): Promise<void>;
  pending(goalId?: string): Promise<GoalBridgeEvent[]>;
  markDelivered(eventId: string, deliveredAt?: string): Promise<void>;
}

export function goalBridgeEventId(input: Omit<GoalBridgeEvent, "id" | "deliveredAt">): string {
  return "gbe-" + createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
}

export function createGoalBridgeEvent(input: Omit<GoalBridgeEvent, "id" | "createdAt" | "deliveredAt">, now = new Date().toISOString()): GoalBridgeEvent {
  const base = { ...input, createdAt: now };
  return { id: goalBridgeEventId(base), ...base };
}
