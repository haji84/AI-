import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActionResult,
  ContextItem,
  Goal,
  InferredIntent,
  Planner,
  ProposedAction,
} from "../src/orchestrator/goal-loop.ts";
import {
  buildPlannerEnhancementContext,
  PlannerEnhancementPlanner,
} from "../src/orchestrator/planner-enhancement.ts";

const goal: Goal = {
  title: "finish research task",
  description: "complete the task using the best available route",
  successCriteria: ["result verified", "artifact saved"],
  constraints: ["do not bypass Human Gates"],
};

const intent: InferredIntent = {
  summary: "finish the delegated task",
  confidence: 0.95,
  evidence: [{ source: "goal", text: "finish research task" }],
};

class QueuePlanner implements Planner {
  readonly calls: ContextItem[][] = [];
  private readonly actions: Array<ProposedAction | null>;

  constructor(actions: Array<ProposedAction | null>) {
    this.actions = [...actions];
  }

  async inferIntent(): Promise<InferredIntent> {
    return intent;
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
    previousResult?: ActionResult | null;
  }): Promise<ProposedAction | null> {
    this.calls.push(input.context);
    return this.actions.shift() ?? null;
  }
}

function metadata(action: ProposedAction | null): Record<string, unknown> {
  return ((action as ProposedAction & { metadata?: Record<string, unknown> } | null)?.metadata ?? {});
}

test("builds Phase 9 evidence from Goal DoD state connectivity capabilities resources verifier and recovery context", () => {
  const decision = buildPlannerEnhancementContext({
    goal,
    context: [
      {
        source: "runtime.snapshot",
        summary: "runtime state",
        data: {
          connectivity: "degraded",
          satisfiedCriteria: ["result verified"],
          capabilities: [
            { capability: "local.model", available: true, networkRequirement: "offline-capable", resources: ["cpu"] },
            { capability: "web.search", available: false, networkRequirement: "online-required", reason: "network unavailable" },
          ],
          resources: [
            { resource: "cpu", available: true },
            { resource: "gpu", available: false, reason: "worker busy" },
          ],
          verifierFailures: ["artifact hash missing"],
          avoidCapabilities: ["broken.worker"],
          riskCeiling: "medium",
        },
      },
    ],
    previousResult: { actionId: "attempt:1", ok: false, summary: "timeout", blocker: "worker unavailable" },
  });

  assert.equal(decision.evidence.connectivity, "degraded");
  assert.deepEqual(decision.evidence.satisfiedCriteria, ["result verified"]);
  assert.deepEqual(decision.evidence.unsatisfiedCriteria, ["artifact saved"]);
  assert.equal(decision.evidence.capabilities[0]?.capability, "local.model");
  assert.equal(decision.evidence.resources[1]?.available, false);
  assert.deepEqual(decision.evidence.verifierFailures, ["artifact hash missing"]);
  assert.deepEqual(decision.evidence.recoveryAvoidCapabilities, ["broken.worker"]);
  assert.equal(decision.evidence.previousFailure?.actionId, "attempt:1");
  assert.equal(decision.evidence.riskCeiling, "medium");
  assert.equal(decision.contextItem.source, "planner.phase9.runtime");
});

test("replans from online-required work to an offline-capable route when connectivity is offline", async () => {
  const delegate = new QueuePlanner([
    { id: "web:first", description: "research on web", capability: "web.search", risk: "low" },
    { id: "local:second", description: "use cached local model", capability: "local.model", risk: "low" },
  ]);
  const planner = new PlannerEnhancementPlanner(delegate);
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: [{
      source: "runtime.connectivity",
      summary: "offline",
      data: {
        connectivity: "offline",
        capabilities: [
          { capability: "web.search", available: true, networkRequirement: "online-required" },
          { capability: "local.model", available: true, networkRequirement: "offline-capable" },
        ],
      },
    }],
  });

  assert.equal(action?.id, "local:second");
  assert.equal(delegate.calls.length, 2);
  assert.ok(delegate.calls[1]?.some((item) => item.source === "planner.phase9.replan"));
  const evidence = metadata(action).plannerEnhancement as { replanned?: boolean; replanReasons?: string[] };
  assert.equal(evidence.replanned, true);
  assert.ok(evidence.replanReasons?.some((reason) => reason.includes("requires online connectivity")));
});

test("replans when the proposed capability depends on an unavailable resource", async () => {
  const delegate = new QueuePlanner([
    { id: "gpu:first", description: "run GPU model", capability: "gpu.infer", risk: "low" },
    { id: "cpu:second", description: "run CPU fallback", capability: "cpu.infer", risk: "low" },
  ]);
  const planner = new PlannerEnhancementPlanner(delegate);
  const action = await planner.proposeNextAction({
    goal,
    intent,
    context: [{
      source: "runtime.resources",
      summary: "gpu unavailable",
      data: {
        connectivity: "online",
        capabilities: [
          { capability: "gpu.infer", available: true, networkRequirement: "offline-capable", resources: ["gpu"] },
          { capability: "cpu.infer", available: true, networkRequirement: "offline-capable", resources: ["cpu"] },
        ],
        resources: [
          { resource: "gpu", available: false, reason: "device occupied" },
          { resource: "cpu", available: true },
        ],
      },
    }],
  });

  assert.equal(action?.id, "cpu:second");
  const evidence = metadata(action).plannerEnhancement as { replanReasons?: string[] };
  assert.ok(evidence.replanReasons?.some((reason) => reason.includes("required resource gpu is unavailable")));
});

test("uses previous failure and recovery evidence to avoid repeating the same strategy", async () => {
  const delegate = new QueuePlanner([
    { id: "attempt:1", description: "repeat failed worker", capability: "worker.primary", risk: "low" },
    { id: "attempt:2", description: "use fallback worker", capability: "worker.fallback", risk: "low" },
  ]);
  const planner = new PlannerEnhancementPlanner(delegate);
  const previousResult: ActionResult = {
    actionId: "attempt:1",
    ok: false,
    summary: "worker crashed",
    blocker: "worker unavailable",
  };
  const action = await planner.proposeNextAction({
    goal,
    intent,
    previousResult,
    context: [{
      source: "recovery.evidence",
      summary: "avoid primary worker",
      data: {
        avoidActionIds: ["attempt:1"],
        avoidCapabilities: ["worker.primary"],
        capabilities: [
          { capability: "worker.primary", available: true, networkRequirement: "offline-capable" },
          { capability: "worker.fallback", available: true, networkRequirement: "offline-capable" },
        ],
      },
    }],
  });

  assert.equal(action?.id, "attempt:2");
  assert.equal(delegate.calls.length, 2);
  const evidence = metadata(action).plannerEnhancement as { previousFailure?: { actionId?: string }; replanReasons?: string[] };
  assert.equal(evidence.previousFailure?.actionId, "attempt:1");
  assert.ok((evidence.replanReasons?.length ?? 0) >= 1);
});

test("does not weaken a high-risk Human Gate action", async () => {
  const delegate = new QueuePlanner([{
    id: "high:1",
    description: "production deployment",
    capability: "deploy.production",
    risk: "high",
    requiresHumanApproval: true,
    externalSideEffect: true,
  }]);
  const planner = new PlannerEnhancementPlanner(delegate);
  const action = await planner.proposeNextAction({ goal, intent, context: [] });

  assert.equal(action?.risk, "high");
  assert.equal(action?.requiresHumanApproval, true);
  assert.equal(action?.externalSideEffect, true);
  const evidence = metadata(action).plannerEnhancement as { replanned?: boolean };
  assert.equal(evidence.replanned, false);
});
