import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompassStore } from "../src/compass/store.ts";
import { CompassGoalRegistryAdapter, CompassGoalDecisionStoreAdapter } from "../src/orchestrator/compass-goal-controller.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { decodeXlsx } from "../src/orchestrator/local-spreadsheet-capability.ts";
import { decodeDocx } from "../src/orchestrator/local-document-capability.ts";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../scripts/goriq-cognitive-run.ts", import.meta.url));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "goriq-cli-delivery-"));
  const dbPath = join(root, "compass.db"), dataRoot = join(root, "data");
  await mkdir(dataRoot);
  const db = new CompassStore(dbPath);
  const controller = new GoalControllerRuntime({ registry: new CompassGoalRegistryAdapter(db), decisionStore: new CompassGoalDecisionStoreAdapter(db), workStateStore: new CompassWorkStateStoreAdapter(db) });
  const request = { source: "codex" as const, text: "Deliver the supplied comparison workbook and briefing", idempotencyKey: "isolated-office-delivery", goalContract: { successCriteria: ["Workbook matches supplied cells", "Briefing matches supplied sections"], constraints: ["Isolated local conversion only", "No external AI"] } };
  const decision = await controller.handle(request);
  assert.equal(decision.resolution.kind, "NEW_GOAL");
  assert.equal((await controller.handle(request)).goalId, decision.goalId);
  db.close();
  const goalId = decision.goalId!;
  const options = { materialIntake: { dataRoot } };
  const service = new CognitiveService(dbPath, options);
  const status = await service.status();
  const workbook = { cells: [{ sheet: "Comparison", cell: "A1", value: "Target sales" }, { sheet: "Comparison", cell: "B1", value: 12 }] };
  const document = { title: "Comparison briefing", sections: { Assumptions: "Prices and demand remain unverified." } };
  await service.prepareMaterials({ goalId, goalDigest: status.goalDigest, mappingAcknowledged: true, materials: [
    { format: "workbook-json", content: JSON.stringify(workbook), criteria: ["criterion-1"] },
    { format: "document-json", content: JSON.stringify(document), criteria: ["criterion-2"] },
  ] });
  const env = { ...process.env, JARVIS_COMPASS_DB_PATH: dbPath, COMPASS_DB_PATH: dbPath, GORIQ_LOCAL_MATERIAL_INTAKE: "1", GORIQ_LOCAL_DATA_ROOT: dataRoot,
    GORIQ_LOCAL_WORK_MANIFEST: "", GORIQ_LOCAL_OUTCOMES: "", GORIQ_HISTORY_MANIFEST: "", GAI_LOCAL_MODEL_NAME: "" };
  const run = async (...args: string[]) => JSON.parse((await execute(process.execPath, [cli, "continue", ...args], { env, timeout: 30_000, maxBuffer: 1_048_576 })).stdout);
  return { root, dbPath, service, options, goalId, workbook, document, run };
}

