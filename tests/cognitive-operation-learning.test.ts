import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CognitiveLearningEngine, type CognitiveLearningExperience } from "../src/gai/cognitive-learning.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import type { CognitiveOperation } from "../src/gai/cognitive-operation.ts";

const partition = { tenantId: "operation", principalId: "owner" };
const operation = "material:v1:copy:text" as const;
const query = { partition, goalId: "next-goal", task: "Preserve supplied text", environment: "windows:local" };
const observation = (id: string, changes: Partial<CognitiveLearningExperience> = {}): CognitiveLearningExperience => ({
  id, partition, goalId: `goal-${id}`, task: query.task, environment: query.environment,
  actionId: `outcome:${id}`, strategyId: `strategy:${id}`, learningOperation: operation,
  prediction: { expectedOutcome: "The file preserves the supplied text", confidence: 0.8 },
  observation: { summary: "Source and artifact bytes independently match", success: true },
  verified: true, evidenceRefs: [`verifier:${id}`], source: "local-experiment", durationMs: 10, externalCalls: 0, ...changes,
});
async function engine() { return new CognitiveLearningEngine(await mkdtemp(join(tmpdir(), "cognitive-operation-"))); }
async function pair(learner: CognitiveLearningEngine) { await learner.observe(observation("one")); await learner.observe(observation("two")); return (await learner.candidates(partition))[0]; }
async function certify(learner: CognitiveLearningEngine, skillId: string) {
  return learner.certify({ partition, skillId, evidenceRefs: ["independent:test-fixture"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true });
}

test("independent Goal successes with different exact actions synthesize one operation candidate only", async () => {
  const learner = await engine();
  await learner.observe(observation("one"));
  assert.equal((await learner.candidates(partition)).length, 0);
  await learner.observe(observation("two"));
  const [candidate] = await learner.candidates(partition);
  assert.ok(candidate, "operation identity must permit cross-Goal synthesis");
  assert.equal(candidate.operation, operation);
  assert.equal(candidate.status, "candidate");
  assert.deepEqual(candidate.sourceExperiences, ["one", "two"]);
  assert.deepEqual(JSON.parse(candidate.executionProcedure), { catalogOperation: operation, environment: query.environment });
  assert.deepEqual(candidate.inputSchema.required, ["catalogOperation", "environment"]);
  assert.equal((await learner.recall(query)).skills.length, 0);
  const saved = JSON.parse(await readFile(learner.partitionPath(partition, "experience.json"), "utf8"));
  assert.deepEqual(saved.experiences.map((e: CognitiveLearningExperience) => [e.actionId, e.strategyId]), [["outcome:one", "strategy:one"], ["outcome:two", "strategy:two"]]);
  assert.equal((await new CognitiveLearningEngine(learner.directory).candidates(partition))[0].operation, operation);
});

test("operation synthesis requires independent verified training in the same task and environment", async () => {
  const invalidPartners: Array<Partial<CognitiveLearningExperience>> = [
    { goalId: "goal-one" }, { evidenceRefs: ["verifier:one"] }, { verified: false }, { split: "heldout" },
    { environment: "linux:other" }, { task: "Unrelated aquarium" }, { observation: { summary: "Observed failure", success: false } },
    { learningOperation: "material:v1:inspect:text" }, { learningOperation: undefined },
  ];
  for (const changes of invalidPartners) {
    const learner = await engine();
    await learner.observe(observation("one")); await learner.observe(observation("two", changes));
    assert.equal((await learner.candidates(partition)).length, 0, JSON.stringify(changes));
  }
});

test("legacy exact-action candidates remain compatible and do not mix with operation candidates", async () => {
  const learner = await engine();
  const legacy = { learningOperation: undefined, actionId: "legacy-action", strategyId: "legacy-strategy" };
  await learner.observe(observation("legacy-one", legacy));
  await learner.observe(observation("operation-one", { actionId: "legacy-action", strategyId: "legacy-strategy" }));
  assert.equal((await learner.candidates(partition)).length, 0);
  await learner.observe(observation("legacy-two", legacy)); await learner.observe(observation("operation-two"));
  const candidates = await new CognitiveLearningEngine(learner.directory).candidates(partition);
  assert.equal(candidates.length, 2);
  const old = candidates.find(c => !c.operation)!;
  assert.deepEqual(JSON.parse(old.executionProcedure), { catalogActionId: "legacy-action", environment: query.environment });
  assert.deepEqual(old.inputSchema.required, ["catalogActionId", "environment"]);
  assert.deepEqual(old.sourceExperiences, ["legacy-one", "legacy-two"]);
  assert.deepEqual(candidates.find(c => c.operation)?.sourceExperiences, ["operation-one", "operation-two"]);
});

test("operation recall retains existing independent gain gate and partition boundaries", async () => {
  const learner = await engine(); const candidate = await pair(learner);
  await assert.rejects(learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["verifier:one"], baselinePassRate: 0, candidatePassRate: 1, safetyPassed: true, independent: true }), /independent/);
  assert.equal((await learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["independent:equal"], baselinePassRate: 1, candidatePassRate: 1, safetyPassed: true, independent: true })).accepted, false);
  assert.equal((await learner.recall(query)).skills.length, 0);
  assert.equal((await certify(learner, candidate.id)).accepted, true);
  const [skill] = (await new CognitiveLearningEngine(learner.directory).recall(query)).skills;
  assert.equal(skill.operation, operation); assert.equal(skill.environment, query.environment); assert.equal(skill.maxRisk, "low");
  assert.equal(skill.actionId.includes("outcome:one"), false);
  assert.equal((await learner.recall({ ...query, environment: "linux:other" })).skills.length, 0);
  assert.equal((await learner.recall({ ...query, partition: { ...partition, principalId: "tester" } })).skills.length, 0);
});

