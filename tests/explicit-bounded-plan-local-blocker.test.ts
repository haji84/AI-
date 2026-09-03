import assert from "node:assert/strict";
import test from "node:test";
import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import { TeamAwarePlanner } from "../src/orchestrator/team-aware-planner.ts";

const goal: Goal = {
  title: "Run explicit bounded plan",
  successCriteria: ["verified"],
  constraints: ["preserve Human Gate"],
};

const intent: InferredIntent = { summary: "execute supplied plan", confidence: 1, evidence: [] };

function localBlockedContext(): ContextItem[] {
  return [
    {
      source: "event:manual",
      summary: "chat command: Run Issue #158 with the supplied bounded propose_pr plan.",
    },
    {
      source: "repository.file:PROJECT_STATE.md",
      summary: "NEXT_PRIORITY: complete machine-bound real-machine smoke before advancing Phase 3",
    },
    {
      source: "github.repository_state",
      summary: "live repository state",
      data: {
        openIssues: [
          {
            number: 158,
            title: "test: live autonomy smoke",
            body: "Cloud-only bounded smoke. Merge remains an explicit Human Gate.",
          },
        ],
      },
    },
  ];
}

test("explicit bounded plan bypasses unrelated local-blocker team preselection", async () => {
  const expected: ProposedAction = {
    id: "explicit-plan",
    description: "execute supplied bounded PR plan",
    capability: "repository.propose_pr",
    risk: "low",
    irreversible: false,
    externalSideEffect: true,
  };
  let delegated = 0;
  const delegate: Planner = {
    async inferIntent() { return intent; },
    async proposeNextAction(input) {
      delegated += 1;
      assert.equal(input.context.some((item) => item.source === "team.execution"), false);
      return expected;
    },
  };

  const planner = new TeamAwarePlanner(delegate, { explicitBoundedPlan: true });
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: localBlockedContext(),
  });

  assert.equal(delegated, 1);
  assert.deepEqual(action, expected);
});

test("without explicit bounded plan the existing local-blocker team path is preserved", async () => {
  let delegated = 0;
  const delegate: Planner = {
    async inferIntent() { return intent; },
    async proposeNextAction(input) {
      delegated += 1;
      assert.equal(input.context.some((item) => item.source === "team.execution"), true);
      return { id: "normal", description: "normal downstream plan", capability: "context.inspect", risk: "low" };
    },
  };

  const planner = new TeamAwarePlanner(delegate);
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: localBlockedContext(),
  });

  assert.equal(delegated, 1);
  assert.equal(action?.id, "normal");
});
