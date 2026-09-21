import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { JarvisControlPlane, JarvisSqliteStateStore } from "../src/jarvis/index.ts";
import { createJarvisStateBackup, verifyJarvisStateBackup } from "../src/jarvis/state-backup.ts";

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-ops015-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createSource(path: string): Promise<JarvisSqliteStateStore> {
  const store = new JarvisSqliteStateStore(path);
  const controlPlane = new JarvisControlPlane();
  store.save(controlPlane.snapshot(new Date("2026-09-21T14:45:00.000Z")));
  return store;
}

test("OPS-015 creates a new integrity-checked backup generation while the source remains usable", async () => {
  await withTempDir(async (directory) => {
    const sourcePath = join(directory, "state.db");
    const backupPath = join(directory, "backups", "generation-001.db");
    const store = await createSource(sourcePath);

    const verified = await createJarvisStateBackup({
      sourcePath,
      backupPath,
      now: new Date("2026-09-21T14:46:00.000Z"),
      generationId: "generation-001",
    });

    assert.equal(verified.manifest.formatVersion, 1);
    assert.equal(verified.manifest.generationId, "generation-001");
    assert.equal(verified.manifest.createdAt, "2026-09-21T14:46:00.000Z");
    assert.equal(verified.manifest.databaseFile, "generation-001.db");
    assert.equal(verified.manifest.hashAlgorithm, "sha256");
    assert.match(verified.manifest.sha256, /^[a-f0-9]{64}$/);
    assert(verified.manifest.sizeBytes > 0);
    assert(verified.manifest.pagesTransferred > 0);
    assert.equal(verified.manifest.quickCheck, "ok");

    const backupDb = new DatabaseSync(backupPath);
    try {
      const row = backupDb.prepare("SELECT payload FROM jarvis_state WHERE id = 1").get() as { payload?: string } | undefined;
      assert(row?.payload);
      const snapshot = JSON.parse(row.payload) as { generatedAt?: string };
      assert.equal(snapshot.generatedAt, "2026-09-21T14:45:00.000Z");
    } finally {
      backupDb.close();
    }

    store.save(new JarvisControlPlane().snapshot(new Date("2026-09-21T14:47:00.000Z")));
    assert.equal(store.load()?.generatedAt, "2026-09-21T14:47:00.000Z");
    store.close();
  });
});

test("OPS-015 never silently overwrites an existing backup generation", async () => {
  await withTempDir(async (directory) => {
    const sourcePath = join(directory, "state.db");
    const backupPath = join(directory, "generation.db");
    const store = await createSource(sourcePath);
    await createJarvisStateBackup({ sourcePath, backupPath, generationId: "generation-a" });

    await assert.rejects(
      createJarvisStateBackup({ sourcePath, backupPath, generationId: "generation-b" }),
      /backup_generation_exists/,
    );
    store.close();
  });
});

test("OPS-015 verification fails closed when the backup artifact is corrupted", async () => {
  await withTempDir(async (directory) => {
    const sourcePath = join(directory, "state.db");
    const backupPath = join(directory, "generation.db");
    const store = await createSource(sourcePath);
    await createJarvisStateBackup({ sourcePath, backupPath, generationId: "generation-corrupt" });
    store.close();

    const bytes = await readFile(backupPath);
    bytes[0] = bytes[0] === 0 ? 1 : bytes[0] ^ 1;
    await writeFile(backupPath, bytes);

    await assert.rejects(verifyJarvisStateBackup(backupPath), /backup_digest_mismatch/);
  });
});

test("OPS-015 rejects a backup destination that is the source database", async () => {
  await withTempDir(async (directory) => {
    const sourcePath = join(directory, "state.db");
    const store = await createSource(sourcePath);
    await assert.rejects(
      createJarvisStateBackup({ sourcePath, backupPath: sourcePath }),
      /backup_destination_must_differ_from_source/,
    );
    store.close();
  });
});
