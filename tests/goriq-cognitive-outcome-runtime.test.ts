import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CompassGoalExecutionAdapter, type CognitiveRuntimeOptions } from "../src/orchestrator/compass-goal-execution-adapter.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { decodeXlsx } from "../src/orchestrator/local-spreadsheet-capability.ts";
import { decodeDocx } from "../src/orchestrator/local-document-capability.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "goriq-outcome-runtime-"));
  const dbPath = join(root, "compass.db"), dataRoot = join(root, "data"), manifestPath = join(root, "outcomes.json");
  await mkdir(dataRoot);
  const db = new CompassStore(dbPath);
  const record = db.setGoal({ title: "Prepare local Excel and Word deliverables", successCriteria: ["Spreadsheet matches supplied cells", "Document matches supplied sections"], constraints: ["No external AI", "Do not overwrite existing files"] });
  db.close();
  const goalId = goalWorkStateId(compassGoalToLoopGoal(record));
  const workbook = { cells: [{ sheet: "Result", cell: "A1", value: "Total" }, { sheet: "Result", cell: "B1", value: 42 }] };
  const document = { title: "Report", sections: { Result: "The supplied result is 42." } };
  const materials = [
    { id: "numbers", path: "numbers.json", format: "workbook-json", sha256: digest(JSON.stringify(workbook)) },
    { id: "report", path: "report.json", format: "document-json", sha256: digest(JSON.stringify(document)) },
  ];
  const manifest = { version: 1, goalId, materials, outcomes: [
    { id: "excel", materialId: "numbers", path: "result.xlsx", domain: "spreadsheet", criteria: ["criterion-1"] },
    { id: "word", materialId: "report", path: "result.docx", domain: "document", criteria: ["criterion-2"] },
  ] };
  await writeFile(join(dataRoot, "numbers.json"), JSON.stringify(workbook));
  await writeFile(join(dataRoot, "report.json"), JSON.stringify(document));
  await writeFile(manifestPath, JSON.stringify(manifest));
  const options = { localOutcomes: { manifestPath, dataRoot } } as CognitiveRuntimeOptions;
  return { root, dbPath, dataRoot, manifestPath, goalId, workbook, document, options };
}

