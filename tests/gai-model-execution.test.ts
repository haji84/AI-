import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileUsageLedger, GovernedModelExecutor, type ModelExecutionAdapter } from "../src/gai/model-execution.ts";
import type { ModelTier, TaskProfile } from "../src/gai/types.ts";

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return { id: "task-1", description: "test", difficulty: 3, risk: "LOW", ...overrides };
}

function adapter(tier: ModelTier, output: string, options: { planIncluded?: boolean; fail?: boolean } = {}): ModelExecutionAdapter {
  return {
    tier,
    provider: `${tier}-provider`,
    planIncluded: options.planIncluded ?? tier === "local",
    async execute() {
      if (options.fail) throw new Error(`${tier} unavailable`);
      return output;
    },
  };
}

async function ledgerPath() {
  const dir = await mkdtemp(join(tmpdir(), "gai-model-ledger-"));
  return join(dir, "usage.json");
}

test("routine work stays local and records provenance", async () => {
  const path = await ledgerPath();
  const executor = new GovernedModelExecutor([adapter("local", "ok")], new FileUsageLedger(path));
  const result = await executor.execute({ task: task(), prompt: "hello" });
  assert.equal(result.tier, "local");
  assert.equal(result.incrementalApiCost, 0);
  const records = JSON.parse(await readFile(path, "utf8"));
  assert.equal(records[0].taskId, "task-1");
  assert.equal(records[0].provider, "local-provider");
  assert.equal(records[0].incrementalApiCost, 0);
});

test("Sol/Astra execute only when explicitly plan-included", async () => {
  const path = await ledgerPath();
  const executor = new GovernedModelExecutor([
    adapter("local", "local"),
    adapter("sol", "sol", { planIncluded: true }),
    adapter("astra", "astra", { planIncluded: true }),
  ], new FileUsageLedger(path));

  const sol = await executor.execute({ task: task({ difficulty: 7 }), prompt: "hard", planIncludedTiers: ["sol"] });
  assert.equal(sol.tier, "sol");
  const astra = await executor.execute({ task: task({ id: "task-2", difficulty: 10 }), prompt: "frontier", planIncludedTiers: ["astra"] });
  assert.equal(astra.tier, "astra");
});

test("missing premium capacity degrades through zero-cost route without paid fallback", async () => {
  const path = await ledgerPath();
  const executor = new GovernedModelExecutor([
    adapter("astra", "unused", { planIncluded: true, fail: true }),
    adapter("sol", "unused", { planIncluded: true, fail: true }),
    adapter("local", "local-fallback"),
  ], new FileUsageLedger(path));

  const result = await executor.execute({
    task: task({ difficulty: 10, requiresFrontierReasoning: true }),
    prompt: "frontier",
    planIncludedTiers: ["astra", "sol"],
  });
  assert.equal(result.tier, "local");
  const records = await new FileUsageLedger(path).list();
  assert.deepEqual(records.map((record) => record.success), [false, false, true]);
  assert.ok(records.every((record) => record.incrementalApiCost === 0));
});

test("premium adapter marked pay-as-you-go cannot be used", async () => {
  const path = await ledgerPath();
  let called = false;
  const paidLike: ModelExecutionAdapter = {
    tier: "sol",
    provider: "metered-provider",
    planIncluded: false,
    async execute() { called = true; return "no"; },
  };
  const executor = new GovernedModelExecutor([paidLike], new FileUsageLedger(path));
  await assert.rejects(
    executor.execute({ task: task({ difficulty: 7 }), prompt: "hard", planIncludedTiers: ["sol"] }),
    /without incremental API cost/,
  );
  assert.equal(called, false);
});
