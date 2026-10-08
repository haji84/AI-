import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CompassGoalExecutionAdapter } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "goriq-legacy-adapter-")), dbPath = join(root, "compass.db");
  const db = new CompassStore(dbPath);
  const record = db.setGoal({ title: "Implement normal JARVIS runtime Builder smoke",
    description: "Edit only tests/fixtures/runtime-builder-daily-smoke.txt.",
    successCriteria: ["Implement the requested controlled change"], constraints: ["Only the controlled smoke fixture may change"] });
  db.updateState({ status: "READY", nextAction: "Edit tests/fixtures/runtime-builder-daily-smoke.txt so its complete content is runtime-wrong", blockers: [] });
  db.close();
  return { root, dbPath, goalId: goalWorkStateId(compassGoalToLoopGoal(record)) };
}
test("default adapter preserves the existing Builder planner and creates no Cognitive state", async t => {
  const f = await fixture();
  const actions: string[] = [];
  // Exercise real planner/Goal Loop/WorkState, but never invoke a configured physical Builder or model.
  t.mock.method(CapabilityRegistry.prototype, "execute", async (action: { id: string; capability: string }) => {
    actions.push(action.capability);
    return { actionId: action.id, ok: false, summary: "Controlled isolated Builder unavailable", blocker: "review_fixture_unavailable" };
  });
  t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected network in isolated regression"); });
  const report = await new CompassGoalExecutionAdapter(f.dbPath).run(f.goalId, { maxCycles: 1 });
  assert.equal(report.cycles[0].action?.capability, "code.builder");
  assert.deepEqual(actions, ["code.builder"]);
  assert.notEqual(report.goalEvaluation?.achieved, true);
  await assert.rejects(access(join(f.root, "cognitive")), { code: "ENOENT" });
});

test("Cognitive options cannot silently change a legacy caller without explicit opt-in", () => {
  assert.throws(() => new CompassGoalExecutionAdapter("unused.db", {}, { stateRoot: "unused" }), /explicit useCore/);
  assert.throws(() => new CompassGoalExecutionAdapter("unused.db", {}, { useCore: false, allowExternalAI: true }), /explicit useCore/);
});

test("explicit Cognitive mode still filters external Builder and records bounded local cognition", async t => {
  const f = await fixture();
  const actions: string[] = [];
  t.mock.method(CapabilityRegistry.prototype, "execute", async (action: { id: string; capability: string }) => {
    actions.push(action.capability);
    return { actionId: action.id, ok: false, summary: "Controlled isolated observation", blocker: "review_fixture_unavailable" };
  });
  t.mock.method(globalThis, "fetch", async () => { throw Error("Unexpected network in isolated regression"); });
  const report = await new CompassGoalExecutionAdapter(f.dbPath, {}, { useCore: true }).run(f.goalId, { maxCycles: 1 });
  assert.equal(report.cycles[0].action?.capability, "context.inspect");
  assert.deepEqual(actions, ["context.inspect"]);
  assert.notEqual(report.goalEvaluation?.achieved, true);
  await access(join(f.root, "cognitive"));
});
