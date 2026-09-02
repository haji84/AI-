import assert from "node:assert/strict";
import test from "node:test";
import { CopilotCliPlanningClient, type CopilotCommandRunner } from "../src/orchestrator/copilot-cli-planner.ts";
import { ResilientPlanningModel } from "../src/orchestrator/resilient-planning-model.ts";
import type { ContextItem, Goal } from "../src/orchestrator/goal-loop.ts";

const goal: Goal = {
  title: "Advance repository safely",
  successCriteria: ["verified"],
  constraints: ["Human Gate for merge"],
};

const context: ContextItem[] = [{
  source: "parallel.cloud_candidates",
  summary: "Choose at most one cloud-safe issue",
  data: { candidates: [{ number: 98, title: "test: add regression coverage" }] },
}];

test("Copilot CLI planner runs in non-interactive planning-only mode and parses a bounded plan", async () => {
  let observedCommand = "";
  let observedArgs: string[] = [];
  const runner: CopilotCommandRunner = {
    async run(command, args) {
      observedCommand = command;
      observedArgs = args;
      return JSON.stringify({
        kind: "propose_pr",
        description: "Add one regression test",
        title: "test: add regression coverage",
        body: "Bounded proposal",
        files: [{ path: "tests/example.test.ts", content: "export {};\n" }],
      });
    },
  };

  const plan = await new CopilotCliPlanningClient({ runner, command: "copilot-test", model: "auto" }).plan({ goal, context });
  assert.equal(observedCommand, "copilot-test");
  assert.ok(observedArgs.includes("-s"));
  assert.ok(observedArgs.includes("--no-ask-user"));
  assert.ok(observedArgs.includes("--deny-tool=read"));
  assert.ok(observedArgs.includes("--deny-tool=write"));
  assert.ok(observedArgs.includes("--deny-tool=shell"));
  assert.ok(observedArgs.includes("--deny-tool=url"));
  assert.ok(observedArgs.includes("--deny-tool=memory"));
  assert.ok(observedArgs.includes("--model=auto"));
  assert.equal(plan.kind, "propose_pr");
  assert.equal(plan.files?.length, 1);
});

test("Copilot CLI planner accepts a fenced JSON response", async () => {
  const runner: CopilotCommandRunner = {
    async run() {
      return "```json\n{\"kind\":\"inspect\",\"description\":\"Inspect only\"}\n```\n";
    },
  };
  const plan = await new CopilotCliPlanningClient({ runner }).plan({ goal, context });
  assert.equal(plan.kind, "inspect");
});

test("Copilot CLI command failure is contained by the resilient planning wrapper", async () => {
  const runner: CopilotCommandRunner = {
    async run() {
      throw new Error("copilot binary unavailable");
    },
  };
  const model = new ResilientPlanningModel(new CopilotCliPlanningClient({ runner }));
  const plan = await model.plan({ goal, context });
  assert.equal(plan.kind, "inspect");
  assert.match(plan.description, /Planner provider unavailable/);
  assert.match(plan.description, /copilot binary unavailable/);
});

test("Copilot CLI planner rejects malformed plan output", async () => {
  const runner: CopilotCommandRunner = {
    async run() {
      return "not json";
    },
  };
  await assert.rejects(
    () => new CopilotCliPlanningClient({ runner }).plan({ goal, context }),
    /non-JSON plan content/,
  );
});
