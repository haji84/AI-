import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { cognitiveDigest } from "../src/gai/cognitive-state.ts";
import type { PrimaryBrainAdapter } from "../src/gai/primary-brain.ts";
import type { CognitiveRuntimeOptions } from "../src/orchestrator/compass-goal-execution-adapter.ts";

// Deterministic transport/model fixtures test integration; these are not live AI/data evidence.
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), "goriq-public-research-runtime-"));
 const dbPath = join(root, "compass.db"), dataRoot = join(root, "data"), manifestPath = join(root, "research.json");
 await mkdir(dataRoot);
 const db = new CompassStore(dbPath);
 const record = db.setGoal({ title: "公開最新版を調べ、出典付きCSVと確認メモを保存してください。", successCriteria: ["版と公開日時が出典付きCSVに保存される", "同じ取得結果の確認メモを取得できる"], constraints: ["Read only the admitted public source", "Never overwrite existing artifacts"] });
 db.close();
 const goal = compassGoalToLoopGoal(record), goalId = goalWorkStateId(goal);
 const manifest = { version: 1, goalId, goalDigest: cognitiveDigest(goal), sources: [{ id: "release", url: "https://example.com/latest" }], outcomes: [{ id: "release-report", sourceId: "release", fields: [{ jsonField: "tag_name", label: "Version" }, { jsonField: "published_at", label: "Published UTC" }], csvPath: "release.csv", memoPath: "release.md", criteria: ["criterion-1", "criterion-2"], publishedAtField: "published_at" }] };
 await writeFile(manifestPath, JSON.stringify(manifest));
 let fetches = 0, modelCalls = 0, unapprovedValue = "NOT_FOR_ARTIFACT_OR_MEMORY";
 const choose: PrimaryBrainAdapter["plan"] = async context => {
  modelCalls++;
  assert.equal(fetches, 0, "selection precedes acquisition");
  const id = context.candidates[0].id;
  return { candidateId: id, plan: [{ candidateId: id, objective: "Read the admitted source and verify both artifacts", expectedOutcome: "Source-derived CSV and memo" }], assessment: "Use the host-admitted research capability", hypotheses: [], expectedOutcome: "Verified artifacts", confidence: 0.8, requiredEvidence: ["source-readback"], recoveryOptions: [], escalation: "none" };
 };
 const brain: PrimaryBrainAdapter = { id: "fixture-brain", plan: choose, infer: choose, classify: choose, summarize: choose, hypothesize: choose, critique: choose, async estimateConfidence() { return 0.8; } };
 const options: CognitiveRuntimeOptions = { brain, publicResearch: { manifestPath, dataRoot,
  sourcePolicyJson: JSON.stringify({ version: 1, sources: [{ url: "https://example.com/latest", sourceClass: "official", fields: ["tag_name", "published_at"] }] }),
  transport: { resolve: async () => [{ address: "93.184.216.34", family: 4 }], fetchImpl: async () => { fetches++; return new Response(JSON.stringify({ tag_name: "v1.2.3", published_at: "2026-01-01T00:00:00Z", private_unused: unapprovedValue }), { headers: { "content-type": "application/json" } }); } },
 } };
 return { root, dbPath, dataRoot, manifestPath, goalId, manifest, options, changeUnapproved() { unapprovedValue = "DIFFERENT_UNUSED_COUNTER"; }, counts: () => ({ fetches, modelCalls }) };
}

test("normal CognitiveService acquires its own facts and verifies both artifacts without caller-supplied answers", async () => {
 const f = await fixture(); try {
  const service = new CognitiveService(f.dbPath, f.options);
  assert.equal((await service.status()).localActionsConfigured, true);
  const result = await service.continue(f.goalId);
  assert.equal(result.stopReason, "goal_complete");
  assert.equal(result.goalEvaluation?.achieved, true);
  assert.equal(f.counts().modelCalls, 1);
  const csv = await readFile(join(f.dataRoot, "release.csv"), "utf8"), memo = await readFile(join(f.dataRoot, "release.md"), "utf8");
  for (const text of [csv, memo.replaceAll("\\.", ".")]) { assert.match(text, /v1\.2\.3/); assert.match(text, /https:\/\/example\.com\/latest/); assert.doesNotMatch(text, /NOT_FOR_ARTIFACT_OR_MEMORY/); }
  const resumed = new CognitiveService(f.dbPath, f.options);
  f.changeUnapproved();
  assert.equal((await resumed.status()).goalComplete, true);
  assert.equal((await resumed.continue(f.goalId)).stopReason, "goal_complete");
  assert.equal((await resumed.status()).attempts, 1, "verified writes are not repeated on resume");
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("shared criterion receipts retain both outcomes across partial resume and reject tampering of the first", async () => {
 const f = await fixture(); try {
  f.manifest.outcomes.push({ ...f.manifest.outcomes[0], id: "second", csvPath: "second.csv", memoPath: "second.md" });
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  const options = { ...f.options, brain: undefined };
  const first = await new CognitiveService(f.dbPath, options).continue(f.goalId, { maxCycles: 1 });
  assert.notEqual(first.goalEvaluation?.achieved, true);
  f.changeUnapproved();
  const resumed = new CognitiveService(f.dbPath, options);
  assert.equal((await resumed.continue(f.goalId)).stopReason, "goal_complete");
  assert.equal((await new CognitiveService(f.dbPath, options).status()).goalComplete, true);
  await writeFile(join(f.dataRoot, "release.csv"), "tampered first artifact");
  const tampered = new CognitiveService(f.dbPath, options);
  assert.equal((await tampered.status()).goalComplete, false);
  await assert.rejects(tampered.continue(f.goalId), /revalidat|artifact|research/i);
  assert.match(await readFile(join(f.dataRoot, "second.csv"), "utf8"), /v1\.2\.3/);
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("completed research is revalidated and a changed artifact cannot inherit stale PASS", async () => {
 const f = await fixture(); try {
  await new CognitiveService(f.dbPath, f.options).continue(f.goalId);
  await writeFile(join(f.dataRoot, "release.csv"), "tampered owner content");
  const resumed = new CognitiveService(f.dbPath, f.options);
  assert.equal((await resumed.status()).goalComplete, false);
  await assert.rejects(resumed.continue(f.goalId), /revalidat|artifact|research/i);
  assert.equal(await readFile(join(f.dataRoot, "release.csv"), "utf8"), "tampered owner content");
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("missing source authority and conflicting contracts fail before model or network", async () => {
 const f = await fixture(); try {
  await assert.rejects(new CognitiveService(f.dbPath, { ...f.options, publicResearch: { ...f.options.publicResearch!, sourcePolicyJson: "" } }).continue(f.goalId));
  await assert.rejects(new CognitiveService(f.dbPath, { ...f.options, localOutcomes: { manifestPath: f.manifestPath, dataRoot: f.dataRoot } }).continue(f.goalId), /one local work contract/i);
  assert.deepEqual(f.counts(), { fetches: 0, modelCalls: 0 });
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("paused research performs no acquisition or model selection", async () => {
 const f = await fixture(); try {
  const db = new CompassStore(f.dbPath); db.updateState({ status: "PAUSED" }); db.close();
  assert.equal((await new CognitiveService(f.dbPath, f.options).continue(f.goalId)).stopReason, "paused");
  assert.deepEqual(f.counts(), { fetches: 0, modelCalls: 0 });
 } finally { await rm(f.root, { recursive: true, force: true }); }
});
