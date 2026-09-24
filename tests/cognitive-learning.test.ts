import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CognitiveLearningEngine, type CognitiveLearningExperience } from "../src/gai/cognitive-learning.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import type { ImprovementCandidate } from "../src/gai/self-improvement-runtime.ts";

const partition = { tenantId: "home", principalId: "owner" };
const experience = (id: string, overrides: Partial<CognitiveLearningExperience> = {}): CognitiveLearningExperience => ({
  id, partition, goalId: `goal-${id}`, task: "normalize report headings", actionId: "normalize", strategyId: "local-normalize",
  environment: "windows:local", prediction: { expectedOutcome: "consistent headings", confidence: 0.8 },
  observation: { summary: "headings checked", success: true }, verified: true, evidenceRefs: [`verifier:${id}`],
  source: "local-experiment", durationMs: 12, externalCalls: 0, ...overrides,
});
const query = { partition, goalId: "next", task: "normalize report headings", environment: "windows:local" };
async function engine() { return new CognitiveLearningEngine(await mkdtemp(join(tmpdir(), "cognitive-learning-"))); }

test("verified experience survives restart, recall remains partitioned and relevant", async () => {
  const learner = await engine();
  await learner.observe(experience("one"));
  assert.ok((await learner.recall(query)).memories.length > 0);
  assert.equal((await learner.recall({ ...query, partition: { ...partition, principalId: "tester" } })).memories.length, 0);
  assert.equal((await learner.recall({ ...query, task: "unrelated aquarium" })).memories.length, 0);
  const restarted = new CognitiveLearningEngine(learner.directory);
  assert.ok((await restarted.recall(query)).memories.length > 0);
});

test("single success and replay do not synthesize a skill; independent successes create candidate only", async () => {
  const learner = await engine();
  await learner.observe(experience("one"));
  await learner.observe(experience("one"));
  assert.equal((await learner.candidates(partition)).length, 0);
  await learner.observe(experience("two"));
  const candidates = await learner.candidates(partition);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "candidate");
  assert.equal(candidates[0].sourceExperiences.length, 2);
});

test("verified failures are recalled only for matching task/environment and never synthesize skill", async () => {
  const learner = await engine();
  await learner.observe(experience("failure", { observation: { summary: "format rejected", success: false } }));
  assert.deepEqual((await learner.recall(query)).avoidActionIds, ["normalize"]);
  assert.deepEqual((await learner.recall({ ...query, environment: "linux:remote" })).avoidActionIds, []);
  assert.equal((await learner.candidates(partition)).length, 0);
});

test("unverified expert suggestion never enters knowledge or reusable strategy", async () => {
  const learner = await engine();
  await learner.observe(experience("expert", { source: "external-expert", verified: false, externalCalls: 1 }));
  assert.equal((await learner.recall(query)).memories.length, 0);
  assert.equal((await learner.recall(query)).strategies.length, 0);
  assert.equal((await learner.metrics(partition)).externalAiCallsPerGoal, 1);
});

test("held-out observations contribute metrics but never recall or candidates", async () => {
  const learner = await engine();
  await learner.observe(experience("heldout", { split: "heldout" }));
  assert.equal((await learner.recall(query)).memories.length, 0);
  assert.equal((await learner.candidates(partition)).length, 0);
});

test("explicit verified correction supersedes old action only in its own partition/context", async () => {
  const learner = await engine();
  await learner.recordCorrection({ id: "correction", ...query, originalActionId: "normalize", replacementActionId: "normalize-safe", evidenceRefs: ["replay:corrected"], verified: true, scope: "preference" });
  const recalled = await learner.recall(query);
  assert.equal(recalled.corrections[0].replacementActionId, "normalize-safe");
  assert.ok(recalled.avoidActionIds.includes("normalize"));
  assert.equal((await learner.recall({ ...query, partition: { ...partition, principalId: "tester" } })).corrections.length, 0);
  await assert.rejects(learner.recordCorrection({ id: "bad", ...query, originalActionId: "a", replacementActionId: "b", evidenceRefs: ["model:claim"], verified: false, scope: "general" }), /verified/);
});

