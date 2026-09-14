import assert from "node:assert/strict";
import test from "node:test";
import {
  createIphoneWorkerAdapter,
  createMacbookWorkerAdapter,
  createResearchWorkerCapabilityHandler,
  createZbookWorkerAdapter,
} from "../src/gai/initial-worker-adapters.ts";

const task = {
  id: "adapter-task",
  title: "adapter task",
  description: "exercise initial worker adapters",
  difficulty: 5,
  risk: "LOW" as const,
  requiresFrontierReasoning: false,
  requiresLongContext: false,
};

test("ZBook and MacBook profiles become common runtimes with injected handlers", async () => {
  const zbook = createZbookWorkerAdapter({ handlers: { gpu: async () => "zbook-gpu" } });
  const macbook = createMacbookWorkerAdapter({ handlers: { "local-model": async () => "mac-local" } });

  const zbookResult = await zbook.execute({ task, input: "run", requestedCapability: "gpu" });
  const macResult = await macbook.execute({ task, input: "run", requestedCapability: "local-model" });

  assert.equal(zbookResult.ok, true);
  assert.equal(zbookResult.workerId, "zbook");
  assert.equal(zbookResult.output, "zbook-gpu");
  assert.equal(macResult.ok, true);
  assert.equal(macResult.workerId, "macbook");
  assert.equal(macResult.output, "mac-local");
});

test("existing ResearchWorkerRunner can execute as a common runtime capability", async () => {
  const calls: unknown[] = [];
  const handler = createResearchWorkerCapabilityHandler({
    workerId: "zbook",
    kind: "gpu",
    runner: {
      async execute(request, workerId) {
        calls.push({ request, workerId });
        return {
          ok: true,
          summary: `researched:${request.query}`,
          evidence: { model: "local-test" },
        };
      },
    },
  });
  const zbook = createZbookWorkerAdapter({ handlers: { gpu: handler } });
  const result = await zbook.execute({ task, input: "investigate", requestedCapability: "gpu" });

  assert.equal(result.ok, true);
  assert.equal(result.output, "researched:investigate");
  assert.equal(calls.length, 1);
  assert.deepEqual(result.evidence?.capabilityEvidence, {
    researchKind: "gpu",
    researchWorkerId: "zbook",
    researchEvidence: { model: "local-test" },
  });
});

test("research capability failure remains visible through common runtime", async () => {
  const zbook = createZbookWorkerAdapter({
    handlers: {
      "local-model": createResearchWorkerCapabilityHandler({
        workerId: "zbook",
        kind: "local-model",
        runner: {
          async execute() {
            return { ok: false, summary: "model unavailable", blocker: "RESEARCH_WORKER_UNREACHABLE" };
          },
        },
      }),
    },
  });

  const result = await zbook.execute({ task, input: "run", requestedCapability: "local-model" });
  assert.equal(result.ok, false);
  assert.match(result.output, /RESEARCH_WORKER_UNREACHABLE/);
});

test("iPhone adapter defaults to foreground and preserves OS-managed execution evidence", async () => {
  const seen: unknown[] = [];
  const iphone = createIphoneWorkerAdapter({
    bridge: {
      capabilities: ["camera", "local-storage"],
      async execute(request) {
        seen.push(request);
        return { output: `ios:${request.capability}`, evidence: { nativeTask: "camera-capture" } };
      },
    },
  });

  const result = await iphone.execute({ task, input: "capture", requestedCapability: "camera" });
  assert.equal(result.ok, true);
  assert.equal(result.output, "ios:camera");
  assert.deepEqual(seen, [{ taskId: task.id, capability: "camera", mode: "foreground", input: "capture" }]);
  assert.deepEqual(result.evidence?.capabilityEvidence, {
    iosExecutionMode: "foreground",
    nativeTask: "camera-capture",
  });
});

test("iPhone adapter supports declared background/deferred modes and rejects resident semantics", async () => {
  const modes: string[] = [];
  const iphone = createIphoneWorkerAdapter({
    bridge: {
      capabilities: ["background-task"],
      async execute(request) {
        modes.push(request.mode);
        return { output: request.mode };
      },
    },
  });

  const background = await iphone.execute({
    task,
    input: "refresh",
    requestedCapability: "background-task",
    requiredExecutionMode: "background-scheduled",
  });
  const deferred = await iphone.execute({
    task,
    input: "later",
    requestedCapability: "background-task",
    requiredExecutionMode: "deferred",
  });
  const resident = await iphone.execute({
    task,
    input: "daemon",
    requestedCapability: "background-task",
    requiredExecutionMode: "resident",
  });

  assert.equal(background.ok, true);
  assert.equal(deferred.ok, true);
  assert.deepEqual(modes, ["background-scheduled", "deferred"]);
  assert.equal(resident.ok, false);
  assert.match(resident.output, /does not support resident daemon execution/);
});

test("iPhone bridge cannot claim undeclared device capabilities", () => {
  assert.throws(() => createIphoneWorkerAdapter({
    bridge: {
      capabilities: ["gpu"],
      async execute() {
        return { output: "no" };
      },
    },
  }), /unsupported capabilities: gpu/);
});
