import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

const workspace = process.env.RUNTIME_BUILDER_SMOKE_WORKSPACE?.trim();
const stateDir = process.env.RUNTIME_BUILDER_SMOKE_STATE_DIR?.trim();
if (!workspace || !stateDir) throw new Error("RUNTIME_BUILDER_SMOKE_WORKSPACE and RUNTIME_BUILDER_SMOKE_STATE_DIR are required");

const dbPath = resolve(stateDir, "compass.db");
const evidencePath = resolve(stateDir, "runtime-builder-daily-smoke.json");
const fixture = "tests/fixtures/runtime-builder-daily-smoke.txt";

await mkdir(stateDir, { recursive: true });

const compass = new CompassStore(dbPath);
let goalId = "";
try {
  const record = compass.setGoal({
    title: "Implement normal JARVIS runtime Builder smoke",
    description: `Edit only ${fixture}. Make its complete content exactly runtime-daily. Do not modify any other file.`,
    successCriteria: ["Normal JARVIS runtime routes a development action to the real Builder"],
    constraints: ["Only the controlled smoke fixture may change"],
  });
  compass.updateState({
    status: "READY",
    nextAction: `Implement tests/fixtures/runtime-builder-daily-smoke.txt so its complete content is runtime-daily`,
    blockers: [],
  });
  goalId = goalWorkStateId(compassGoalToLoopGoal(record));
} finally {
  compass.close();
}

const adapter = new CompassGoalExecutionAdapter(dbPath);
const report = await adapter.run(goalId, { maxCycles: 2 });
const cycle = report.cycles[0];
const actual = (await readFile(resolve(workspace, fixture), "utf8")).trim();

const evidence = {
  goalId,
  report,
  actionCapability: cycle?.action?.capability ?? null,
  resultOk: cycle?.result?.ok ?? false,
  actual,
  expected: "runtime-daily",
  goalEvaluation: report.goalEvaluation ?? null,
  passed: cycle?.action?.capability === "code.builder"
    && cycle?.result?.ok === true
    && actual === "runtime-daily"
    && report.stopReason === "goal_complete"
    && report.goalEvaluation?.achieved === true,
  checkedAt: new Date().toISOString(),
};

await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
if (!evidence.passed) process.exitCode = 1;
