import test from "node:test";
import assert from "node:assert/strict";
import { CommonWorkerRuntime } from "../src/gai/common-worker-runtime.ts";
import { MultiWorkerRuntime, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";
import { WorkerBuilderCapability } from "../src/gai/worker-builder-capability.ts";
import { BuilderRouter } from "../src/orchestrator/builder-router.ts";

const descriptor: WorkerDescriptor = {
  id: "zbook-code-builder",
  label: "ZBook code builder",
  platform: "windows",
  capabilities: ["code-builder", "filesystem", "windows-tooling", "long-running"],
  maxParallelTasks: 1,
  enabled: true,
  executionModes: ["resident"],
  persistence: { localState: true, checkpointResume: true, offlineQueue: true },
  securityContext: { credentialIsolation: true, taskScopedAuthorization: true },
  verifierHooks: { executionEvidence: true, artifactEvidence: true },
};

test("BuilderRouter executes through a real CommonWorkerRuntime code-builder handler", async () => {
  const worker = new CommonWorkerRuntime({ descriptor }).registerCapability("code-builder", async (request) => ({
    output: "changed controlled fixture",
    evidence: { strategy: JSON.parse(request.input).strategyId, changed: ["fixture.ts"] },
  }));
  const runtime = new MultiWorkerRuntime([worker]);
  const router = new BuilderRouter([new WorkerBuilderCapability(runtime, { preferredPlatform: "windows" })]);
  const result = await router.execute({
    id: "build-2",
    description: "apply alternate implementation",
    capability: "code.builder",
    risk: "medium",
    input: { goalId: "goal-1", attemptId: "attempt-2", strategyId: "strategy-b", objective: "apply alternate implementation" },
  }, []);
  assert.equal(result.ok, true);
  assert.equal((result.evidence as { workerId: string }).workerId, "zbook-code-builder");
  assert.equal((result.evidence as { strategyId: string }).strategyId, "strategy-b");
});