test("verified operation regression quarantines across new action IDs but keeps failure avoidance exact", async () => {
  const learner = await engine(); const candidate = await pair(learner); await certify(learner, candidate.id);
  await learner.observe(observation("regression", { split: "heldout", observation: { summary: "Independent artifact check failed", success: false } }));
  assert.equal((await learner.candidates(partition))[0].status, "quarantined");
  assert.equal((await new PersistentSkillLibrary(learner.partitionPath(partition, "skills.json")).get(candidate.id))?.status, "quarantined");
  assert.equal((await learner.recall(query)).skills.length, 0);
  assert.equal((await learner.recall(query)).avoidActionIds.includes(operation), false);
  await learner.observe(observation("later-success"));
  assert.equal((await new CognitiveLearningEngine(learner.directory).candidates(partition))[0].status, "quarantined");
});

test("unverified or unrelated failure does not quarantine operation skills", async () => {
  const learner = await engine(); const candidate = await pair(learner); await certify(learner, candidate.id);
  for (const [index, changes] of [
    { verified: false }, { learningOperation: "material:v1:inspect:text" as const },
    { environment: "linux:other" }, { task: "Unrelated aquarium" }, { learningOperation: undefined },
  ].entries()) await learner.observe(observation(`different-${index}`, { observation: { summary: "Failure outside this verified family", success: false }, ...changes }));
  assert.equal((await learner.candidates(partition))[0].status, "active");
  const recalled = await learner.recall(query);
  assert.equal(recalled.skills[0].operation, operation);
  assert.ok(recalled.avoidActionIds.every(id => id.startsWith("outcome:")));
});

test("correction keeps exact action scope without suppressing a changed-source operation", async () => {
  const learner = await engine(); const candidate = await pair(learner); await certify(learner, candidate.id);
  await learner.recordCorrection({ id: "correction", ...query, originalActionId: "outcome:one", replacementActionId: "outcome:two", evidenceRefs: ["verifier:two"], verified: true, scope: "preference" });
  const recalled = await learner.recall(query);
  assert.deepEqual(recalled.avoidActionIds, ["outcome:one"]);
  assert.equal(recalled.corrections[0].replacementActionId, "outcome:two");
  assert.equal(recalled.skills[0].operation, operation);
});

test("unknown operation revisions, coercions and authority fields fail before learning persistence", async () => {
  const learner = await engine();
  for (const value of ["material:v2:copy:text", "material:v1:copy:text ", "exec:shell", null, 42, { catalogOperation: operation }]) {
    await assert.rejects(learner.observe(observation("bad", { learningOperation: value as CognitiveOperation })), /operation/i);
  }
  assert.equal((await learner.metrics(partition)).goals, 0);
  const { validateCognitiveOperation } = await import("../src/gai/cognitive-operation.ts");
  for (const allowed of ["material:v1:inspect:text", "material:v1:inspect:workbook-json", "material:v1:inspect:document-json", "material:v1:copy:text", "material:v1:create:xlsx", "material:v1:create:docx"]) assert.equal(validateCognitiveOperation(allowed), allowed);
  assert.throws(() => validateCognitiveOperation(new String(operation)), /operation/i);
});

test("stored operation procedure, input schema and provenance must agree", async () => {
  for (const mutate of [
    (c: Record<string, unknown>) => { c.executionProcedure = JSON.stringify({ catalogOperation: operation, catalogActionId: "injected", environment: query.environment }); },
    (c: Record<string, unknown>) => { c.executionProcedure = JSON.stringify({ catalogOperation: "material:v2:copy:text", environment: query.environment }); },
    (c: Record<string, unknown>) => { c.inputSchema = { type: "object", required: ["catalogActionId", "environment"] }; },
    (c: Record<string, unknown>) => { c.operation = "material:v1:create:xlsx"; },
    (c: Record<string, unknown>) => { delete c.operation; },
    (c: Record<string, unknown>) => { c.executionProcedure = JSON.stringify({ catalogOperation: operation, environment: "linux:other" }); },
  ]) {
    const learner = await engine(); await pair(learner);
    const path = learner.partitionPath(partition, "experience.json"), saved = JSON.parse(await readFile(path, "utf8"));
    mutate(saved.candidates[0]); await writeFile(path, JSON.stringify(saved));
    await assert.rejects(new CognitiveLearningEngine(learner.directory).candidates(partition), /binding|operation|schema|provenance/i);
  }
});
