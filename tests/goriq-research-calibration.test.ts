import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CognitiveLearningEngine, type CognitiveLearningExperience } from "../src/gai/cognitive-learning.ts";
import { evaluateCognitiveResearch } from "../src/gai/cognitive-research.ts";
import { PersistentResearchHistory } from "../src/gai/research-loop.ts";
const partition = { tenantId: "research", principalId: "owner" };
const query = { partition, goalId: "current", task: "Preserve text", environment: "local" };
const operation = "material:v1:copy:text" as const;
const sample = (i: number, extra: Partial<CognitiveLearningExperience> = {}): CognitiveLearningExperience => ({
  id: `experience-${i}`, partition, goalId: `goal-${i}`, task: query.task, environment: query.environment,
  actionId: `action-${i}`, strategyId: `strategy-${i}`, learningOperation: operation,
  prediction: { expectedOutcome: "The output is preserved", confidence: 0.1 }, observation: { summary: "Verified source and output", success: true },
  verified: true, evidenceRefs: [`verification-${i}`], source: "local-experiment", externalCalls: 0, durationMs: 1,
  split: i < 4 ? "train" : "heldout", ...extra,
});
const samples = () => Array.from({ length: 8 }, (_, i) => sample(i));

test("fixed train calibration measures independent heldout predictions with actual deterministic Brier scores", () => {
  const [result] = evaluateCognitiveResearch(samples(), query);
  assert.equal(result.status, "ACCEPTED"); assert.equal(result.trainCount, 4); assert.equal(result.evaluationCount, 4);
  assert.ok(Math.abs(result.baselineBrier! - 0.81) < 1e-10);
  assert.ok(Math.abs(result.candidateBrier! - 1 / 36) < 1e-10);
  assert.equal(result.confidence, 5 / 6); assert.equal(result.experimentInput?.additionalApiCost, 0);
  assert.deepEqual(evaluateCognitiveResearch(samples(), query), [result]);
});
test("equal or worse heldout calibration is rejected rather than promoted", () => {
  const exact = samples().map(e => ({ ...e, prediction: { ...e.prediction, confidence: 1 } }));
  assert.equal(evaluateCognitiveResearch(exact, query)[0].status, "REJECTED");
  const tied = samples().map(e => ({ ...e, prediction: { ...e.prediction, confidence: 5 / 6 } }));
  assert.equal(evaluateCognitiveResearch(tied, query)[0].status, "REJECTED");
});
test("normal train data cannot become heldout; late train does not tune the frozen candidate", () => {
  assert.equal(evaluateCognitiveResearch(samples().map(e => ({ ...e, split: "train" })), query)[0].status, "INSUFFICIENT_EVIDENCE");
  const data = samples(); data.push(sample(8, { split: "train", observation: { summary: "Later verified failure", success: false } }));
  assert.deepEqual(evaluateCognitiveResearch(data, query), evaluateCognitiveResearch(samples(), query));
  assert.equal(evaluateCognitiveResearch([sample(4), ...samples().slice(0, 4), ...samples().slice(5)], query)[0].status, "INSUFFICIENT_EVIDENCE");
});
test("Goal/evidence reuse and malformed measurements cannot authorize a research decision", () => {
  for (const change of [{ goalId: "goal-0" }, { evidenceRefs: ["verification-0"] }, { id: "experience-0" }]) {
    const data = samples(); data[4] = { ...data[4], ...change };
    assert.equal(evaluateCognitiveResearch(data, query)[0].status, "INVALID_EVIDENCE");
  }
  const data = samples(); data[4].prediction.confidence = NaN;
  assert.throws(() => evaluateCognitiveResearch(data, query), /confidence|measurement/);
});
test("scope, verification, external use and current Goal exclusions preserve evidence independence", () => {
  const changes: Partial<CognitiveLearningExperience>[] = [
    { verified: false }, { environment: "other" }, { task: "other" }, { goalId: query.goalId },
    { partition: { ...partition, principalId: "tester" } }, { externalCalls: 1 }, { source: "external-expert" },
  ];
  for (const change of changes) {
    const data = samples(); data[4] = { ...data[4], ...change };
    assert.equal(evaluateCognitiveResearch(data, query)[0].status, "INSUFFICIENT_EVIDENCE", JSON.stringify(change));
  }
});
test("later independent heldout regression replaces acceptance with rejection without training reuse", () => {
  const data = samples();
  for (let i = 8; i < 24; i++) data.push(sample(i, { prediction: { expectedOutcome: "Observe outcome", confidence: 0 }, observation: { summary: "Observed verified failure", success: false } }));
  const [report] = evaluateCognitiveResearch(data, query);
  assert.equal(report.status, "REJECTED"); assert.equal(report.confidence, 5 / 6); assert.equal(report.evaluationCount, 20);
});
test("actual partitioned recall persists R16 comparison once and retains heldout memory isolation across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goriq-research-")); const engine = new CognitiveLearningEngine(directory);
  for (const e of samples()) await engine.observe(e);
  const recalled = await engine.recall(query);
  assert.equal(recalled.research?.[0].status, "ACCEPTED");
  const path = engine.partitionPath(partition, "research.json"); const history = new PersistentResearchHistory(path);
  assert.equal((await history.listExperiments()).length, 1);
  assert.ok(recalled.memories.every(m => !/experience-[4-7]/.test(m.id)));
  assert.ok((await engine.candidates(partition)).every(c => c.status === "candidate"));
  const restored = new CognitiveLearningEngine(directory); await restored.recall(query);
  assert.equal((await new PersistentResearchHistory(path).listExperiments()).length, 1);
  assert.equal((await restored.recall({ ...query, partition: { ...partition, principalId: "tester" } })).research?.length, 0);
});

test("heldout identities never reuse any private training record, even outside frozen fit or operation", () => {
  for (const extra of [sample(9, { split: "train", goalId: "goal-4" }), sample(9, { split: "train", evidenceRefs: ["verification-4"] }), sample(9, { split: "train", goalId: "goal-4", task: "Different private task", learningOperation: "material:v1:create:docx" })]) {
    const data = [...samples().slice(0, 4), extra, ...samples().slice(4)];
    assert.equal(evaluateCognitiveResearch(data, query)[0].status, "INVALID_EVIDENCE");
  }
});
test("partition property order does not create a different experiment; unknown split is not training", () => {
  assert.deepEqual(evaluateCognitiveResearch(samples(), { ...query, partition: { principalId: partition.principalId, tenantId: partition.tenantId } }), evaluateCognitiveResearch(samples(), query));
  const data = samples(); data[0].split = "invalid" as "train";
  assert.throws(() => evaluateCognitiveResearch(data, query), /split|measurement/);
});
