import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CognitiveHistoricalLearningStore } from "../src/gai/cognitive-history.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";

type StoredHistory = { records: Array<{ sourceSha256: string; candidate: { status: string; evidenceRefs: string[]; partition: { tenantId: string; principalId: string }; content: string } }> };
const partition = { tenantId: "home", principalId: "owner" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "goriq-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data"); await mkdir(data);
  const state = join(root, "history"); const manifest = join(root, "manifest.json");
  const source = { id: "decision-v1", path: "decision.md", kind: "decision", familyId: "output-validation", classification: "internal", scope: "owner" };
  await writeFile(join(data, source.path), "Validate independent output before promotion.\n");
  await writeFile(manifest, JSON.stringify({ version: 1, sources: [source] }));
  return { root, data, state, manifest, source, store: new CognitiveHistoricalLearningStore(state) };
}

test("local historical artifact is hashed, persisted, replay-safe and remains unverified", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.importManifest(f.manifest, f.data, partition), { imported: 1, existing: 0, total: 1 });
  const restored = new CognitiveHistoricalLearningStore(f.state);
  assert.deepEqual(await restored.importManifest(f.manifest, f.data, partition), { imported: 0, existing: 1, total: 1 });
  const summary = await restored.summary(partition);
  assert.deepEqual(summary, { total: 1, unverified: 1, verified: 0, sourceKinds: { decision: 1 } });
  assert.equal(JSON.stringify(summary).includes("Validate independent"), false);
  const records = await restored.list(partition);
  assert.equal(records[0].status, "UNVERIFIED"); assert.deepEqual(records[0].evidenceRefs, []);
  assert.ok(records[0].sourceRef.includes(digest("Validate independent output before promotion.\n")));
  assert.equal(records[0].sha256, digest(records[0].content));
  assert.equal((await restored.trainingDataset(new CognitiveLearningEngine(join(f.root, "learning")), partition)).rejected[0].reason, "independent_verification_required");
});

test("changed historical source ID cannot overwrite prior provenance", async t => {
  const f = await fixture(t); await f.store.importManifest(f.manifest, f.data, partition);
  await writeFile(join(f.data, f.source.path), "Different conclusion must have a different version ID");
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /conflict/);
  assert.equal((await f.store.list(partition))[0].content, "Validate independent output before promotion.");
});

test("host manifest cannot assert verification or grant cross-user/global learning scope", async t => {
  const f = await fixture(t);
  for (const source of [{ ...f.source, verification: { passed: true, independent: true } }, { ...f.source, scope: "global" }, { ...f.source, sha256: "a".repeat(64) }, { ...f.source, partition: { ...partition, principalId: "tester" } }]) {
    await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [source] }));
    await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /schema|scope/);
  }
  assert.equal((await f.store.summary(partition)).total, 0);
});

test("history denies escapes, secrets, invalid UTF8, special files and oversized data atomically", async t => {
  const f = await fixture(t);
  for (const path of ["../outside", "C:/outside", "file:stream", ".env", ".git/config", "NUL", "tail."]) {
    await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [{ ...f.source, path }] }));
    await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /path|scope/);
  }
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [f.source] }));
  for (const content of ["password=private-value", Buffer.from([0xc3, 0x28]), "a".repeat(8193)]) {
    await writeFile(join(f.data, f.source.path), content);
    await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /credential|UTF|bound|large/);
  }
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [{ ...f.source, path: "folder" }] }));
  await mkdir(join(f.data, "folder"));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /file|unsafe/);
  assert.equal((await f.store.summary(partition)).total, 0);
});

test("symlink source or directory cannot import outside approved data root", async t => {
  const f = await fixture(t);
  const outside = join(f.root, "outside"); await mkdir(outside); await writeFile(join(outside, "secret.md"), "Outside allowed root");
  await symlink(outside, join(f.data, "linked"), "junction");
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [{ ...f.source, path: "linked/secret.md" }] }));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /[Ss]ymlink|scope/);
});

test("partitioned history merges with verified live data while preserving held-out exclusion", async t => {
  const f = await fixture(t); await f.store.importManifest(f.manifest, f.data, partition);
  assert.equal((await f.store.summary({ ...partition, principalId: "tester" })).total, 0);
  const engine = new CognitiveLearningEngine(join(f.root, "learning"));
  const episode = { id: "live", partition, goalId: "goal", task: "convert report", actionId: "write", strategyId: "copy", environment: "local",
    prediction: { expectedOutcome: "correct report", confidence: 0.8 }, observation: { summary: "independent output matches", success: true },
    verified: true, evidenceRefs: ["verifier:output"], source: "deterministic" as const, durationMs: 1, externalCalls: 0 };
  await engine.observe(episode);
  await engine.observe({ ...episode, id: "heldout", goalId: "eval", split: "heldout", observation: { summary: "evaluation failed", success: false }, evidenceRefs: ["verifier:eval"] });
  const dataset = await f.store.trainingDataset(engine, partition);
  assert.equal(dataset.train.length, 0); assert.equal(dataset.validation.length, 0);
  assert.equal(dataset.heldout.length, 1); assert.equal(dataset.heldout[0].id, "live");
  assert.equal(dataset.rejected.length, 1); assert.equal(dataset.training.automaticTraining, false);
});

