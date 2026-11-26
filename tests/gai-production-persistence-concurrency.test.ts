import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProductionAutonomyRuntime, type ProductionRunRecord } from "../src/gai/production-autonomy-runtime.ts";
import { GoalDrivenLoop, type Goal } from "../src/orchestrator/goal-loop.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function goal(runId: string): Goal {
  return { title: runId, successCriteria: ["public artifact bytes independently verified"], constraints: ["local public fixture only"] };
}

async function fixture(options: { directory?: string; steps?: Record<string, number>; completed?: (runId: string) => void } = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), "production-persistence-"));
  const path = join(directory, "runs.json");
  const calls = { factories: 0, executions: 0, verifications: 0, writeBacks: 0, verifiedHooks: 0, completionHooks: 0 };
  const factory = (runId: string) => {
    calls.factories += 1;
    let step = 0;
    return new GoalDrivenLoop(
      {
        inferIntent: async () => ({ summary: runId, confidence: 1, evidence: [] }),
        proposeNextAction: async () => {
          step += 1;
          return {
            id: `${runId}-${step}`, description: `write public artifact ${runId}-${step}`, capability: "fixture-local-file",
            risk: "low", completesBoundedCommand: step >= (options.steps?.[runId] ?? 1),
          };
        },
      },
      [],
      {
        execute: async (action) => {
          calls.executions += 1;
          await writeFile(join(directory, `${action.id}.txt`), `PUBLIC:${action.id}\n`, { flag: "wx" });
          return { actionId: action.id, ok: true, summary: "public artifact written" };
        },
      },
      {
        verify: async ({ action }) => {
          calls.verifications += 1;
          const artifact = join(directory, `${action.id}.txt`);
          const bytes = await readFile(artifact, "utf8");
          return {
            ok: bytes === `PUBLIC:${action.id}\n`, summary: "actual public artifact bytes verified",
            evidence: { artifact, sha256: createHash("sha256").update(bytes).digest("hex") },
          };
        },
      },
      {
        getState: async () => ({ completed: [], blockers: [], nextAction: null }),
        writeBack: async () => { calls.writeBacks += 1; },
      },
    );
  };
  const runtime = new ProductionAutonomyRuntime(path, factory, {
    onVerifiedCycle: async () => { calls.verifiedHooks += 1; },
    onVerifiedCompletion: async (report) => {
      calls.completionHooks += 1;
      options.completed?.(report.goal.title);
    },
  });
  return { directory, path, calls, runtime, factory, run: (runId: string) => runtime.run({ runId, goal: goal(runId), maxCycles: 4 }) };
}

// Only scheduling of owned filesystem calls is controlled. Every artifact,
// snapshot, read, write, and rename still goes through the real filesystem.
function syncMock(t: TestContext) {
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

async function assertRestored(f: Awaited<ReturnType<typeof fixture>>, expected: Record<string, number>) {
  const disk = JSON.parse(await readFile(f.path, "utf8")) as { version: number; runs: ProductionRunRecord[] };
  assert.equal(disk.version, 1);
  assert.deepEqual(disk.runs.map((record) => record.runId).sort(), Object.keys(expected).sort());
  const restarted = new ProductionAutonomyRuntime(f.path, f.factory);
  const before = { ...f.calls };
  for (const [runId, cycles] of Object.entries(expected)) {
    const record = await restarted.run({ runId, goal: goal(runId) });
    assert.equal(record.state, "completed");
    assert.equal(record.cycles, cycles);
    assert.equal(record.verificationHistory?.length, cycles);
    assert.equal(record.completionEvidence.length, cycles);
    for (let step = 1; step <= cycles; step += 1) {
      const artifact = join(f.directory, `${runId}-${step}.txt`);
      const bytes = await readFile(artifact, "utf8");
      assert.equal(bytes, `PUBLIC:${runId}-${step}\n`);
      assert.deepEqual(record.completionEvidence[step - 1], {
        artifact, sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  assert.deepEqual(f.calls, before, "reloaded completed runs must not repeat execution or hooks");
  assert.equal((await readdir(f.directory)).some((name) => name.endsWith(".tmp")), false, "commits leave no temporary files");
}

test("sequential public runs retain verifier evidence and remain idempotent before and after reload", async () => {
  const f = await fixture();
  await f.run("alpha");
  await f.run("beta");
  const before = { ...f.calls };
  assert.equal((await f.run("alpha")).state, "completed");
  assert.deepEqual(f.calls, before);
  await assertRestored(f, { alpha: 1, beta: 1 });
  assert.equal(f.calls.executions, 2);
  assert.equal(f.calls.completionHooks, 2);
});

test("overlapping distinct public runs serialize commits and retain every latest cycle on reload", async (t) => {
  const firstCommit = deferred();
  const releaseCommit = deferred();
  const betaCompleted = deferred();
  const f = await fixture({ steps: { alpha: 2 }, completed: (id) => { if (id === "beta") betaCompleted.resolve(); } });
  // The file is initially absent; loading is exercised separately below.
  await f.runtime.get("preload");
  const nativeMkdir = fs.mkdir;
  const nativeRename = fs.rename;
  let active = 0;
  let maxActive = 0;
  let first = true;
  t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
    if (args[0] === dirname(f.path)) { active += 1; maxActive = Math.max(maxActive, active); }
    return nativeMkdir(...args);
  });
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] !== f.path) return nativeRename(...args);
    if (first) { first = false; firstCommit.resolve(); await releaseCommit.promise; }
    try { return await nativeRename(...args); } finally { active -= 1; }
  });
  syncMock(t);
  const alpha = f.run("alpha");
  await firstCommit.promise;
  const beta = f.run("beta");
  const settled = Promise.allSettled([alpha, beta]);
  await betaCompleted.promise;
  // Let the completed hook return and both callers request their commits.
  // These are microtask turns, not timing-based filesystem sleeps.
  await Promise.resolve();
  await Promise.resolve();
  releaseCommit.resolve();
  const results = await settled;
  assert.equal(maxActive, 1, "a later snapshot must not commit while an earlier commit is pending");
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  await assertRestored(f, { alpha: 2, beta: 1 });
  assert.equal(f.calls.executions, 3);
  assert.equal(f.calls.verifiedHooks, 3);
  assert.equal(f.calls.completionHooks, 2);
});

