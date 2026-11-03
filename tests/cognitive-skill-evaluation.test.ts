import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CompassGoalExecutionAdapter, type CognitiveRuntimeOptions } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { CognitiveLocalOutcomeCatalog, loadCognitiveLocalOutcomes, type CognitiveLocalOutcomeManifest } from "../src/gai/cognitive-local-outcomes.ts";
import { cognitiveDigest } from "../src/gai/cognitive-state.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";

const partition = { tenantId: "measured-skill", principalId: "owner" }, environment = "matched-local";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture(format: "text" | "workbook-json" | "document-json" = "text") {
  const root = await mkdtemp(join(tmpdir(), "goriq-skill-eval-"));
  const learning = new CognitiveLearningEngine(join(root, "learning"));
  async function arm(name: string, description = "Matched source and Goal", bytes = "heldout material") {
    if (format === "workbook-json") bytes = JSON.stringify({ cells: [{ sheet: "Data", cell: "A1", value: bytes }] });
    if (format === "document-json") bytes = JSON.stringify({ title: "Material", sections: { Summary: bytes } });
    const dir = join(root, name), dataRoot = join(dir, "data"); await mkdir(dataRoot, { recursive: true });
    const dbPath = join(dir, "compass.db"), manifestPath = join(dir, "outcomes.json");
    const db = new CompassStore(dbPath), record = db.setGoal({ title: "Preserve supplied material", description, successCriteria: ["Output equals independently verified source"], constraints: ["No external AI"] }); db.close();
    const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
    const domain = format === "text" ? "file" : format === "workbook-json" ? "spreadsheet" : "document", target = domain === "file" ? "output.txt" : domain === "spreadsheet" ? "output.xlsx" : "output.docx";
    const manifest: CognitiveLocalOutcomeManifest = { version: 1, goalId, materials: [{ id: "input", path: "input.txt", format, sha256: sha(bytes) }], outcomes: [{ id: "copy", materialId: "input", path: target, domain, criteria: ["criterion-1"] }] };
    await writeFile(join(dataRoot, "input.txt"), bytes); await writeFile(manifestPath, JSON.stringify(manifest));
    const catalog = await loadCognitiveLocalOutcomes(manifestPath, dataRoot, goalId, goal);
    const options: CognitiveRuntimeOptions = { useCore: true, stateRoot: join(dir, "state"), partition, learning, environment, localOutcomes: { manifestPath, dataRoot } };
    return { catalog, goalId, goal, manifest, dataRoot, target, options, run: (id?: string, maxCycles = 3) => new CompassGoalExecutionAdapter(dbPath, {}, { ...options, ...(id ? { evaluation: { id } } : {}) }).run(goalId, { maxCycles }) };
  }
  await (await arm("train-one", "Training one", "train one")).run();
  await (await arm("train-two", "Training two", "train two")).run();
  const operation = format === "text" ? "material:v1:copy:text" : format === "workbook-json" ? "material:v1:create:xlsx" : "material:v1:create:docx";
  const skill = (await learning.candidates(partition)).find(c => c.operation === operation)!; assert.ok(skill);
  const baseline = await arm("baseline"), candidate = await arm("candidate");
  const input = { learning, partition, skillId: skill.id, id: "comparison-one", baseline, candidate };
  const prepare = async (changes = {}) => (await import("../src/gai/cognitive-skill-evaluation.ts")).prepareCognitiveSkillEvaluation({ ...input, ...changes });
  const certify = () => learning.certify({ partition, skillId: skill.id, comparisonId: input.id });
  const ledger = async () => JSON.parse(await readFile(learning.partitionPath(partition, "experience.json"), "utf8"));
  return { root, learning, skill, baseline, candidate, prepare, certify, ledger, arm };
}

