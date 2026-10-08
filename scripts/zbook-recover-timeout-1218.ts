import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalRegistryAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { recoverTimedOutGoal } from "../src/orchestrator/zbook-timeout-recovery.ts";
import { goalFailureCode } from "./zbook-goal-failure-code.ts";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA) throw new Error("ZBook owner-local recovery only");
const compass = new CompassStore(join(process.env.LOCALAPPDATA, "GAIWorker", "goal-1218-bridge-state", "compass.sqlite"));
try {
  const active = await new CompassGoalRegistryAdapter(compass).listActive();
  const goalId = "goal-2945730779960412";
  if (active.length !== 1 || active[0]?.goalId !== goalId) throw new Error("Expected #1218 Goal is not the sole active Goal");
  // Bounded Goal retries can append more than 20 history entries before a workflow cutoff; Compass caps reads at 100.
  const history = compass.getHistory(100);
  const timeoutConfirmed = history.some(entry => goalFailureCode(entry.summary) === "CODING_ENGINE_TIMEOUT");
  const result = await recoverTimedOutGoal(compass, goalId, { timeoutConfirmed });
  process.stdout.write(JSON.stringify({ goalId, result, timeoutConfirmed }) + "\n");
} finally { compass.close(); }
