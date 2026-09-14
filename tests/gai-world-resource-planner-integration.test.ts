import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { collectWorldResources } from "../src/gai/world-resource-collector.ts";
import { PersistentWorldResourceModel } from "../src/gai/world-resource-model.ts";
import { createFunctionWorker } from "../src/gai/worker-runtime.ts";
import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "../src/orchestrator/goal-loop.ts";
import { PlannerEnhancementPlanner } from "../src/orchestrator/planner-enhancement.ts";
import { WorldResourceContextSource } from "../src/orchestrator/world-resource-context.ts";

const goal: Goal = {
  title: "resource-aware task",
  description: "finish using an actually available capability",
  successCriteria: ["verified"],
  constraints: [],
};
const intent: InferredIntent = { summary: "finish", confidence: 1, evidence: [] };

class TwoStepPlanner implements Planner {
  calls: ContextItem[][] = [];
  private index = 0;

  async inferIntent(): Promise<InferredIntent> { return intent; }

  async proposeNextAction(input: { goal: Goal; context: ContextItem[]; intent: InferredIntent }): Promise<ProposedAction | null> {
    this.calls.push(input.context);
    this.index += 1;
    return this.index === 1
      ? { id: "gpu", description: "use gpu", capability: "gpu", risk: "low" }
      : { id: "local", description: "use local model", capability: "local-model", risk: "low" };
  }
}

test("worker preflight -> persistent resource model -> context source -> Phase 9 replan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-world-planner-"));
  try {
    const model = new PersistentWorldResourceModel(join(dir, "resources.json"));
    const now = new Date();
    const worker = createFunctionWorker({
      descriptor: {
        id: "node-1",
        label: "node-1",
        platform: "macos",
        capabilities: ["local-model"],
        maxParallelTasks: 1,
        enabled: true,
        executionModes: ["resident"],
        networkRequirement: "offline-capable",
      },
      health: () => ({
        available: true,
        connectivity: "offline",
        resources: { cpuAvailable: true, gpuAvailable: false, memoryAvailableMb: 8000 },
        runtimeState: { activeTasks: 0, completedTasks: 0, failedTasks: 0 },
      }),
      run: async () => "ok",
    });

    const collection = await collectWorldResources({ model, workers: [worker], ttlMs: 120_000, now });
    assert.equal(collection.failures.length, 0);
    assert.equal(collection.observations.length, 1);

    const contextSource = new WorldResourceContextSource(model);
    const context = await contextSource.collect();
    const resourceData = context[0]?.data as { connectivity?: string; capabilities?: Array<{ capability: string }> };
    assert.equal(resourceData.connectivity, "offline");
    assert.ok(resourceData.capabilities?.some((item) => item.capability === "local-model"));

    const delegate = new TwoStepPlanner();
    const planner = new PlannerEnhancementPlanner(delegate);
    const action = await planner.proposeNextAction({ goal, context, intent });

    assert.equal(action?.id, "gpu");
    assert.equal(delegate.calls.length, 1, "unknown/unreported gpu capability must not be fabricated as unavailable");
    assert.ok(delegate.calls[0]?.some((item) => item.source === "world.resource.snapshot"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("collector records one worker failure without discarding healthy peer observations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-world-collector-"));
  try {
    const model = new PersistentWorldResourceModel(join(dir, "resources.json"));
    const good = createFunctionWorker({
      descriptor: { id: "good", label: "good", platform: "windows", capabilities: ["filesystem"], maxParallelTasks: 1, enabled: true },
      health: () => ({ available: true, connectivity: "online" }),
      run: async () => "ok",
    });
    const bad = {
      descriptor: { id: "bad", label: "bad", platform: "macos" as const, capabilities: ["filesystem" as const], maxParallelTasks: 1, enabled: true },
      async health(): Promise<never> { throw new Error("probe failed"); },
      async execute(): Promise<never> { throw new Error("not used"); },
    };

    const result = await collectWorldResources({ model, workers: [bad, good] });
    assert.equal(result.observations.length, 1);
    assert.deepEqual(result.failures, [{ workerId: "bad", error: "probe failed" }]);
    assert.equal((await model.get("good")).knowledgeState, "fresh");
    assert.equal((await model.get("bad")).knowledgeState, "unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