test("secret and personal data fail before persistence; partition paths cannot traverse", async () => {
  const learner = await engine();
  await assert.rejects(learner.observe(experience("secret", { task: "password=do-not-save" })), /private|credential/);
  await assert.rejects(learner.observe(experience("person", { task: "contact tester@example.invalid" })), /private|personal/);
  await assert.rejects(learner.recall({ ...query, partition: { tenantId: "../escape", principalId: "owner" } }), /partition/);
  assert.equal((await learner.metrics(partition)).goals, 0);
});

test("concurrent observations serialize without losing experiences and replay conflict fails", async () => {
  const learner = await engine();
  await Promise.all([learner.observe(experience("one")), learner.observe(experience("two"))]);
  assert.equal((await learner.metrics(partition)).goals, 2);
  await assert.rejects(learner.observe(experience("one", { actionId: "different" })), /conflict/);
});

test("candidate activation requires independent benchmark gain; source experience cannot be its own test", async () => {
  const learner = await engine();
  await learner.observe(experience("one")); await learner.observe(experience("two"));
  const candidate = (await learner.candidates(partition))[0];
  await assert.rejects(learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["verifier:one"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true }), /independent/);
  assert.equal((await learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["heldout:independent"], baselinePassRate: 0.5, candidatePassRate: 0.5, safetyPassed: true, independent: true })).accepted, false);
  assert.equal((await learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["heldout:independent"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true })).accepted, true);
  assert.equal((await learner.candidates(partition))[0].status, "active");
});

test("independence metrics count completed goals, avoid fabricated comparisons and persist metadata only", async () => {
  const learner = await engine();
  await learner.observe(experience("local", { unknownTask: true, goalCompleted: true }));
  await learner.observe(experience("expert", { source: "external-expert", externalCalls: 1, goalCompleted: true }));
  const metrics = await learner.metrics(partition);
  assert.equal(metrics.externalAiFreeCompletionRate, 0.5);
  assert.equal(metrics.externalAiCallsPerGoal, 0.5);
  assert.equal(metrics.unknownTaskLocalSuccessRate, 1);
  assert.equal(metrics.memoryAssistedImprovement, null);
  const raw = await readFile(learner.partitionPath(partition, "experience.json"), "utf8");
  assert.ok(raw.includes("verifier:local"));
});

