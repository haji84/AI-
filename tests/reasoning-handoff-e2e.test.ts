import assert from "node:assert/strict";
import test from "node:test";
import {
  createDashboardBoundedPlan,
  dashboardCommandNeedsReasoning,
} from "../src/orchestrator/dashboard-command-routing.ts";
import {
  GoalDrivenLoop,
  type ActionResult,
  type Goal,
  type Planner,
  type ProposedAction,
  type StateStore,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { ModelBackedPlanner } from "../src/orchestrator/model-planner.ts";
import { reasoningHandoffRequiredOutcome } from "../src/orchestrator/autonomy-run-outcome.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";
import { UnifiedPlanningClient } from "../src/orchestrator/unified-planning-client.ts";

const command = "Issue #258のE2Eテストとしてコントロールセンターの表示を1か所改善して完成させて";
const goal: Goal = {
  title: "Verify reasoning handoff E2E",
  description: "Prove an execution command pauses for reasoning, then one explicit bounded repository mutation can execute and verify.",
  successCriteria: ["handoff preserved", "bounded mutation verified"],
  constraints: ["no Production", "no secrets or permission changes"],
};

function createStore() {
  const records: WriteBackRecord[] = [];
  const store: StateStore = {
    async getState() {
      return { completed: [], blockers: [], nextAction: null };
    },
    async writeBack(record) {
      records.push(record);
    },
  };
  return { store, records };
}

function staticPlanner(action: ProposedAction): Planner {
  return {
    async inferIntent() {
      return { summary: "execute bounded E2E action", confidence: 1, evidence: [{ source: "goal", text: goal.title }] };
    },
    async proposeNextAction() {
      return action;
    },
  };
}

test("dashboard execution command becomes a visible reasoning handoff without fake inspect or mutation", async () => {
  assert.equal(dashboardCommandNeedsReasoning(command), true);
  assert.equal(createDashboardBoundedPlan(command), undefined);

  const taskAuthorization = createTaskCompletionAuthorization(command, {
    now: new Date("2026-09-09T00:00:00.000Z"),
    idFactory: () => "unused",
  });
  assert.ok(taskAuthorization);
  assert.equal(taskAuthorization.scopeId, "issue:258");

  const client = new UnifiedPlanningClient(JSON.stringify({
    source: "chat",
    command,
    taskAuthorization,
  }));

  assert.equal(client.command.command, command);
  assert.equal(client.command.taskAuthorization?.scopeId, "issue:258");
  await assert.rejects(() => client.plan(), /requires an explicit bounded plan/);

  const outcome = reasoningHandoffRequiredOutcome(client.command.source, client.command.command);
  assert.equal(outcome.status, "reasoning_handoff_required");
  assert.match(outcome.verificationSummary, /no repository mutation was executed/);
  assert.match(outcome.nextAction, /explicit bounded plan/);
  assert.match(outcome.nextAction, /Issue #258/);
});

test("explicit bounded reasoning plan advances exactly once into repository mutation, verification, and write-back", async () => {
  const taskAuthorization = createTaskCompletionAuthorization(command, {
    now: new Date("2026-09-09T00:00:00.000Z"),
  });
  assert.ok(taskAuthorization);

  const client = new UnifiedPlanningClient(JSON.stringify({
    source: "chat",
    command,
    taskAuthorization,
    plan: {
      kind: "propose_pr",
      description: "Apply one harmless control-center wording improvement for the E2E smoke",
      title: "test: control-center reasoning handoff smoke",
      body: "Issue #258 bounded E2E mutation",
      files: [{
        path: "docs/reasoning-handoff-e2e-smoke.md",
        content: "# Reasoning handoff E2E smoke\n\nBounded repository mutation reached verification.\n",
      }],
    },
  }));

  const planner = new ModelBackedPlanner(client, undefined, { explicitBoundedPlan: true });
  const { store, records } = createStore();
  let mutationCalls = 0;
  let capturedInput: unknown = null;

  const loop = new GoalDrivenLoop(
    planner,
    [],
    {
      async execute(action): Promise<ActionResult> {
        assert.equal(action.capability, "repository.propose_pr");
        mutationCalls += 1;
        capturedInput = action.input;
        return {
          actionId: action.id,
          ok: true,
          summary: "bounded repository proposal executed",
          evidence: { mutation: "repository.propose_pr" },
        };
      },
    },
    {
      async verify({ result }) {
        return {
          ok: result.ok,
          summary: "bounded repository mutation verified",
          evidence: result.evidence,
        };
      },
    },
    store,
  );

  const report = await loop.runCycle({ goal });
  assert.equal(mutationCalls, 1);
  assert.equal(report.stopReason, "goal_complete");
  assert.equal(report.action?.capability, "repository.propose_pr");
  assert.equal(report.verification?.ok, true);
  assert.equal(report.verification?.summary, "bounded repository mutation verified");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.stopReason, "goal_complete");

  const input = capturedInput as { taskAuthorization?: { scopeId?: string }; taskScopeId?: string };
  assert.equal(input.taskAuthorization?.scopeId, "issue:258");
  assert.equal(input.taskScopeId, "issue:258");
});

test("HIGH stays at Human Gate and CRITICAL stays blocked before execution", async () => {
  const highStore = createStore();
  let highExecutions = 0;
  const highAction: ProposedAction = {
    id: "e2e:high",
    description: "protected high-risk step",
    capability: "repository.propose_pr",
    risk: "high",
    externalSideEffect: true,
  };
  const highLoop = new GoalDrivenLoop(
    staticPlanner(highAction),
    [],
    {
      async execute() {
        highExecutions += 1;
        return { actionId: highAction.id, ok: true, summary: "must not execute" };
      },
    },
    { async verify() { return { ok: true, summary: "unused" }; } },
    highStore.store,
  );
  const highReport = await highLoop.runCycle({ goal });
  assert.equal(highReport.stopReason, "approval_required");
  assert.equal(highExecutions, 0);

  const criticalStore = createStore();
  let criticalExecutions = 0;
  const criticalAction: ProposedAction = {
    id: "e2e:critical",
    description: "relax Human Gate policy",
    capability: "repository.propose_pr",
    risk: "low",
    riskSignals: { humanGatePolicyRelaxation: true },
  };
  const criticalLoop = new GoalDrivenLoop(
    staticPlanner(criticalAction),
    [],
    {
      async execute() {
        criticalExecutions += 1;
        return { actionId: criticalAction.id, ok: true, summary: "must not execute" };
      },
    },
    { async verify() { return { ok: true, summary: "unused" }; } },
    criticalStore.store,
  );
  const criticalReport = await criticalLoop.runCycle({ goal });
  assert.equal(criticalReport.stopReason, "blocked");
  assert.equal(criticalReport.riskDecision?.level, "CRITICAL");
  assert.equal(criticalExecutions, 0);
});