test("desired artifacts generate steps, verify material lineage and resume through the real Core without a prewritten plan", async () => {
  const f = await fixture();
  try {
    const service = new CognitiveService(f.dbPath, f.options);
    assert.equal((await service.status()).localActionsConfigured, true);
    const first = await service.continue(f.goalId);
    assert.equal(first.goalEvaluation?.achieved, false, "four real actions cannot complete in the first three-cycle budget");
    const restored = new CognitiveService(f.dbPath, f.options);
    const second = await restored.continue(f.goalId);
    assert.equal(second.stopReason, "goal_complete");
    assert.equal(second.goalEvaluation?.achieved, true);
    assert.deepEqual(decodeXlsx(await readFile(join(f.dataRoot, "result.xlsx"))), f.workbook);
    assert.deepEqual(decodeDocx(await readFile(join(f.dataRoot, "result.docx"))), f.document);
    const status = await restored.status();
    assert.equal(status.attempts, 4);
    assert.equal(status.metrics.completedGoals, 1);
    assert.equal(status.metrics.externalAiCallsPerGoal, 0);
    assert.equal((await restored.continue(f.goalId)).stopReason, "goal_complete");
    assert.equal((await restored.status()).attempts, 4, "resume must not replay verified writes");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("material changed after observation cannot earn output criteria or silently replace the expected source", async () => {
  const f = await fixture();
  try {
    await new CompassGoalExecutionAdapter(f.dbPath, {}, f.options).run(f.goalId, { maxCycles: 1 });
    await writeFile(join(f.dataRoot, "numbers.json"), JSON.stringify({ cells: [{ sheet: "Result", cell: "A1", value: "changed" }] }));
    let complete = false;
    try { complete = (await new CognitiveService(f.dbPath, f.options).continue(f.goalId)).goalEvaluation?.achieved === true; } catch { /* bounded material rejection before mutation also passes */ }
    assert.equal(complete, false);
    await assert.rejects(readFile(join(f.dataRoot, "result.xlsx")), /ENOENT/);
    assert.equal((await new CognitiveService(f.dbPath).status()).goalComplete, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("an occupied output is preserved and the actual Goal remains incomplete", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dataRoot, "result.xlsx"), "existing owner content");
    const service = new CognitiveService(f.dbPath, f.options);
    for (let i = 0; i < 2; i++) assert.notEqual((await service.continue(f.goalId)).goalEvaluation?.achieved, true);
    assert.equal(await readFile(join(f.dataRoot, "result.xlsx"), "utf8"), "existing owner content");
    assert.equal((await service.status()).goalComplete, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("legacy steps and outcome contracts cannot simultaneously select different authority", async () => {
  const f = await fixture();
  try {
    const options = { ...f.options, localWork: { manifestPath: f.manifestPath, dataRoot: f.dataRoot } };
    await assert.rejects(new CompassGoalExecutionAdapter(f.dbPath, {}, options).run(f.goalId), /one local work contract/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("a completed Goal cannot lend its PASS to a changed output contract or data root", async () => {
  const f = await fixture();
  try {
    const service = new CognitiveService(f.dbPath, f.options);
    await service.continue(f.goalId); await service.continue(f.goalId);
    const original = await readFile(f.manifestPath, "utf8"), changed = JSON.parse(original);
    changed.outcomes[0].path = "different.xlsx";
    await writeFile(f.manifestPath, JSON.stringify(changed));
    assert.equal((await service.status()).goalComplete, false, "visible status must not show stale completion for a changed contract");
    await assert.rejects(service.continue(f.goalId), /execution contract changed/);
    await assert.rejects(readFile(join(f.dataRoot, "different.xlsx")), /ENOENT/);
    await writeFile(f.manifestPath, original);
    const otherRoot = join(f.root, "other-data"); await mkdir(otherRoot);
    await assert.rejects(new CognitiveService(f.dbPath, { localOutcomes: { manifestPath: f.manifestPath, dataRoot: otherRoot } }).continue(f.goalId), /execution contract changed/);
    await assert.rejects(new CognitiveService(f.dbPath).continue(f.goalId), /execution contract changed/);
    assert.equal((await service.continue(f.goalId)).stopReason, "goal_complete");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("first contract binding cannot inherit WorkState evidence from a different execution path", async () => {
  const f = await fixture();
  try {
    await new CognitiveService(f.dbPath).continue(f.goalId);
    const { CompassWorkStateStoreAdapter } = await import("../src/orchestrator/compass-work-state-store.ts");
    const db = new CompassStore(f.dbPath), workStore = new CompassWorkStateStoreAdapter(db);
    const work = await workStore.get(f.goalId); assert.ok(work);
    work.verificationResults = [{ itemId: "criterion-1", passed: true, evidence: { refs: ["different-authority"] } }];
    await workStore.put(work); const before = db.getState(); db.close();
    await assert.rejects(new CognitiveService(f.dbPath, { ...f.options, stateRoot: join(f.root, "new-state") }).continue(f.goalId), /unbound execution history/);
    const reopened = new CompassStore(f.dbPath); try { assert.deepEqual(reopened.getState(), before); } finally { reopened.close(); }
    await assert.rejects(readFile(join(f.dataRoot, "result.xlsx")), /ENOENT/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test("one criterion shared by two deliverables still requires both independently verified outputs", async () => {
  const f = await fixture();
  try {
    const db = new CompassStore(f.dbPath); db.setGoal({ title: "Prepare local Excel and Word deliverables", successCriteria: ["Both required copies exist"], constraints: ["No external AI"] }); db.close();
    await writeFile(join(f.dataRoot, "source.txt"), "42");
    await writeFile(f.manifestPath, JSON.stringify({ version: 1, goalId: f.goalId, materials: [{ id: "source", path: "source.txt", format: "text", sha256: digest("42") }], outcomes: ["one.txt", "two.txt"].map((path, index) => ({ id: "copy" + index, materialId: "source", domain: "file", path, criteria: ["criterion-1"] })) }));
    const first = await new CompassGoalExecutionAdapter(f.dbPath, {}, f.options).run(f.goalId, { maxCycles: 2 });
    assert.equal(await readFile(join(f.dataRoot, "one.txt"), "utf8"), "42");
    assert.equal(first.goalEvaluation?.achieved, false, "first artifact PASS is not completion of the whole contract");
    const service = new CognitiveService(f.dbPath, f.options);
    assert.equal((await service.status()).metrics.completedGoals, 0);
    const result = await service.continue(f.goalId);
    assert.equal(result.stopReason, "goal_complete");
    assert.equal(await readFile(join(f.dataRoot, "two.txt"), "utf8"), "42");
    assert.equal((await service.status()).attempts, 3);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
