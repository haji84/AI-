import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_ARTIFACT_SCHEMA,
  createPreflightArtifact,
  preflightBaseline,
  runRealBaseline,
  type BaselineRuntimeAdapter,
  type BaselineTask,
} from "../src/gai/research-baseline.ts";

const task: BaselineTask = {
  id: "unknown-1",
  description: "Solve a held-back unknown task",
  difficulty: 0.5,
  risk: "LOW",
};

function adapter(overrides: Partial<BaselineRuntimeAdapter> = {}): BaselineRuntimeAdapter {
  return {
    id: "fixture-runtime",
    provider: "local-fixture",
    modelTier: "local",
    additionalApiCost: 0,
    async isAvailable() {
      return true;
    },
    async execute() {
      return {
        passed: true,
        humanInterventionCount: 0,
        retryCount: 1,
        evidence: ["runtime actually executed the task"],
      };
    },
    ...overrides,
  };
}

test("preflight refuses to call CI-only execution a real baseline", async () => {
  const result = await preflightBaseline(null);
  assert.equal(result.canRunRealBaseline, false);
  assert.match(result.reason ?? "", /not a real baseline/i);

  const artifact = createPreflightArtifact({
    adapter: null,
    reason: result.reason ?? "missing runtime",
    resumeCommand: "pnpm gai:baseline -- --suite=suite.json --adapter=adapter.mjs",
    generatedAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(artifact.schema, BASELINE_ARTIFACT_SCHEMA);
  assert.equal(artifact.mode, "preflight");
  assert.equal(artifact.summary, null);
  assert.deepEqual(artifact.cases, []);
});

test("preflight refuses an unavailable runtime", async () => {
  const result = await preflightBaseline(adapter({ async isAvailable() { return false; } }));
  assert.equal(result.canRunRealBaseline, false);
  assert.match(result.reason ?? "", /unavailable/i);
});

test("real mode exists only after an available adapter executes every task", async () => {
  let executions = 0;
  const runtime = adapter({
    async execute() {
      executions += 1;
      return { passed: true, humanInterventionCount: 0, retryCount: 0, evidence: ["verified"] };
    },
  });

  const artifact = await runRealBaseline({
    tasks: [task, { ...task, id: "transfer-1", transferTask: true }],
    adapter: runtime,
    resumeCommand: "pnpm gai:baseline -- --suite=suite.json --adapter=adapter.mjs",
    generatedAt: "2026-09-10T00:00:00.000Z",
  });

  assert.equal(executions, 2);
  assert.equal(artifact.mode, "real");
  assert.equal(artifact.runtime.available, true);
  assert.equal(artifact.runtime.additionalApiCost, 0);
  assert.equal(artifact.summary?.total, 2);
  assert.equal(artifact.summary?.successRate, 1);
  assert.equal(artifact.summary?.transferSuccessRate, 1);
  assert.equal(artifact.cases.every((item) => item.provider === "local-fixture"), true);
});

test("real baseline refuses an empty suite rather than fabricating a score", async () => {
  await assert.rejects(
    runRealBaseline({
      tasks: [],
      adapter: adapter(),
      resumeCommand: "pnpm gai:baseline -- --suite=suite.json --adapter=adapter.mjs",
    }),
    /at least one task/i,
  );
});
