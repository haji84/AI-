import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { RepositoryFileContextSource, SafeConnectorContextSource } from "../src/orchestrator/context-adapters.ts";
import { dispatchAutonomyEvent } from "../src/orchestrator/event-runtime.ts";
import { GoalDrivenLoop, type Planner, type Verifier } from "../src/orchestrator/goal-loop.ts";

const goal = { title: "advance", successCriteria: [], constraints: [] };

function lowRiskAction(capability: string) {
  return { id: "a1", description: "inspect", capability, risk: "low" as const };
}

test("managed read capability executes while external write is gated", async () => {
  let readCalls = 0;
  let writeCalls = 0;
  const registry = new CapabilityRegistry()
    .registerManaged({
      name: "repo.read",
      metadata: { access: "read", externalSideEffect: false, risk: "low", requiresHumanApproval: false },
      async execute(action) {
        readCalls += 1;
        return { actionId: action.id, ok: true, summary: "read" };
      },
    })
    .registerManaged({
      name: "external.write",
      metadata: { access: "write", externalSideEffect: true, risk: "medium", requiresHumanApproval: true },
      async execute(action) {
        writeCalls += 1;
        return { actionId: action.id, ok: true, summary: "wrote" };
      },
    });

  assert.equal((await registry.execute(lowRiskAction("repo.read"), [])).ok, true);
  const blocked = await registry.execute(lowRiskAction("external.write"), []);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocker, "capability_requires_human_approval");
  assert.equal(readCalls, 1);
  assert.equal(writeCalls, 0);
});

test("missing connector degrades safely without fabricating access", async () => {
  const source = new SafeConnectorContextSource({
    name: "mail",
    async available() { return false; },
    async collect() { throw new Error("must not be called"); },
  });
  const items = await source.collect({ goal });
  assert.equal(items[0]?.summary, "connector_unavailable");
  assert.deepEqual(items[0]?.data, { connector: "mail", available: false });
});

test("repository context reads bounded local files", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-repo-context-"));
  await writeFile(join(root, "PROJECT_STATE.md"), "STATE=READY\n", "utf-8");
  const source = new RepositoryFileContextSource({ root, files: ["PROJECT_STATE.md", "MISSING.md"] });
  const items = await source.collect({ goal });
  assert.equal(items[0]?.summary.includes("STATE=READY"), true);
  assert.equal(items[1]?.summary.startsWith("unavailable:"), true);
});

test("repository event invokes bounded loop and writes durable Compass summaries", async () => {
  const compass = new CompassStore(":memory:");
  compass.setGoal({ title: "advance", successCriteria: [], constraints: [] });

  const planner: Planner = {
    async inferIntent() { return { summary: "advance", confidence: 0.9, evidence: [] }; },
    async proposeNextAction() { return null; },
  };
  const verifier: Verifier = {
    async verify() { return { ok: true, summary: "ok" }; },
  };
  const loop = new GoalDrivenLoop(
    planner,
    [],
    { async execute(action) { return { actionId: action.id, ok: true, summary: "done" }; } },
    verifier,
    { async getState() { return { completed: [], blockers: [] }; }, async writeBack() {} },
  );

  const report = await dispatchAutonomyEvent({
    event: { type: "repository_state", id: "evt-1", summary: "main changed" },
    loop,
    goal,
    compass,
    maxCycles: 2,
  });

  assert.equal(report.stopReason, "goal_complete");
  const history = compass.getHistory(10);
  assert.equal(history.some((entry) => entry.summary.includes("evt-1")), true);
  compass.close();
});
