import assert from "node:assert/strict";
import test from "node:test";
import { BaselinePlanner, createContextInspectCapability } from "../src/orchestrator/baseline-planner.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";

const action = {
  id: "a1",
  description: "inspect state",
  capability: "context.inspect",
  risk: "low" as const,
};

test("registered low-risk capability executes", async () => {
  const registry = new CapabilityRegistry().register(createContextInspectCapability());
  const result = await registry.execute(action, [{ source: "state", summary: "ready" }]);
  assert.equal(result.ok, true);
  assert.match(result.summary, /Inspected context/);
});

test("missing capability stops safely", async () => {
  const registry = new CapabilityRegistry();
  const result = await registry.execute({ ...action, capability: "missing" }, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "capability_not_registered:missing");
});

test("dry-run never calls capability handler", async () => {
  let called = false;
  const registry = new CapabilityRegistry({ dryRun: true }).register({
    name: "context.inspect",
    async execute() {
      called = true;
      return { actionId: "a1", ok: true, summary: "executed" };
    },
  });
  const result = await registry.execute(action, []);
  assert.equal(result.ok, true);
  assert.equal(called, false);
  assert.match(result.summary, /dry-run/);
});

test("baseline planner uses persisted next action", async () => {
  const planner = new BaselinePlanner();
  const goal = { title: "Ship autonomy", successCriteria: [], constraints: [] };
  const intent = await planner.inferIntent({ goal, context: [] });
  const next = await planner.proposeNextAction({
    goal,
    intent,
    context: [{ source: "state.next_action", summary: "check GitHub issue" }],
  });
  assert.equal(next?.description, "check GitHub issue");
  assert.equal(next?.capability, "context.inspect");
});
