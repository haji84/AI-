import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { runBoundedGoalLoop } from "../src/orchestrator/bounded-runner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { GoalDrivenLoop, type ContextSource, type Verifier } from "../src/orchestrator/goal-loop.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const maxCyclesArg = process.argv.find((value) => value.startsWith("--max-cycles="));
const maxCycles = maxCyclesArg ? Number(maxCyclesArg.split("=")[1]) : 1;
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db");

const compass = new CompassStore(dbPath);
try {
  const goalRecord = compass.getGoal();
  if (!goalRecord) throw new Error("Compass goal is not set");

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

  const registry = new CapabilityRegistry({ dryRun }).register(createContextInspectCapability());
  const verifier: Verifier = {
    async verify({ result }) {
      return { ok: result.ok, summary: result.ok ? "Capability execution verified" : result.summary, evidence: result.evidence };
    },
  };

  const loop = new GoalDrivenLoop(
    new BaselinePlanner(),
    [contextSource],
    registry,
    verifier,
    new CompassStateStoreAdapter(compass),
  );

  const report = await runBoundedGoalLoop(loop, compassGoalToLoopGoal(goalRecord), { maxCycles });
  process.stdout.write(`${JSON.stringify({ dryRun, dbPath, report }, null, 2)}\n`);
} finally {
  compass.close();
}
