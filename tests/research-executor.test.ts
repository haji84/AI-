import assert from "node:assert/strict";
import test from "node:test";

import {
  GeneralResearchExecutor,
  createCapabilityBackedHostedResearchRunner,
} from "../src/gai/research-executor.ts";
import type { CapabilityExecutor } from "../src/orchestrator/goal-loop.ts";

const hostedRoute = {
  requestId: "research:1",
  action: "run-hosted" as const,
  reason: "deterministic control-plane work does not require a workstation",
};

const workerRoute = {
  requestId: "research:2",
  action: "run-worker" as const,
  workerId: "worker-a",
  reason: "selected healthy worker worker-a",
};

test("hosted research executes through bounded downstream capability and preserves evidence sources", async () => {
  const downstream: CapabilityExecutor = {
    async execute(action, context) {
      assert.equal(action.capability, "context.inspect");
      assert.equal(context.length, 2);
      return {
        actionId: action.id,
        ok: true,
        summary: "bounded context inspected",
        evidence: { inspected: context.map((item) => item.source) },
      };
    },
  };
  const executor = new GeneralResearchExecutor({
    hosted: createCapabilityBackedHostedResearchRunner(downstream),
  });

  const result = await executor.execute({
    id: "research:1",
    query: "find the relevant repository evidence",
    kind: "evidence",
    route: hostedRoute,
    context: [
      { source: "repository.file:README.md", summary: "README evidence" },
      { source: "github.repository_state", summary: "repository state" },
      { source: "state.next_action", summary: "ignored control state" },
    ],
  });

  assert.equal(result.ok, true);
  assert.match(result.summary, /Hosted research completed/);
  const evidence = result.evidence as { sources: string[]; result: { inspected: string[] } };
  assert.deepEqual(evidence.sources, ["repository.file:README.md", "github.repository_state"]);
  assert.deepEqual(evidence.result.inspected, ["repository.file:README.md", "github.repository_state"]);
});

test("hosted research refuses to invent evidence when bounded context is empty", async () => {
  const downstream: CapabilityExecutor = {
    async execute() {
      throw new Error("must not run without evidence");
    },
  };
  const executor = new GeneralResearchExecutor({
    hosted: createCapabilityBackedHostedResearchRunner(downstream),
  });

  const result = await executor.execute({
    id: "research:empty",
    query: "unknown fact",
    kind: "local-safe",
    route: hostedRoute,
    context: [{ source: "state.next_action", summary: "nothing useful" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, "RESEARCH_EVIDENCE_UNAVAILABLE");
});

test("worker research returns an exact blocker until a worker runner is registered", async () => {
  const executor = new GeneralResearchExecutor({
    hosted: { async execute() { return { ok: true, summary: "unused" }; } },
  });

  const result = await executor.execute({
    id: "research:2",
    query: "run local model experiment",
    kind: "local-model",
    route: workerRoute,
    context: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, "RESEARCH_WORKER_RUNNER_UNAVAILABLE");
});

test("worker research uses the registered worker runner", async () => {
  const executor = new GeneralResearchExecutor({
    hosted: { async execute() { return { ok: true, summary: "unused" }; } },
    worker: {
      async execute(request, workerId) {
        assert.equal(workerId, "worker-a");
        assert.equal(request.kind, "local-model");
        return { ok: true, summary: "local research completed", evidence: { workerId } };
      },
    },
  });

  const result = await executor.execute({
    id: "research:2",
    query: "run local model experiment",
    kind: "local-model",
    route: workerRoute,
    context: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary, "local research completed");
});