test("one bounded CLI invocation resumes persisted work and finishes the remaining Office outputs", async () => {
  const f = await fixture();
  try {
    const first = await f.run("--max-cycles=1");
    assert.equal(first.cycles, 1);
    assert.equal(first.goalEvaluation.achieved, false);
    assert.equal((await f.service.status()).attempts, 1);
    await assert.rejects(f.service.output(f.goalId, "output-2"), /independently verified/);
    const completed = await f.run("--max-cycles=8");
    assert.equal(completed.stopReason, "goal_complete");
    assert.equal(completed.goalEvaluation.achieved, true);
    const restored = new CognitiveService(f.dbPath, f.options);
    const workbook = await restored.output(f.goalId, "output-1"), document = await restored.output(f.goalId, "output-2");
    assert.deepEqual(decodeXlsx(workbook.bytes), f.workbook);
    assert.deepEqual(decodeDocx(document.bytes), f.document);
    const status = await restored.status();
    assert.equal(status.goalId, f.goalId);
    assert.equal(status.attempts, 4);
    assert.equal(status.metrics.completedGoals, 1);
    assert.equal(status.metrics.externalAiCallsPerGoal, 0);
    assert.equal((await f.run("--max-cycles=100")).stopReason, "goal_complete");
    assert.equal((await restored.status()).attempts, 4);
    assert.equal(sha((await restored.output(f.goalId, "output-1")).bytes), sha(workbook.bytes));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("CLI default retains three cycles and an explicit budget cannot override a paused Goal", async () => {
  const f = await fixture();
  try {
    const first = await f.run();
    assert.equal(first.cycles, 3);
    assert.equal(first.goalEvaluation.achieved, false);
    const db = new CompassStore(f.dbPath); db.updateState({ status: "PAUSED" }); db.close();
    const paused = await f.run("--max-cycles=100");
    assert.equal(paused.stopReason, "paused");
    assert.equal(paused.cycles, 0);
    assert.equal((await f.service.status()).attempts, 3);
    await assert.rejects(f.service.output(f.goalId, "output-2"), /independently verified/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("Windows long data paths retain native lease exclusion and can complete real deliverables", { skip: process.platform !== "win32" }, async () => {
  const { acquireCognitiveLease } = await import("../src/gai/cognitive-lease.ts");
  const root = await mkdtemp(join(tmpdir(), "goriq-long-path-"));
  try {
    const dataRoot = join(root, "x".repeat(100), "y".repeat(100));
    await mkdir(dataRoot, { recursive: true });
    const leasePath = join(dataRoot, "writer.lock");
    assert.ok((leasePath + ".arbiter.sqlite").length > 260);
    const release = await acquireCognitiveLease(leasePath);
    try { await assert.rejects(acquireCognitiveLease(leasePath), { code: "EEXIST" }); } finally { await release(); }
    const releaseAgain = await acquireCognitiveLease(leasePath); await releaseAgain();
    const dbPath = join(root, "compass.db"), db = new CompassStore(dbPath);
    const controller = new GoalControllerRuntime({ registry: new CompassGoalRegistryAdapter(db), decisionStore: new CompassGoalDecisionStoreAdapter(db) });
    const decision = await controller.handle({ source: "codex", text: "Deliver the supplied long-path file", goalContract: { successCriteria: ["File matches supplied text"] } });
    db.close();
    const service = new CognitiveService(dbPath, { stateRoot: join(dataRoot, "state"), materialIntake: { dataRoot } });
    const status = await service.status();
    await service.prepareMaterials({ goalId: decision.goalId, goalDigest: status.goalDigest, mappingAcknowledged: true, materials: [{ format: "text", content: "long-path result", criteria: ["criterion-1"] }] });
    assert.equal((await service.continue(decision.goalId!, { maxCycles: 4 })).goalEvaluation?.achieved, true);
    assert.equal((await service.output(decision.goalId!, "output-1")).bytes.toString(), "long-path result");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid service budgets fail before creating a Compass database", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-budget-refusal-"));
  const dbPath = join(root, "missing.db");
  try {
    const service = new CognitiveService(dbPath);
    for (const maxCycles of [0, -1, 101, 1.5, NaN, Infinity]) {
      await assert.rejects(service.continue("goal-0000000000000000", { maxCycles }), /maxCycles/);
    }
    await assert.rejects(stat(dbPath), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed CLI budgets are rejected without touching the selected database", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-cli-budget-refusal-"));
  const dbPath = join(root, "missing.db");
  try {
    for (const args of [["--max-cycles=0"], ["--max-cycles=101"], ["--max-cycles=01"], ["--max-cycles=2.5"], ["--max-cycles=2", "--max-cycles=3"]]) {
      await assert.rejects(execute(process.execPath, [cli, "continue", ...args], { env: { ...process.env, JARVIS_COMPASS_DB_PATH: dbPath }, timeout: 10_000 }), /max-cycles/);
      await assert.rejects(stat(dbPath), /ENOENT/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