test("caller scores cannot activate a local material operation Skill", async () => {
  const f = await fixture(); try {
    const result = await f.learning.certify({ partition, skillId: f.skill.id, evidenceRefs: ["unmeasured:gain"], baselinePassRate: 0, candidatePassRate: 1, independent: true, safetyPassed: true });
    assert.equal(result.accepted, false); assert.ok(result.reasons.includes("measured_local_comparison_required"));
    assert.equal((await f.learning.candidates(partition)).find(c => c.id === f.skill.id)?.status, "candidate");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("matched real Core artifacts produce derived equal rates and remain candidates", async () => {
  const f = await fixture(); try {
    const plans = await f.prepare(); assert.equal(plans.length, 2); assert.equal((await f.ledger()).evaluations.length, 2);
    await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
    assert.equal(await readFile(join(f.baseline.dataRoot, "output.txt"), "utf8"), "heldout material");
    assert.equal(await readFile(join(f.candidate.dataRoot, "output.txt"), "utf8"), "heldout material");
    const result = await f.certify(); assert.equal(result.accepted, false); assert.ok(result.reasons.includes("no_measurable_gain"));
    assert.deepEqual(result.measurements, { baselinePassRate: 1, candidatePassRate: 1, pairedActions: 2 });
    assert.equal((await f.learning.candidates(partition)).find(c => c.id === f.skill.id)?.status, "candidate");
    assert.deepEqual(await f.prepare(), plans); assert.deepEqual(await f.certify(), result);
    const heldout = (await f.ledger()).experiences.filter((e: { split?: string }) => e.split === "heldout"); assert.equal(heldout.length, 4);
    const recall = await f.learning.recall({ partition, goalId: "new", task: f.skill.purpose, environment });
    assert.ok(recall.memories.every(m => !heldout.some((e: { id: string }) => m.id === "experience:" + e.id)));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("pair requires the same Goal, source, oracle criteria and pristine output conditions", async () => {
  for (const variation of ["source", "goal", "target"] as const) {
    const f = await fixture(); try {
      const candidate = variation === "source" ? await f.arm("different", undefined, "different source") : variation === "goal" ? await f.arm("different", "Different Goal") : f.candidate;
      if (variation === "target") await writeFile(join(candidate.dataRoot, "output.txt"), "occupied");
      await assert.rejects(f.prepare({ candidate }), /matched|pristine/i);
      assert.equal((await f.ledger()).evaluations?.length ?? 0, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("partial execution remains inconclusive; restart preserves exact reservations", async () => {
  const f = await fixture(); try {
    const plans = await f.prepare(); await f.baseline.run(plans[0].id);
    assert.equal((await f.certify()).accepted, false); assert.ok((await f.certify()).reasons.includes("incomplete_measured_comparison"));
    await assert.rejects(f.candidate.run(), /evaluation.*requires/i);
    await f.candidate.run(plans[1].id, 1); await f.candidate.run(plans[1].id);
    assert.ok((await f.certify()).reasons.includes("no_measurable_gain"));
    const restarted = new CognitiveLearningEngine(f.learning.directory);
    assert.deepEqual(await restarted.certify({ partition, skillId: f.skill.id, comparisonId: "comparison-one" }), await f.certify());
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("candidate library version drift invalidates a measured comparison", async () => {
  const f = await fixture(); try {
    const plans = await f.prepare(); await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
    const library = new PersistentSkillLibrary(f.learning.partitionPath(partition, "skills.json")), skill = (await library.get(f.skill.id))!;
    await library.upsert({ ...skill, version: (skill.version ?? 1) + 1 });
    await assert.rejects(f.certify(), /subject.*changed/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("unequal filesystem outcomes are measured without inventing algorithmic gain", async () => {
  for (const failedArm of ["baseline", "candidate"] as const) {
    const f = await fixture(); try {
      const plans = await f.prepare();
      // Drift after the shared pristine setup, not a deliberately harder baseline.
      await writeFile(join(f[failedArm].dataRoot, "output.txt"), "unexpected occupied target");
      await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
      const result = await f.certify(); assert.equal(result.accepted, false);
      assert.ok(result.reasons.includes(failedArm === "baseline" ? "identical_procedure_cannot_establish_gain" : "measured_regression"));
      assert.deepEqual(result.measurements, { baselinePassRate: failedArm === "baseline" ? 0.5 : 1, candidatePassRate: failedArm === "candidate" ? 0.5 : 1, pairedActions: 2 });
      const failed = (await f.ledger()).experiences.find((e: { split?: string; observation: { success: boolean } }) => e.split === "heldout" && !e.observation.success);
      assert.equal(failed.evaluation.artifacts[1].actualSha256, sha("unexpected occupied target"));
      assert.equal((await f.learning.candidates(partition)).find(c => c.id === f.skill.id)?.status, "candidate");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("duplicated action receipts cannot certify", async () => {
  const f = await fixture(); try {
    const plans = await f.prepare(); await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
    const e = (await f.ledger()).experiences.find((e: { evaluation?: { planDigest: string } }) => e.evaluation);
    await f.learning.observe({ ...e, id: "duplicate-measured-action", evidenceRefs: ["independent:duplicate-action"] });
    assert.ok((await f.certify()).reasons.includes("incomplete_measured_comparison"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("real XLSX and DOCX paired output measurements remain no-gain candidates", async () => {
  for (const format of ["workbook-json", "document-json"] as const) {
    const f = await fixture(format); try {
      const plans = await f.prepare(); await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
      const baselineBytes = await readFile(join(f.baseline.dataRoot, f.baseline.target)), candidateBytes = await readFile(join(f.candidate.dataRoot, f.candidate.target));
      assert.deepEqual(candidateBytes, baselineBytes); assert.ok(candidateBytes.length > 100);
      const result = await f.certify(); assert.equal(result.accepted, false); assert.ok(result.reasons.includes("no_measurable_gain"));
      assert.deepEqual(result.measurements, { baselinePassRate: 1, candidatePassRate: 1, pairedActions: 2 });
      const receipts = (await f.ledger()).experiences.filter((e: { evaluation?: { artifacts: unknown[] } }) => e.evaluation?.artifacts.length === 2);
      assert.equal(receipts.length, 2); assert.ok(receipts.every((e: { evaluation: { artifacts: Array<{ domain: string; status: string }> } }) => e.evaluation.artifacts[1].domain === (format === "workbook-json" ? "spreadsheet" : "document") && e.evaluation.artifacts[1].status === "PASS"));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("unverified uncertain output attempt prevents comparison completeness", async () => {
  const f = await fixture(); try {
    const plans = await f.prepare(); await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
    const receipt = (await f.ledger()).experiences.find((e: { evaluation?: unknown; actionId: string }) => e.evaluation && e.actionId.startsWith("outcome:"));
    const uncertain = { ...receipt, id: "unverified-attempt", verified: false, evidenceRefs: [], observation: { summary: "Outcome uncertain", success: false } }; delete uncertain.evaluation;
    await f.learning.observe(uncertain);
    assert.ok((await f.certify()).reasons.includes("incomplete_measured_comparison"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("review regression: missing or substituted output artifact measurement invalidates the comparison", async () => {
  for (const mode of ["truncate", "substitute"] as const) {
    const f = await fixture(); try {
      const plans = await f.prepare(); await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
      const data = await f.ledger();
      for (const e of data.experiences.filter((e: { evaluation?: unknown; actionId: string }) => e.evaluation && e.actionId.startsWith("outcome:"))) {
        if (mode === "truncate") e.evaluation.artifacts = [e.evaluation.artifacts[0]];
        else { e.evaluation.artifacts[1].expectedSha256 = sha("substituted output"); e.evaluation.artifacts[1].actualSha256 = sha("substituted output"); }
        e.evaluation.verificationDigest = cognitiveDigest({ resultOk: e.evaluation.resultOk, verifierOk: e.evaluation.verifierOk, artifacts: e.evaluation.artifacts });
      }
      await writeFile(f.learning.partitionPath(partition, "experience.json"), JSON.stringify(data));
      await assert.rejects(f.certify(), /planned.*artifact|artifact.*binding/i);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("review regression: physically aliased data roots cannot reserve a matched comparison", async () => {
  const f = await fixture(); try {
    const alias = join(f.root, "alias"); await symlink(join(f.root, "baseline"), alias, "junction");
    const candidate = { catalog: new CognitiveLocalOutcomeCatalog(join(alias, "data"), f.baseline.manifest, f.baseline.goalId, f.baseline.goal), goalId: f.baseline.goalId };
    await assert.rejects(f.prepare({ candidate }), /matched.*root|isolated.*root/i);
    assert.equal((await f.ledger()).evaluations?.length ?? 0, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("paired allocation crash retains both plans and refuses another comparison or ordinary training", async () => {
  const f = await fixture(); try {
    const internal = f.learning as unknown as { save: (...args: unknown[]) => Promise<void> }, save = internal.save;
    internal.save = async function(...args) { await save.apply(this, args); throw Error("injected after atomic reservation"); };
    await assert.rejects(f.prepare(), /injected after atomic/); internal.save = save;
    assert.equal((await f.ledger()).evaluations.length, 2);
    const plans = await f.prepare(); await assert.rejects(f.prepare({ id: "another-comparison" }), /overlap/i);
    await assert.rejects(f.baseline.run(), /evaluation.*requires/i);
    await f.baseline.run(plans[0].id); await f.candidate.run(plans[1].id);
    assert.ok((await f.certify()).reasons.includes("no_measurable_gain"));
    const e = (await f.ledger()).experiences.find((e: { evaluation?: unknown }) => e.evaluation);
    const train = { ...e, id: "leaked-training", goalId: "new-goal", split: "train", evidenceRefs: ["independent:leak"] }; delete train.evaluation;
    await assert.rejects(f.learning.observe(train), /heldout.*material/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