test("concurrent first use loads an existing snapshot once and preserves its records", async (t) => {
  const seed = await fixture();
  await seed.run("seed");
  const f = await fixture({ directory: seed.directory });
  const enteredRead = deferred();
  const releaseRead = deferred();
  const nativeRead = fs.readFile;
  let reads = 0;
  t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] !== f.path) return nativeRead(...args);
    reads += 1;
    const snapshot = await nativeRead(...args);
    enteredRead.resolve();
    await releaseRead.promise;
    return snapshot;
  });
  syncMock(t);
  const alpha = f.run("alpha");
  await enteredRead.promise;
  const beta = f.run("beta");
  const readsAtConcurrentEntry = reads;
  const settled = Promise.allSettled([alpha, beta]);
  releaseRead.resolve();
  const results = await settled;
  assert.equal(readsAtConcurrentEntry, 1, "late initial reads must not replace the live run collection");
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  t.mock.restoreAll();
  syncBuiltinESMExports();
  await assertRestored(f, { seed: 1, alpha: 1, beta: 1 });
});

test("a real final-destination rename failure retries the same terminal run durably without repeating effects", async () => {
  const f = await fixture();
  await f.runtime.get("preload");
  await mkdir(f.path);
  await assert.rejects(f.run("retry"), { code: "EISDIR" });
  const before = { ...f.calls };
  assert.deepEqual(before, { factories: 1, executions: 1, verifications: 1, writeBacks: 1, verifiedHooks: 1, completionHooks: 1 });
  await rename(f.path, join(f.directory, "retained-destination-collision"));
  assert.equal((await f.run("retry")).state, "completed");
  assert.deepEqual(f.calls, before, "save retries must not execute or verify the completed action or repeat its hooks");
  await assertRestored(f, { retry: 1 });
});

test("a failed queued commit remains visible to its caller and does not poison later commits", async (t) => {
  const firstCommit = deferred();
  const releaseCommit = deferred();
  const laterCompleted = deferred();
  const f = await fixture({ completed: (id) => { if (id === "later") laterCompleted.resolve(); } });
  await f.run("seed");
  const lastGood = await readFile(f.path, "utf8");
  const collision = join(f.directory, "retained-rename-collision");
  await mkdir(collision);
  const nativeRename = fs.rename;
  let first = true;
  let preservedLastGood = false;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] !== f.path || !first) return nativeRename(...args);
    first = false;
    firstCommit.resolve();
    await releaseCommit.promise;
    // Trigger an actual owned-filesystem rename error while retaining the
    // existing committed destination bytes for an independent readback.
    try { return await nativeRename(args[0], collision); }
    catch (error) { preservedLastGood = await readFile(f.path, "utf8") === lastGood; throw error; }
  });
  syncMock(t);
  const failed = f.run("failed-save");
  await firstCommit.promise;
  const later = f.run("later");
  const settled = Promise.allSettled([failed, later]);
  await laterCompleted.promise;
  await Promise.resolve();
  await Promise.resolve();
  releaseCommit.resolve();
  const [failedResult, laterResult] = await settled;
  assert.equal(failedResult?.status, "rejected");
  if (failedResult?.status === "rejected") assert.equal((failedResult.reason as NodeJS.ErrnoException).code, "EISDIR");
  assert.equal(preservedLastGood, true, "failed atomic replacement must retain the last good committed snapshot");
  assert.equal(laterResult?.status, "fulfilled");
  const before = { ...f.calls };
  assert.equal((await f.run("failed-save")).state, "completed");
  assert.deepEqual(f.calls, before);
  await assertRestored(f, { seed: 1, "failed-save": 1, later: 1 });
  assert.equal(f.calls.executions, 3);
});

test("exclusive temporary-file collision preserves preexisting bytes and permits a durable same-run retry", async (t) => {
  const { default: crypto } = await import("node:crypto");
  const f = await fixture();
  const collisionId = "00000000-0000-4000-8000-000000000000";
  const collision = `${f.path}.${collisionId}.tmp`;
  const originalBytes = "PUBLIC:preexisting-owned-fixture\n";
  await writeFile(collision, originalBytes, { flag: "wx" });
  t.mock.method(crypto, "randomUUID", () => collisionId);
  syncMock(t);
  await assert.rejects(f.run("temp-collision"), { code: "EEXIST" });
  assert.equal(await readFile(collision, "utf8"), originalBytes, "an attempt that could not create a temp file must not unlink it");
  const before = { ...f.calls };
  await rename(collision, join(f.directory, "retained-temporary-collision"));
  assert.equal((await f.run("temp-collision")).state, "completed");
  assert.deepEqual(f.calls, before);
  await assertRestored(f, { "temp-collision": 1 });
});
