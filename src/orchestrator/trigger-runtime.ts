import type { AutonomyEvent } from "./event-runtime.ts";

export interface TriggerInput {
  source: "schedule" | "repository";
  id: string;
  summary: string;
  occurredAt?: string;
  data?: unknown;
}

export function triggerToAutonomyEvent(input: TriggerInput): AutonomyEvent {
  return {
    type: input.source === "schedule" ? "schedule" : "repository_state",
    id: input.id,
    summary: input.summary,
    data: {
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      payload: input.data,
    },
  };
}

export function scheduledTrigger(summary = "scheduled autonomy run"): TriggerInput {
  return {
    source: "schedule",
    id: `schedule-${Date.now()}`,
    summary,
  };
}

export function repositoryTrigger(input: {
  id: string;
  summary: string;
  kind: "pull_request" | "issue" | "check" | "push";
  data?: unknown;
}): TriggerInput {
  return {
    source: "repository",
    id: input.id,
    summary: input.summary,
    data: { kind: input.kind, payload: input.data },
  };
}
