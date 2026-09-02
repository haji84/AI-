import type { CycleReport, Goal, GoalDrivenLoop, StopReason } from "./goal-loop.ts";

const TERMINAL: ReadonlySet<StopReason> = new Set([
  "goal_complete",
  "blocked",
  "approval_required",
  "paused",
  "retry_exhausted",
]);

export interface BoundedRunOptions {
  maxCycles?: number;
  preferences?: string[];
  recentDecisions?: string[];
}

export interface BoundedRunReport {
  cycles: CycleReport[];
  stopReason: StopReason | "cycle_budget_exhausted";
}

export async function runBoundedGoalLoop(
  loop: GoalDrivenLoop,
  goal: Goal,
  options: BoundedRunOptions = {},
): Promise<BoundedRunReport> {
  const maxCycles = options.maxCycles ?? 5;
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) {
    throw new Error("maxCycles must be an integer from 1 to 100");
  }

  const cycles: CycleReport[] = [];
  for (let index = 0; index < maxCycles; index += 1) {
    const report = await loop.runCycle({
      goal,
      preferences: options.preferences,
      recentDecisions: options.recentDecisions,
    });
    cycles.push(report);
    if (TERMINAL.has(report.stopReason)) {
      return { cycles, stopReason: report.stopReason };
    }
  }

  return { cycles, stopReason: "cycle_budget_exhausted" };
}
