import type { CompassStore } from "../compass/store.ts";
import { runBoundedGoalLoop, type BoundedRunReport } from "./bounded-runner.ts";
import type { Goal, GoalDrivenLoop, ContextItem, ContextSource } from "./goal-loop.ts";

export type AutonomyEventType = "repository_state" | "schedule" | "manual";

export interface AutonomyEvent {
  type: AutonomyEventType;
  id: string;
  summary: string;
  data?: unknown;
}

export class EventContextSource implements ContextSource {
  readonly name = "autonomy-event";
  private readonly event: AutonomyEvent;

  constructor(event: AutonomyEvent) {
    this.event = event;
  }

  async collect(): Promise<ContextItem[]> {
    return [{
      source: `event:${this.event.type}`,
      summary: this.event.summary,
      data: { id: this.event.id, payload: this.event.data },
    }];
  }
}

export async function dispatchAutonomyEvent(input: {
  event: AutonomyEvent;
  loop: GoalDrivenLoop;
  goal: Goal;
  compass: CompassStore;
  maxCycles?: number;
}): Promise<BoundedRunReport> {
  input.compass.writeBack({
    status: "EVENT_RECEIVED",
    summary: `Autonomy event received: ${input.event.type} ${input.event.id}`,
    nextAction: input.compass.getNextAction(),
  });

  const report = await runBoundedGoalLoop(input.loop, input.goal, { maxCycles: input.maxCycles ?? 3 });

  input.compass.writeBack({
    status: report.stopReason,
    summary: `Autonomy event ${input.event.id} completed with ${report.stopReason} after ${report.cycles.length} cycle(s)`,
    nextAction: input.compass.getNextAction(),
  });

  return report;
}
