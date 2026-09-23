import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTrainingCandidateDataset, importHistoricalLearning, prepareCognitiveTrainingDataset, promoteGeneralizedKnowledge, type HistoricalLearningSource } from "../src/gai/cognitive-learning-data.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";

const partition = { tenantId: "home", principalId: "owner" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function source(id: string, overrides: Partial<HistoricalLearningSource> = {}): HistoricalLearningSource {
  const content = `Verified deterministic lesson ${id}: validate before save`;
  const sha256 = digest(content);
  return { id, kind: "ci", sourceRef: `github:run:${id}`, content, sha256, partition, scope: "owner", classification: "internal", familyId: `family-${id}`,
    verification: { issuer: "independent-ci-verifier", evidenceRefs: [`artifact:${id}`], artifactSha256: sha256, passed: true, independent: true }, ...overrides };
}

test("historical provenance imports only present facts; unverified claims cannot train", () => {
  const sources = importHistoricalLearning([source("verified"), source("unknown", { verification: undefined })], partition);
  assert.equal(sources[0].status, "VERIFIED_CANDIDATE");
  assert.equal(sources[1].status, "UNVERIFIED");
  const dataset = buildTrainingCandidateDataset(sources, partition);
  assert.equal(dataset.train.length + dataset.validation.length, 1);
  assert.equal(dataset.rejected[0].reason, "independent_verification_required");
  assert.equal(dataset.training.automaticTraining, false);
});

test("history rejects digest substitution, credential content, cross-user access", () => {
  assert.throws(() => importHistoricalLearning([source("bad", { sha256: "0".repeat(64) })], partition), /digest/);
  const content = "password=must-not-learn";
  assert.throws(() => importHistoricalLearning([source("bad", { content, sha256: digest(content) })], partition), /credential/);
  assert.throws(() => importHistoricalLearning([source("bad", { partition: { tenantId: "home", principalId: "tester" } })], partition), /partition/);
  assert.deepEqual(importHistoricalLearning([source("personal", { classification: "personal" }), source("secret", { classification: "secret" })], partition), []);
});

test("held-out family isolation precedes dedup and prevents renamed duplicate training leakage", () => {
  const a = source("one");
  const sources = importHistoricalLearning([a, { ...a, id: "renamed", familyId: "other-family", split: "heldout" }, source("same-family", { familyId: "family-one" })], partition);
  const dataset = buildTrainingCandidateDataset(sources, partition);
  assert.equal(dataset.train.length, 0);
  assert.equal(dataset.validation.length, 0);
  assert.equal(dataset.heldout.length, 2);
  assert.equal(dataset.rejected[0].reason, "duplicate");
});

test("evaluation split follows transitive family and content links before emitting any row", () => {
  const left = source("left", { familyId: "family-a" });
  const right = source("right", { familyId: "family-b" });
  const rows = [
    source("unique", { familyId: "family-a" }),
    left,
    { ...left, id: "left-copy", familyId: "family-b" },
    right,
    { ...right, id: "right-copy", familyId: "family-c", split: "heldout" as const },
  ];
  const permutations = <T>(items: T[]): T[][] => items.length === 0 ? [[]] : items.flatMap((item, index) =>
    permutations(items.filter((_, other) => index !== other)).map(rest => [item, ...rest]));
  for (const order of permutations(rows)) {
    const dataset = buildTrainingCandidateDataset(importHistoricalLearning(order, partition), partition);
    assert.equal(dataset.train.length, 0, order.map(row => row.id).join(","));
    assert.equal(dataset.validation.length, 0);
    assert.equal(dataset.heldout.length, 3);
    assert.equal(dataset.rejected.length, 2);
  }
});

test("renamed validation duplicates keep their complete family out of training", () => {
  const duplicate = source("duplicate", { familyId: "family-a" });
  const dataset = buildTrainingCandidateDataset(importHistoricalLearning([
    source("unique", { familyId: "family-a" }), duplicate,
    { ...duplicate, id: "validation-copy", familyId: "family-b", split: "validation" },
  ], partition), partition);
  assert.equal(dataset.train.length, 0);
  assert.equal(dataset.heldout.length, 0);
  assert.equal(dataset.validation.length, 2);
});

test("dataset splits are reproducible by family with no source-family overlap", () => {
  const sources = importHistoricalLearning(Array.from({ length: 40 }, (_, i) => source(`item-${i}`, { familyId: `family-${Math.floor(i / 2)}` })), partition);
  const a = buildTrainingCandidateDataset(sources, partition);
  const b = buildTrainingCandidateDataset(sources, partition);
  assert.equal(a.digest, b.digest);
  assert.ok(a.train.length > 0); assert.ok(a.validation.length > 0);
  const trainedFamilies = new Set(a.train.map((row) => row.familyId));
  assert.ok(a.validation.every((row) => !trainedFamilies.has(row.familyId)));
});

test("sharing requires independent privacy evidence and never copies private experience unchanged", () => {
  const candidate = importHistoricalLearning([source("one")], partition)[0];
  const review = { target: "organization" as const, generalizedContent: "Validate the output against schema before committing", privacyPassed: true, independent: true, evidenceRefs: ["privacy-review:one"] };
  assert.equal(promoteGeneralizedKnowledge(candidate, review).scope, "organization");
  assert.throws(() => promoteGeneralizedKnowledge(candidate, { ...review, generalizedContent: candidate.content }), /unchanged/);
  assert.throws(() => promoteGeneralizedKnowledge(candidate, { ...review, target: "global" }), /public/);
  assert.throws(() => promoteGeneralizedKnowledge(candidate, { ...review, independent: false }), /independent/);
  assert.throws(() => promoteGeneralizedKnowledge(candidate, { ...review, evidenceRefs: candidate.evidenceRefs }), /independent/);
});

test("live Core verified learning exports into the partitioned training candidate pipeline", async () => {
  const engine = new CognitiveLearningEngine(await mkdtemp(join(tmpdir(), "cognitive-data-integration-")));
  await engine.observe({ id: "episode", partition, goalId: "goal", task: "validate a local report", actionId: "validate", strategyId: "local-validation", environment: "windows:local",
    prediction: { expectedOutcome: "report passes", confidence: 0.8 }, observation: { summary: "independent report verification passed", success: true },
    verified: true, evidenceRefs: ["verifier:report"], source: "local-experiment", durationMs: 10, externalCalls: 0 });
  const dataset = await prepareCognitiveTrainingDataset(engine, partition, { scope: "owner" });
  assert.equal(dataset.train.length + dataset.validation.length, 1);
  assert.equal([...dataset.train, ...dataset.validation][0].sourceKind, "verified-experience");
  assert.equal([...dataset.train, ...dataset.validation][0].scope, "owner");
  const isolated = await prepareCognitiveTrainingDataset(engine, { tenantId: "home", principalId: "tester" });
  assert.equal(isolated.train.length + isolated.validation.length, 0);
});

test("failed held-out observations reserve their family without exporting failed examples", async () => {
  const engine = new CognitiveLearningEngine(await mkdtemp(join(tmpdir(), "cognitive-data-heldout-")));
  const success = { id: "train-success", partition, goalId: "goal-train", task: "normalize report headings", actionId: "normalize", strategyId: "local-normalize", environment: "windows:local",
    prediction: { expectedOutcome: "consistent headings", confidence: 0.8 }, observation: { summary: "headings checked", success: true },
    verified: true, evidenceRefs: ["verifier:train"], source: "local-experiment" as const, durationMs: 10, externalCalls: 0 };
  await engine.observe(success);
  await engine.observe({ ...success, id: "heldout-failure", goalId: "goal-heldout", split: "heldout", evidenceRefs: ["verifier:heldout"],
    observation: { summary: "private failed observation remains in the ledger", success: false } });
  await engine.recordCorrection({ id: "heldout-correction", partition, goalId: "goal-correction", task: success.task, environment: success.environment,
    originalActionId: "normalize", replacementActionId: "normalize-safe", evidenceRefs: ["verifier:correction"], verified: true, scope: "preference" });
  const dataset = await prepareCognitiveTrainingDataset(engine, partition);
  assert.equal(dataset.train.length, 0);
  assert.equal(dataset.validation.length, 0);
  assert.deepEqual(dataset.heldout.map(row => row.id).sort(), ["correction:heldout-correction", "train-success"]);
  assert.equal(JSON.stringify(dataset).includes("private failed observation"), false);
  assert.deepEqual((await engine.exportVerifiedData(partition)).experiences.map(row => row.id), ["train-success"]);
  const isolated = await prepareCognitiveTrainingDataset(engine, { ...partition, principalId: "tester" });
  assert.equal(isolated.train.length + isolated.validation.length + isolated.heldout.length, 0);
});
