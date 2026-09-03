import assert from "node:assert/strict";
import test from "node:test";
import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import { TeamAwarePlanner } from "../src/orchestrator/team-aware-planner.ts";
import { buildTeamPlanningBundle } from "../src/orchestrator/team-planning-context.ts";

const goal: Goal = {
  title: "Advance repository",
  successCriteria: ["verified"],
  constraints: ["preserve Human Gate"],
};

const intent: InferredIntent = { summary: "advance", confidence: 0.9, evidence: [] };

function blockedContext(issue: { number: number; title: string; body: string }): ContextItem[] {
  return [
    {
      source: "repository.file:PROJECT_STATE.md",
      summary: "NEXT_PRIORITY: complete machine-bound real-machine smoke before advancing Phase 3",
    },
    {
      source: "github.repository_state",
      summary: "live repository state",
      data: { openIssues: [issue] },
    },
  ];
}

test("team planning bundle executes backend team in bounded handoff order", async () => {
  const bundle = await buildTeamPlanningBundle({
    issue: { number: 10, title: "feat: implement backend API endpoint", body: "Add tests for the backend service." },
  });

  assert.deepEqual(bundle.execution.plannedOrder, ["PM", "Backend", "QA", "Reviewer"]);
  assert.equal(bundle.execution.stopReason, "completed");
  assert.equal(bundle.context.source, "team.execution");
  assert.match(bundle.context.summary, /PM -> Backend -> QA -> Reviewer/);
});

test("team-aware planner adds completed team execution to downstream planner context", async () => {
  let seenContext: ContextItem[] = [];
  const expected: ProposedAction = { id: "next", description: "propose bounded change", capability: "context.inspect", risk: "low" };
  const delegate: Planner = {
    async inferIntent() { return intent; },
    async proposeNextAction(input) {
      seenContext = input.context;
      return expected;
    },
  };

  const planner = new TeamAwarePlanner(delegate);
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: blockedContext({
      number: 20,
      title: "feat: implement backend API endpoint",
      body: "Implement the service and add tests.",
    }),
  });

  assert.deepEqual(action, expected);
  const teamContext = seenContext.find((item) => item.source === "team.execution");
  assert.ok(teamContext);
  const data = teamContext.data as { execution: { stopReason: string; plannedOrder: string[] } };
  assert.equal(data.execution.stopReason, "completed");
  assert.deepEqual(data.execution.plannedOrder, ["PM", "Backend", "QA", "Reviewer"]);
});

test("team-aware planner stops at Human Gate before delegating a privileged issue", async () => {
  let delegated = false;
  const delegate: Planner = {
    async inferIntent() { return intent; },
    async proposeNextAction() {
      delegated = true;
      return { id: "unsafe", description: "must not run", capability: "context.inspect", risk: "low" };
    },
  };

  const planner = new TeamAwarePlanner(delegate);
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: blockedContext({
      number: 21,
      title: "security: change repository permissions",
      body: "Update authorization permissions for deployment.",
    }),
  });

  assert.equal(delegated, false);
  assert.equal(action?.capability, "team.human_gate");
  assert.equal(action?.risk, "high");
  assert.equal(action?.requiresHumanApproval, true);
});
