import assert from "node:assert/strict";
import test from "node:test";
import {
  GoalDrivenLoop,
  type ActionResult,
  type Goal,
  type InferredIntent,
  type Planner,
  type ProposedAction,
  type StateStore,
  type VerificationResult,
  type Verifier,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import {
  GoalLoopWorkerExecutor,
  createStaticGoalActionWorkerResolver,
} from "../src/gai/goal-loop-worker-executor.ts";
import {
  createMacbookWorkerAdapter,
  createZbookWorkerAdapter,
} from "../src/gai/initial-worker-adapters.ts";
import { MultiWorkerRuntime } from "../src/gai/worker-runtime.ts";

const goal: Goal = {
  title: "Run local research",
  description: "Use an available worker capability",
  successCriteria: ["verified result"],
  constraints: [],
};

function plannerFor(action: ProposedAction): Planner {
  return {
    async inferIntent(): Promise<InferredIntent> {
      return { summary: "complete requested work", confidence: 1, evidence: [{ source: "goal", text: goal.title }] };
    },
    async proposeNextAction() {
      return action;
    },
  };
}

function memoryStore(): StateStore & { records: WriteBackRecord[] } {
  const records: WriteBackRecord[] = [];
  return {
    records,
    async getState() {
      return { completed: [], blockers: [], nextAction: null };
    },
    async writeBack(record) {
      records.push(record);
    },
  };
}

test("GoalDrivenLoop routes planner capability to worker and verifier without device hard-coding", async () => {
  const zbook = createZbookWorkerAdapter({
    handlers: {
      gpu: async () => ({ output: "zbook-result", evidence: { model: "local" } }),
    },
  });
  const macbook = createMacbookWorkerAdapter({
    handlers: {
      "local-model": async () => "mac-result",
    },
  });
  const runtime = new MultiWorkerRuntime([macbook, zbook]);
  const executor = new GoalLoopWorkerExecutor({
    runtime,
    resolve: createStaticGoalActionWorkerResolver({
      "research.gpu": {
        requestedCapability: "gpu",
        requiredCapabilities: ["gpu", "local-model"],
      },
    }),
  });

  let verifierEvidence: unknown;
  const verifier: Verifier = {
    async verify(input): Promise<VerificationResult> {
      verifierEvidence = input.result.evidence;
      return { ok: true, summary: "worker evidence verified", evidence: input.result.evidence };
    },
  };
  const store = memoryStore();
  const loop = new GoalDrivenLoop(
    plannerFor({
      id: "goal-worker-1",
      description: "perform GPU research",
      capability: "research.gpu",
      risk: "low",
      completesBoundedCommand: true,
      input: { query: "test" },
    }),
    [{ name: "test-context", async collect() { return [{ source: "test", summary: "context" }]; } }],
    executor,
    verifier,
    store,
  );

  const report = await loop.runCycle({ goal });
  assert.equal(report.stopReason, "goal_complete");
  assert.equal(report.result?.ok, true);
  const evidence = report.result?.evidence as Record<string, unknown>;
  assert.equal(evidence.selectedWorkerId, "zbook");
  assert.equal(evidence.requestedCapability, "gpu");
  assert.deepEqual(verifierEvidence, report.result?.evidence);
});

test("worker execution failure returns into existing Goal Loop recovery path", async () => {
  const zbook = createZbookWorkerAdapter({
    handlers: {
      gpu: async () => { throw new Error("gpu runtime failed"); },
    },
  });
  const executor = new GoalLoopWorkerExecutor({
    runtime: new MultiWorkerRuntime([zbook]),
    resolve: createStaticGoalActionWorkerResolver({
      "research.gpu": { requestedCapability: "gpu" },
    }),
  });
  const verifier: Verifier = {
    async verify(): Promise<VerificationResult> {
      throw new Error("verifier must not run after failed execution");
    },
  };
  const store = memoryStore();
  const loop = new GoalDrivenLoop(
    plannerFor({
      id: "goal-worker-failure",
      description: "perform GPU research",
      capability: "research.gpu",
      risk: "low",
    }),
    [],
    executor,
    verifier,
    store,
  );

  const report = await loop.runCycle({ goal });
  assert.equal(report.result?.ok, false);
  assert.equal(report.result?.blocker, undefined);
  assert.equal((report.result?.evidence as Record<string, unknown>).failureCode, "WORKER_EXECUTION_FAILED");
  assert.ok(report.recoveryDecision);
  assert.equal(report.recoveryDecision?.blocked, false);
  assert.equal(report.stopReason, "continue");
});

test("unmapped capability fails visibly without inventing a device route", async () => {
  const executor = new GoalLoopWorkerExecutor({
    runtime: new MultiWorkerRuntime([]),
    resolve: createStaticGoalActionWorkerResolver({}),
  });
  const result: ActionResult = await executor.execute({
    id: "unmapped",
    description: "unknown action",
    capability: "future.android.capability",
    risk: "low",
  }, []);

  assert.equal(result.ok, false);
  assert.equal(result.blocker, undefined);
  assert.equal((result.evidence as Record<string, unknown>).failureCode, "WORKER_CAPABILITY_MAPPING_UNAVAILABLE");
  assert.match(result.summary, /future\.android\.capability/);
});

test("routing hints can express iOS/mobile constraints without Goal Loop platform branches", async () => {
  const macbook = createMacbookWorkerAdapter({
    handlers: { "local-model": async () => "mac" },
  });
  const executor = new GoalLoopWorkerExecutor({
    runtime: new MultiWorkerRuntime([macbook]),
    resolve: createStaticGoalActionWorkerResolver({
      "mobile.capture": {
        requestedCapability: "camera",
        preferredPlatform: "ios",
        requiredExecutionMode: "foreground",
        allowOffline: true,
      },
    }),
  });

  const result = await executor.execute({
    id: "ios-route",
    description: "capture image",
    capability: "mobile.capture",
    risk: "low",
  }, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, undefined);
  assert.equal((result.evidence as Record<string, unknown>).failureCode, "WORKER_ROUTING_FAILED");
  assert.match(result.summary, /No healthy worker satisfies task/);
});
