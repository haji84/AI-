import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SelfImprovementRuntime, type ImprovementAdapters, type ImprovementCandidate } from "../src/gai/self-improvement-runtime.ts";

const ok = (label: string) => async () => ({ ok: true, evidence: [label] });
function adapters(overrides: Partial<ImprovementAdapters> = {}): ImprovementAdapters {
  return { sandbox: ok("sandbox"), test: ok("tests"), regression: ok("regression"), deviceE2E: ok("real-device"), canary: ok("canary"), promote: ok("promoted"), rollback: ok("rollback"), ...overrides };
}
function candidate(overrides: Partial<ImprovementCandidate> = {}): ImprovementCandidate {
  return { id: "c1", surface: "planner", sourceEvidence: ["verified-outcome:1"], knownGoodVersion: "v1", candidateVersion: "v2", verified: true, measurableGain: 0.1, safetyRegression: false, humanInterventionDelta: -0.1, additionalApiCostUsd: 0, ...overrides };
}

async function path() { return join(await mkdtemp(join(tmpdir(), "gai-si-")), "ledger.json"); }

test("promotes only after the full governed pipeline", async () => {
  const runtime = new SelfImprovementRuntime(await path(), adapters());
  const record = await runtime.run(candidate());
  assert.equal(record.state, "promoted");
  assert.deepEqual(record.evidence, ["verified-outcome:1", "sandbox", "tests", "regression", "real-device", "canary", "promoted"]);
});

test("does not let CI stand in for missing real-device E2E", async () => {
  const runtime = new SelfImprovementRuntime(await path(), adapters({ deviceE2E: async () => ({ ok: false, evidence: ["ci-pass"], reason: "real_device_e2e_required" }) }));
  assert.equal((await runtime.run(candidate())).state, "awaiting-device-e2e");
});

test("rejects governance weakening and paid API cost before sandbox", async () => {
  let called = false;
  const runtime = new SelfImprovementRuntime(await path(), adapters({ sandbox: async () => { called = true; return { ok: true, evidence: [] }; } }));
  assert.equal((await runtime.run(candidate({ weakensHumanGate: true }))).state, "rejected");
  assert.equal((await runtime.run(candidate({ id: "c2", additionalApiCostUsd: 0.01 }))).state, "rejected");
  assert.equal(called, false);
});

test("canary regression rolls back to known-good", async () => {
  let rolledBack = false;
  const runtime = new SelfImprovementRuntime(await path(), adapters({ canary: async () => ({ ok: false, evidence: ["canary-regression"] }), rollback: async () => { rolledBack = true; return { ok: true, evidence: ["restored:v1"] }; } }));
  const record = await runtime.run(candidate());
  assert.equal(record.state, "rolled-back");
  assert.equal(rolledBack, true);
  assert.ok(record.evidence.includes("restored:v1"));
});

test("ledger survives restart", async () => {
  const file = await path();
  await new SelfImprovementRuntime(file, adapters()).run(candidate());
  const restarted = new SelfImprovementRuntime(file, adapters());
  assert.equal((await restarted.list())[0]?.state, "promoted");
  const raw = JSON.parse(await readFile(file, "utf8")) as { version: number };
  assert.equal(raw.version, 1);
});
