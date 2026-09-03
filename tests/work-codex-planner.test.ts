import assert from "node:assert/strict";
import test from "node:test";
import { WorkCodexPlanningClient } from "../src/orchestrator/work-codex-planner.ts";
import type { ContextItem, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Advance repository safely",
  successCriteria: ["verified"],
  constraints: ["Human Gate for merge"],
};
const context: ContextItem[] = [];

test("accepts a bounded plan explicitly handed off by Work/Codex", async () => {
  const client = new WorkCodexPlanningClient(JSON.stringify({
    source: "work-codex",
    plan: {
      kind: "propose_pr",
      description: "Add one bounded regression test",
      title: "test: add regression coverage",
      body: "Work/Codex planned change",
      files: [{ path: "tests/example.test.ts", content: "export {};\n" }],
    },
  }));

  const plan = await client.plan({ goal, context });
  assert.equal(plan.kind, "propose_pr");
  assert.equal(plan.files?.length, 1);
});

test("fails hard when Work/Codex handoff is missing", async () => {
  await assert.rejects(
    () => new WorkCodexPlanningClient("").plan({ goal, context }),
    /Work\/Codex planning handoff is required/,
  );
});

test("rejects handoffs from any other planning source", async () => {
  await assert.rejects(
    () => new WorkCodexPlanningClient(JSON.stringify({
      source: "other-provider",
      plan: { kind: "inspect", description: "Inspect" },
    })).plan({ goal, context }),
    /source=work-codex/,
  );
});

test("rejects malformed propose_pr plans", async () => {
  await assert.rejects(
    () => new WorkCodexPlanningClient(JSON.stringify({
      source: "work-codex",
      plan: { kind: "propose_pr", description: "Missing files", title: "bad" },
    })).plan({ goal, context }),
    /1-3 files/,
  );
});
