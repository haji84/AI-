import { resolve } from "node:path";
import { CompassStore } from "../compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "./baseline-planner.ts";
import { runBoundedGoalLoop, type BoundedRunReport } from "./bounded-runner.ts";
import { CapabilityRegistry } from "./capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "./compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "./compass-work-state-store.ts";
import type { ContextItem, ContextSource, Verifier } from "./goal-loop.ts";
import type { GoalExecutionAdapter } from "./goal-controller-execution-bridge.ts";
import { createWorkStateIntegratedGoalLoop, goalWorkStateId } from "./work-state-integration.ts";

class EntryContextSource implements ContextSource {
  readonly name = "unified-entry-context";
  private readonly items: ContextItem[];
  constructor(values: unknown[]) {
    this.items = values.map((value, index) => ({
      source: `unified-entry:${index + 1}`,
      summary: typeof value === "object" && value && "summary" in value ? String((value as { summary: unknown }).summary) : String(value),
      data: value,
    }));
  }
  async collect(): Promise<ContextItem[]> { return this.items; }
}

export class CompassGoalExecutionAdapter implements GoalExecutionAdapter {
  private readonly dbPath: string;
  constructor(dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db")) {
    this.dbPath = dbPath;
  }

  async run(goalId: string, input: { maxCycles?: number; context?: unknown[] } = {}): Promise<BoundedRunReport> {
    const compass = new CompassStore(this.dbPath);
    try {
      const record = compass.getGoal();
      if (!record) throw new Error("Compass goal is not set");
      const goal = compassGoalToLoopGoal(record);
      const authoritativeGoalId = goalWorkStateId(goal);
      if (goalId !== authoritativeGoalId) {
        throw new Error(`Goal Controller goal mismatch: requested=${goalId} authoritative=${authoritativeGoalId}`);
      }

      const contextSource: ContextSource = {
        name: "compass-state",
        async collect() {
          const state = compass.getState();
          return [
            { source: "state.status", summary: state.status ?? "unknown" },
            { source: "state.next_action", summary: state.nextAction ?? "none" },
            { source: "state.blockers", summary: JSON.stringify(state.blockers) },
          ];
        },
      };
      const registry = new CapabilityRegistry().register(createContextInspectCapability());
      const verifier: Verifier = {
        async verify({ result }) {
          return { ok: result.ok, summary: result.ok ? "Capability execution verified" : result.summary, evidence: result.evidence };
        },
      };
      const loop = createWorkStateIntegratedGoalLoop({
        goal,
        planner: new BaselinePlanner(),
        contextSources: [contextSource, new EntryContextSource(input.context ?? [])],
        executor: registry,
        verifier,
        stateStore: new CompassStateStoreAdapter(compass),
        workStateStore: new CompassWorkStateStoreAdapter(compass),
      });
      return runBoundedGoalLoop(loop, goal, { maxCycles: input.maxCycles ?? 3 });
    } finally {
      compass.close();
    }
  }
}
