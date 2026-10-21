import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

test("CompassGoalExecutionAdapter keeps Compass DB alive until Goal Loop resolves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compass-adapter-"));
  const dbPath = join(dir, "compass.db");
  const compass = new CompassStore(dbPath);
  const record = compass.setGoal({
    title: "Inspect runtime status",
    description: "Read and report the current runtime status only",
    successCriteria: ["status inspected"],
    constraints: [],
  });
  const goal = compassGoalToLoopGoal(record);
  compass.updateState({ status: "READY", nextAction: "Inspect current runtime state", blockers: [] });
  compass.close();

  const adapter = new CompassGoalExecutionAdapter(dbPath);
  const report = await adapter.run(goalWorkStateId(goal), { maxCycles: 1 });

  assert.equal(report.cycles.length, 1);
  assert.equal(report.cycles[0].action?.capability, "context.inspect");
  assert.equal(report.cycles[0].result?.ok, true);
});

test("paused Compass prevents resident development resume before any stage executes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compass-paused-"));
  const dbPath = join(dir, "compass.db");
  const compass = new CompassStore(dbPath);
  const record = compass.setGoal({ title: "Implement feature", successCriteria: ["verified"], constraints: [] });
  compass.updateState({ status: "PAUSED" }); compass.close();
  let runs = 0;
  const adapter = new CompassGoalExecutionAdapter(dbPath, {}, {}, { runtime: { matches: () => true, async run() { runs++; throw Error("must not run"); } } });
  const result = await adapter.run(goalWorkStateId(compassGoalToLoopGoal(record)));
  assert.equal(result.stopReason, "paused"); assert.equal(runs, 0);
});
