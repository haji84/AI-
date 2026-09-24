import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideExperiment, PersistentResearchHistory, type ResearchExperiment, type ResearchHypothesis } from "../src/gai/research-loop.ts";

const input = () => ({ id: "experiment:one", hypothesisId: "hypothesis:planner", benchmarkBefore: 0.4, benchmarkAfter: 0.6, humanInterventionBefore: 0.1, humanInterventionAfter: 0.08, additionalApiCost: 0, safetyRegression: false });
const hypothesis = (): ResearchHypothesis => ({ id: "hypothesis:planner", bottleneck: "planner", statement: "Compare bounded local calibration", expectedGain: 0.03, evidenceCount: 3, status: "proposed" });
async function fixture(run: (store: PersistentResearchHistory, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "goriq-research-boundary-"));
  try { const path = join(root, "research.json"); await run(new PersistentResearchHistory(path), path); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("research decision rejects malformed scores, thresholds, intervention rates and cost", () => {
  for (const field of ["benchmarkBefore", "benchmarkAfter", "humanInterventionBefore", "humanInterventionAfter"] as const) {
    for (const value of [NaN, Infinity, -Infinity, -0.01, 1.01, "0.5", null]) assert.throws(() => decideExperiment({ ...input(), [field]: value } as unknown as Parameters<typeof decideExperiment>[0]), /invalid/i, `${field}:${value}`);
  }
  for (const value of [NaN, Infinity, -1, 0, 1.01, "0.1", null]) assert.throws(() => decideExperiment(input(), value as number), /invalid/i, `minimumGain:${value}`);
  for (const value of [NaN, Infinity, -1, "0", null]) assert.throws(() => decideExperiment({ ...input(), additionalApiCost: value } as unknown as Parameters<typeof decideExperiment>[0]), /invalid/i);
  for (const value of [0, 1, "false", null]) assert.throws(() => decideExperiment({ ...input(), safetyRegression: value } as unknown as Parameters<typeof decideExperiment>[0]), /invalid/i);
  for (const field of ["id", "hypothesisId"] as const) for (const value of ["", " padded ", "line\nID", "x".repeat(201), 123, null]) assert.throws(() => decideExperiment({ ...input(), [field]: value } as unknown as Parameters<typeof decideExperiment>[0]), /invalid/i);
});

test("legacy intervention values are rates, while bounded positive thresholds persist", () => {
  assert.equal(decideExperiment(input()).decision, "accepted");
  assert.equal(decideExperiment({ ...input(), humanInterventionAfter: 0.11 }).decision, "rejected");
  assert.equal(decideExperiment({ ...input(), additionalApiCost: 0.01 }).decision, "rejected");
  assert.equal(decideExperiment({ ...input(), safetyRegression: true }).decision, "rejected");
  const strict = decideExperiment(input(), 0.3);
  assert.equal(strict.decision, "rejected");
  assert.equal((strict as ResearchExperiment & { minimumGain?: number }).minimumGain, 0.3);
});

test("experiments require an existing hypothesis and independently recomputable policy decision", async () => fixture(async (store, path) => {
  const valid = decideExperiment(input());
  await assert.rejects(store.recordExperiment(valid), /hypothesis/i);
  await store.saveHypothesis(hypothesis());
  const before = await readFile(path, "utf8");
  await assert.rejects(store.recordExperiment({ ...decideExperiment({ ...input(), benchmarkAfter: 0.3 }), decision: "accepted" }), /decision|policy/i);
  await assert.rejects(store.recordExperiment({ ...valid, reason: "Trust caller supplied approval" }), /reason|policy/i);
  assert.equal(await readFile(path, "utf8"), before);
  await store.recordExperiment(valid);
  assert.equal((await store.listHypotheses())[0].status, "accepted");
}));

test("exact experiment replay is idempotent and conflicting same ID cannot replace history", async () => fixture(async (store, path) => {
  await store.saveHypothesis(hypothesis()); const valid = decideExperiment(input()); await store.recordExperiment(valid);
  const before = await readFile(path, "utf8");
  await store.recordExperiment(structuredClone(valid));
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(store.recordExperiment(decideExperiment({ ...input(), benchmarkAfter: 0.1 })), /conflict|replay/i);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal((await store.listExperiments()).length, 1);
}));

test("terminal hypothesis reproposal retains its original result and evidence snapshot", async () => fixture(async (store) => {
  await store.saveHypothesis(hypothesis()); await store.recordExperiment(decideExperiment(input()));
  const before = await store.listHypotheses();
  await store.saveHypothesis({ ...hypothesis(), evidenceCount: 5, expectedGain: 0.1 });
  assert.deepEqual(await store.listHypotheses(), before);
  await assert.rejects(store.saveHypothesis({ ...hypothesis(), statement: "Unrelated new hypothesis" }), /identity|conflict/i);
  await assert.rejects(store.saveHypothesis({ ...hypothesis(), bottleneck: "memory" }), /identity|conflict/i);
}));

test("unmeasured terminal hypotheses and malformed provenance cannot be introduced", async () => fixture(async (store) => {
  await assert.rejects(store.saveHypothesis({ ...hypothesis(), status: "accepted" }), /experiment|terminal/i);
  for (const evidenceCount of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(store.saveHypothesis({ ...hypothesis(), evidenceCount }), /invalid/i);
  for (const expectedGain of [NaN, Infinity, -0.1, 1.1]) await assert.rejects(store.saveHypothesis({ ...hypothesis(), expectedGain }), /invalid/i);
  assert.equal((await store.listHypotheses()).length, 0);
}));

test("research history owns cloned inputs and returns cloned records", async () => fixture(async (store) => {
  const proposed = hypothesis(); await store.saveHypothesis(proposed); proposed.statement = "Caller mutated";
  assert.equal((await store.listHypotheses())[0].statement, hypothesis().statement);
  const valid = decideExperiment(input()); await store.recordExperiment(valid); valid.decision = "rejected";
  const experiments = await store.listExperiments(), hypotheses = await store.listHypotheses();
  experiments[0].reason = "Changed output"; hypotheses[0].status = "proposed";
  assert.equal((await store.listExperiments())[0].decision, "accepted");
  assert.notEqual((await store.listExperiments())[0].reason, "Changed output");
  assert.equal((await store.listHypotheses())[0].status, "accepted");
}));

test("history reload accepts valid legacy threshold and rejects tampered decision, links and schema", async () => fixture(async (store, path) => {
  await store.saveHypothesis(hypothesis()); await store.recordExperiment(decideExperiment(input()));
  const original = JSON.parse(await readFile(path, "utf8"));
  delete original.experiments[0].minimumGain;
  await writeFile(path, JSON.stringify(original));
  assert.equal((await new PersistentResearchHistory(path).listExperiments())[0].decision, "accepted");
  for (const mutate of [
    (v: typeof original) => { v.experiments[0].decision = "rejected"; },
    (v: typeof original) => { v.experiments[0].reason = "Forged acceptance"; },
    (v: typeof original) => { v.experiments[0].benchmarkAfter = 1.5; },
    (v: typeof original) => { v.experiments[0].hypothesisId = "unknown"; },
    (v: typeof original) => { v.hypotheses[0].status = "proposed"; },
    (v: typeof original) => { v.hypotheses.push(structuredClone(v.hypotheses[0])); },
    (v: typeof original) => { v.version = 2; },
    (v: typeof original) => { v.permissions = "expanded"; },
  ]) {
    const changed = structuredClone(original); mutate(changed); await writeFile(path, JSON.stringify(changed));
    await assert.rejects(new PersistentResearchHistory(path).listExperiments(), /invalid|mismatch|duplicate|hypothesis|policy/i);
  }
}));

test("nondefault threshold survives restart and cannot be removed to change the decision", async () => fixture(async (store, path) => {
  await store.saveHypothesis(hypothesis()); await store.recordExperiment(decideExperiment(input(), 0.3));
  assert.equal((await new PersistentResearchHistory(path).listExperiments())[0].decision, "rejected");
  const saved = JSON.parse(await readFile(path, "utf8")); delete saved.experiments[0].minimumGain; await writeFile(path, JSON.stringify(saved));
  await assert.rejects(new PersistentResearchHistory(path).listExperiments(), /decision|reason|policy/i);
}));
