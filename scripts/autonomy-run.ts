import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { RuntimeDevelopmentPlanner } from "../src/orchestrator/runtime-development-planner.ts";
import { createCodeBuilderCapability, createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { type ContextSource, type Verifier } from "../src/orchestrator/goal-loop.ts";
import { createWorkStateIntegratedGoalLoop } from "../src/orchestrator/work-state-integration.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const maxCyclesArg = process.argv.find((value) => value.startsWith("--max-cycles="));
const maxCycles = maxCyclesArg ? Number(maxCyclesArg.split("=")[1]) : 1;
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db");

const compass = new CompassStore(dbPath);
try {
  const goalRecord = compass.getGoal();
  if (!goalRecord) throw new Error("Compass goal is not set");
  const goal = compassGoalToLoopGoal(goalRecord);

  const contextSource: ContextSource = {
    name: "compass-state",
    async collect() {
      const state = compass.getState();
      const items = [];
      if (state.nextAction) items.push({ source: "state.next_action", summary: state.nextAction });
      items.push({ source: "state.status", summary: state.status ?? "unknown" });
      items.push({ source: "state.blockers", summary: JSON.stringify(state.blockers) });
      return items;
    },
  };

  const registry = new CapabilityRegistry({ dryRun })
    .register(createContextInspectCapability())
    .register(createCodeBuilderCapability(createRuntimeBuilderRouter()));
  const verifier: Verifier = createRuntimeDevelopmentVerifier();

  const loop = createWorkStateIntegratedGoalLoop({
    goal,
    planner: new RuntimeDevelopmentPlanner(new BaselinePlanner()),
    contextSources: [contextSource],
    executor: registry,
    verifier,
    stateStore: new CompassStateStoreAdapter(compass),
    workStateStore: new CompassWorkStateStoreAdapter(compass),
  });

  const report = await runBoundedGoalLoop(loop, goal, { maxCycles });
  process.stdout.write(`${JSON.stringify({ dryRun, dbPath, report }, null, 2)}\n`);
} finally {
  compass.close();
}