test("interrupted certification cannot hide an intervening verified regression", async () => {
  for (const interruptRegression of [false, true]) {
    const learner = await engine();
    await learner.observe(experience("one")); await learner.observe(experience("two"));
    const candidate = (await learner.candidates(partition))[0];
    const certification = { partition, skillId: candidate.id, evidenceRefs: ["heldout:independent"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true };
    const failSave = async () => { throw Error("injected final ledger save failure"); };
    (learner as unknown as { save(): Promise<void> }).save = failSave;
    await assert.rejects(learner.certify(certification), /injected/);
    const observer = new CognitiveLearningEngine(learner.directory);
    if (interruptRegression) (observer as unknown as { save(): Promise<void> }).save = failSave;
    const regression = observer.observe(experience("regression", { split: "heldout", observation: { summary: "independent regression", success: false } }));
    if (interruptRegression) await assert.rejects(regression, /injected/); else await regression;
    const restarted = new CognitiveLearningEngine(learner.directory);
    await assert.rejects(restarted.certify(certification), /quarantined|non-candidate/);
    await restarted.observe(experience("later-success"));
    assert.equal((await restarted.candidates(partition))[0].status, "quarantined");
    const skill = await new PersistentSkillLibrary(learner.partitionPath(partition, "skills.json")).get(candidate.id);
    assert.equal(skill?.status, "quarantined");
    assert.ok(skill?.certificationEvidence?.includes("verified-regression:regression"));
    assert.equal((await restarted.recall(query)).skills.length, 0);
  }
});

test("interrupted certification accepts an exact replay but rejects changed evidence", async () => {
  const learner = await engine();
  await learner.observe(experience("one")); await learner.observe(experience("two"));
  const candidate = (await learner.candidates(partition))[0];
  const certification = { partition, skillId: candidate.id, evidenceRefs: ["heldout:independent"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true };
  (learner as unknown as { save(): Promise<void> }).save = async () => { throw Error("injected final ledger save failure"); };
  await assert.rejects(learner.certify(certification), /injected/);
  const restarted = new CognitiveLearningEngine(learner.directory);
  await assert.rejects(restarted.certify({ ...certification, evidenceRefs: ["heldout:different"] }), /replay conflict/);
  assert.equal((await restarted.certify(certification)).accepted, true);
  assert.equal((await restarted.recall(query)).skills.length, 1);
});

test("strict persisted validation rejects injected fields and malformed nested objects", async () => {
  const learner = await engine();
  await assert.rejects(learner.observe({ ...experience("malicious"), password: "hidden" } as CognitiveLearningExperience), /fields/);
  await assert.rejects(learner.observe({ ...experience("malicious"), prediction: { expectedOutcome: "good", confidence: 0.8, token: "hidden" } } as CognitiveLearningExperience), /fields/);
  await learner.observe(experience("one"));
  const path = learner.partitionPath(partition, "experience.json");
  const data = JSON.parse(await readFile(path, "utf8"));
  data.experiences[0].observation.summary = "password=private-value";
  await writeFile(path, JSON.stringify(data));
  await assert.rejects(new CognitiveLearningEngine(learner.directory).recall(query), /private credential/);
});

test("different processes serialize partition writes without losing verified evidence", async () => {
  const learner = await engine();
  const moduleUrl = new URL("../src/gai/cognitive-learning.ts", import.meta.url).href;
  const program = `import { CognitiveLearningEngine } from ${JSON.stringify(moduleUrl)}; await new CognitiveLearningEngine(process.argv[1]).observe(JSON.parse(process.argv[2]));`;
  const child = (id: string) => new Promise<void>((resolve, reject) => {
    const processChild = spawn(process.execPath, ["--input-type=module", "-e", program, learner.directory, JSON.stringify(experience(id))], { stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; processChild.stderr.on("data", (chunk) => { error += chunk; });
    processChild.once("error", reject); processChild.once("exit", (code) => code === 0 ? resolve() : reject(Error(error)));
  });
  await Promise.all([child("first"), child("second"), child("third")]);
  assert.equal((await new CognitiveLearningEngine(learner.directory).metrics(partition)).goals, 3);
});

test("same execution with another ID is not an independent skill experience", async () => {
  const learner = await engine();
  await learner.observe(experience("one"));
  await learner.observe(experience("two", { goalId: "goal-one" }));
  await learner.observe(experience("three", { evidenceRefs: ["verifier:one"] }));
  assert.equal((await learner.candidates(partition)).length, 0);
});

test("learning outbox replay does not double-count skill outcomes after final ledger save fails", async () => {
  for (const success of [true, false]) {
    const learner = await engine();
    await learner.observe(experience("one")); await learner.observe(experience("two"));
    const candidate = (await learner.candidates(partition))[0];
    await learner.certify({ partition, skillId: candidate.id, evidenceRefs: ["heldout:independent"], baselinePassRate: 0.5, candidatePassRate: 0.8, safetyPassed: true, independent: true });
    const next = experience("three", { observation: { summary: "independent outcome", success } });
    (learner as unknown as { save(): Promise<void> }).save = async () => { throw Error("injected final ledger save failure"); };
    await assert.rejects(learner.observe(next), /injected/);
    const readSkill = () => new PersistentSkillLibrary(learner.partitionPath(partition, "skills.json")).get(candidate.id);
    const interrupted = (await readSkill())!;
    await new CognitiveLearningEngine(learner.directory).observe(next);
    const replayed = (await readSkill())!;
    assert.equal(replayed.successes, interrupted.successes);
    assert.equal(replayed.failures, interrupted.failures);
    assert.equal(replayed.confidence, interrupted.confidence);
    assert.equal(replayed.version, interrupted.version);
    assert.equal(replayed.status, success ? "active" : "quarantined");
    assert.deepEqual(replayed.certificationEvidence, interrupted.certificationEvidence);
    assert.ok(replayed.certificationEvidence?.includes("heldout:independent"));
  }
});

test("interrupted synthesis preserves the same skill version and memory provenance on replay", async () => {
  const learner = await engine();
  await learner.observe(experience("one"));
  (learner as unknown as { save(): Promise<void> }).save = async () => { throw Error("injected final ledger save failure"); };
  await assert.rejects(learner.observe(experience("two")), /injected/);
  const skillsPath = learner.partitionPath(partition, "skills.json");
  const before = JSON.parse(await readFile(skillsPath, "utf8")).skills[0];
  const memoryBefore = JSON.parse(await readFile(learner.partitionPath(partition, "memory.json"), "utf8")).records.map((item: { id: string }) => item.id).sort();
  // Ensure a new wall-clock timestamp would produce a different trace digest.
  await new Promise(resolve => setTimeout(resolve, 10));
  await new CognitiveLearningEngine(learner.directory).observe(experience("two"));
  const after = JSON.parse(await readFile(skillsPath, "utf8")).skills[0];
  const memoryAfter = JSON.parse(await readFile(learner.partitionPath(partition, "memory.json"), "utf8")).records.map((item: { id: string }) => item.id).sort();
  assert.equal(after.id, before.id);
  assert.equal(after.version, before.version);
  assert.deepEqual(after.provenance, before.provenance);
  assert.deepEqual(memoryAfter, memoryBefore);
});

test("completion hook records Goal evidence without counting another action", async () => {
  const learner = await engine();
  await learner.observe(experience("one"));
  assert.equal((await learner.metrics(partition)).completedGoals, 0);
  await learner.complete({ partition, goalId: "goal-one", experienceId: "one", evidenceRefs: ["goal-verifier:one"] });
  await learner.observe(experience("one"));
  assert.equal((await learner.metrics(partition)).goals, 1);
  assert.equal((await learner.metrics(partition)).completedGoals, 1);
  assert.ok((await readFile(learner.partitionPath(partition, "experience.json"), "utf8")).includes("goal-verifier:one"));
});

test("self improvement preserves independent/security gates and verifies rollback outcome", async () => {
  const learner = await engine();
  const candidate: ImprovementCandidate = { id: "candidate", surface: "planner", sourceEvidence: ["benchmark:one"], knownGoodVersion: "v1", candidateVersion: "v2", verified: true, measurableGain: 0.1, safetyRegression: false, humanInterventionDelta: 0, additionalApiCostUsd: 0 };
  const ok = async () => ({ ok: true, evidence: ["stage:observed"] });
  const adapters = { sandbox: ok, test: ok, regression: ok, deviceE2E: ok, canary: async () => ({ ok: false, evidence: ["canary:regression"] }), promote: ok, rollback: ok, independentVerification: ok, security: ok };
  assert.equal((await learner.improve(partition, { ...candidate, measurableGain: 0 }, adapters)).state, "rejected");
  assert.equal((await learner.improve(partition, candidate, adapters)).state, "rolled-back");
  await assert.rejects(learner.improve(partition, candidate, { ...adapters, rollback: async () => ({ ok: false, evidence: ["restore:failed"] }) }), /rollback unverified/);
  await assert.rejects(learner.improve(partition, candidate, { ...adapters, independentVerification: undefined }), /Independent verification/);
});