test("invalid second source leaves no partial historical import", async t => {
  const f = await fixture(t);
  await writeFile(join(f.data, "bad.md"), "api_key=do-not-retain");
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: [f.source, { ...f.source, id: "bad", path: "bad.md" }] }));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /credential/);
  assert.equal((await f.store.summary(partition)).total, 0);
});


test("source count, manifest and combined byte limits reject before any history write", async t => {
  const f = await fixture(t);
  await writeFile(f.manifest, " ".repeat(32769));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /bound/);
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: Array.from({ length: 25 }, (_, i) => ({ ...f.source, id: `source-${i}` })) }));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /bound/);
  await writeFile(join(f.data, f.source.path), "x".repeat(8192));
  await writeFile(f.manifest, JSON.stringify({ version: 1, sources: Array.from({ length: 17 }, (_, i) => ({ ...f.source, id: `source-${i}` })) }));
  await assert.rejects(f.store.importManifest(f.manifest, f.data, partition), /batch byte bound/);
  assert.equal((await f.store.summary(partition)).total, 0);
});

test("concurrent independent store instances preserve imports without duplicated records", async t => {
  const f = await fixture(t);
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => new CognitiveHistoricalLearningStore(f.state).importManifest(f.manifest, f.data, partition)));
  assert.equal(outcomes.reduce((sum, item) => sum + item.imported, 0), 1);
  assert.equal(outcomes.reduce((sum, item) => sum + item.existing, 0), 3);
  assert.equal((await f.store.summary(partition)).total, 1);
});

test("persisted candidate verification, foreign partition and digest tampering fail closed", async t => {
  const f = await fixture(t); await f.store.importManifest(f.manifest, f.data, partition);
  const path = join(dirname(new CognitiveLearningEngine(f.state).partitionPath(partition, "experience.json")), "history.json");
  const raw = await readFile(path, "utf8");
  for (const change of [
    (value: StoredHistory) => { value.records[0].candidate.status = "VERIFIED_CANDIDATE"; value.records[0].candidate.evidenceRefs = ["forged:pass"]; },
    (value: StoredHistory) => { value.records[0].candidate.partition.principalId = "tester"; },
    (value: StoredHistory) => { value.records[0].candidate.content = "different history"; },
    (value: StoredHistory) => { value.records[0].sourceSha256 = "a".repeat(64); },
  ]) {
    const value = JSON.parse(raw); change(value); await writeFile(path, JSON.stringify(value));
    await assert.rejects(f.store.list(partition), /authority|partition|digest|provenance/);
  }
});

test("equivalent tenant and principal field ordering retains same historical partition", async t => {
  const f = await fixture(t); await f.store.importManifest(f.manifest, f.data, partition);
  assert.equal((await f.store.summary({ principalId: "owner", tenantId: "home" })).total, 1);
});


test("distinct historical sources imported by separate processes survive a shared ledger restart", { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/gai/cognitive-history.ts", import.meta.url).href;
  const program = `import { CognitiveHistoricalLearningStore } from ${JSON.stringify(moduleUrl)}; await new CognitiveHistoricalLearningStore(process.argv[1]).importManifest(process.argv[2], process.argv[3], JSON.parse(process.argv[4]));`;
  const children = new Set<ReturnType<typeof spawn>>();
  t.after(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const manifests = await Promise.all(["first", "second", "third"].map(async id => {
    const path = join(f.root, `manifest-${id}.json`);
    const sourcePath = `${id}.md`;
    await writeFile(join(f.data, sourcePath), `Independent supplied historical record ${id}`);
    await writeFile(path, JSON.stringify({ version: 1, sources: [{ ...f.source, id, path: sourcePath }] }));
    return path;
  }));
  await Promise.all(manifests.map(manifest => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program, f.state, manifest, f.data, JSON.stringify(partition)], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    children.add(child); let error = "";
    child.stderr.on("data", chunk => { error = (error + chunk).slice(-4096); });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error(error || `History process exited ${code}`)));
  })));
  const restored = new CognitiveHistoricalLearningStore(f.state);
  assert.deepEqual((await restored.list(partition)).map(row => row.id).sort(), ["historical:first", "historical:second", "historical:third"]);
  assert.deepEqual(await restored.summary(partition), { total: 3, unverified: 3, verified: 0, sourceKinds: { decision: 3 } });
});
