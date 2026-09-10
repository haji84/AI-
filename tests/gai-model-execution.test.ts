import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createFunctionAdapter, GovernedModelExecutor } from "../src/gai/model-execution.ts";
import { PersistentUsageLedger } from "../src/gai/usage-ledger.ts";
import type { TaskProfile } from "../src/gai/types.ts";

async function withExecutor(run: (executor: GovernedModelExecutor, ledger: PersistentUsageLedger, file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gai-model-exec-"));
  const file = join(dir, "usage.json");
  try {
    const ledger = new PersistentUsageLedger(file);
    const executor = new GovernedModelExecutor([
      createFunctionAdapter({ tier: "local", provider: "ollama-local", planIncluded: true, run: async (input) => `local:${input}` }),
      createFunctionAdapter({ tier: "sol", provider: "chatgpt-plan-sol", planIncluded: true, run: async (input) => `sol:${input}` }),
      createFunctionAdapter({ tier: "astra", provider: "chatgpt-plan-astra", planIncluded: true, run: async (input) => `astra:${input}` }),
    ], ledger);
    await run(executor, ledger, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return { id: "t1", description: "test", difficulty: 2, risk: "LOW", ...overrides };
}

test("routine tasks execute locally and ledger records zero additional API cost", async () => {
  await withExecutor(async (executor, ledger) => {
    const result = await executor.execute({ task: task(), input: "hello" });
    assert.equal(result.executedTier, "local");
    assert.equal(result.output, "local:hello");
    const summary = await ledger.summary();
    assert.equal(summary.local, 1);
    assert.equal(summary.additionalApiCost, 0);
  });
});

test("frontier routing requires explicit plan escalation", async () => {
  await withExecutor(async (executor) => {
    const result = await executor.execute({ task: task({ id: "frontier", difficulty: 10, requiresFrontierReasoning: true }), input: "research" });
    assert.equal(result.requestedTier, "astra");
    assert.equal(result.executedTier, "local");
  });
});

test("explicit frontier escalation uses Astra when plan capacity exists", async () => {
  await withExecutor(async (executor, ledger) => {
    const result = await executor.execute({ task: task({ id: "frontier", difficulty: 10, requiresFrontierReasoning: true }), input: "research", allowFrontierEscalation: true });
    assert.equal(result.executedTier, "astra");
    assert.equal((await ledger.list("frontier"))[0]?.planIncluded, true);
  });
});

test("unavailable Astra gracefully degrades to Sol and then local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-model-fallback-"));
  try {
    const ledger = new PersistentUsageLedger(join(dir, "usage.json"));
    const executor = new GovernedModelExecutor([
      createFunctionAdapter({ tier: "local", provider: "local", planIncluded: true, run: async () => "local" }),
      createFunctionAdapter({ tier: "sol", provider: "sol-plan", planIncluded: true, run: async () => "sol" }),
      createFunctionAdapter({ tier: "astra", provider: "astra-plan", planIncluded: true, available: () => false, run: async () => "astra" }),
    ], ledger);
    const result = await executor.execute({ task: task({ id: "fallback", difficulty: 10, requiresFrontierReasoning: true }), input: "x", allowFrontierEscalation: true });
    assert.equal(result.executedTier, "sol");
    assert.match(result.fallbackReason ?? "", /astra/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paid frontier adapters are skipped and can never enter the ledger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-model-paid-"));
  try {
    const ledger = new PersistentUsageLedger(join(dir, "usage.json"));
    const executor = new GovernedModelExecutor([
      createFunctionAdapter({ tier: "local", provider: "local", planIncluded: true, run: async () => "safe" }),
      createFunctionAdapter({ tier: "astra", provider: "paid-api", planIncluded: false, run: async () => "paid" }),
    ], ledger);
    const result = await executor.execute({ task: task({ id: "paid", difficulty: 10, requiresFrontierReasoning: true }), input: "x", allowFrontierEscalation: true });
    assert.equal(result.executedTier, "local");
    assert.equal(result.output, "safe");
    await assert.rejects(() => ledger.append({ id: "bad", taskId: "bad", requestedTier: "astra", executedTier: "astra", provider: "api", planIncluded: false, additionalApiCost: 1, success: true, durationMs: 1 }), /prohibited/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("usage ledger persists across restarts", async () => {
  await withExecutor(async (executor, _ledger, file) => {
    await executor.execute({ task: task({ id: "persist" }), input: "x" });
    const restarted = new PersistentUsageLedger(file);
    assert.equal((await restarted.list("persist")).length, 1);
    assert.equal((await restarted.summary()).additionalApiCost, 0);
  });
});
