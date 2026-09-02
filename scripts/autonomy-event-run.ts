import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { RepositoryFileContextSource } from "../src/orchestrator/context-adapters.ts";
import { dispatchAutonomyEvent, EventContextSource, type AutonomyEventType } from "../src/orchestrator/event-runtime.ts";
import { GoalDrivenLoop, type Verifier } from "../src/orchestrator/goal-loop.ts";

const args = process.argv.slice(2);
const typeArg = args.find((value) => value.startsWith("--type="));
const idArg = args.find((value) => value.startsWith("--id="));
const summaryArg = args.find((value) => value.startsWith("--summary="));
const maxCyclesArg = args.find((value) => value.startsWith("--max-cycles="));
const eventType = (typeArg?.split("=")[1] ?? "manual") as AutonomyEventType;
const eventId = idArg?.split("=")[1] ?? `manual-${Date.now()}`;
const eventSummary = summaryArg?.slice("--summary=".length) ?? "manual autonomy event";
const maxCycles = maxCyclesArg ? Number(maxCyclesArg.split("=")[1]) : 3;
const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db");

if (!["repository_state", "schedule", "manual"].includes(eventType)) {
  throw new Error(`unsupported event type: ${eventType}`);
}

const compass = new CompassStore(dbPath);
try {
  const goalRecord = compass.getGoal();
  if (!goalRecord) throw new Error("Compass goal is not set");
  const event = { type: eventType, id: eventId, summary: eventSummary };

  const registry = new CapabilityRegistry().register(createContextInspectCapability());
  const verifier: Verifier = {
    async verify({ result }) {
      return { ok: result.ok, summary: result.ok ? "Capability execution verified" : result.summary, evidence: result.evidence };
    },
  };
  const loop = new GoalDrivenLoop(
    new BaselinePlanner(),
    [new EventContextSource(event), new RepositoryFileContextSource()],
    registry,
    verifier,
    new CompassStateStoreAdapter(compass),
  );

  const report = await dispatchAutonomyEvent({
    event,
    loop,
    goal: compassGoalToLoopGoal(goalRecord),
    compass,
    maxCycles,
  });
  process.stdout.write(`${JSON.stringify({ event, dbPath, report }, null, 2)}\n`);
} finally {
  compass.close();
}
