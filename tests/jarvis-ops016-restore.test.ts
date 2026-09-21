import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisControlPlane, JarvisSqliteStateStore } from "../src/jarvis/index.ts";
import { createJarvisStateBackup } from "../src/jarvis/state-backup.ts";
import { restoreJarvisStateBackupToIsolatedPath } from "../src/jarvis/state-restore.ts";

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-ops016-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createBackup(directory: string): Promise<{ backupPath: string; sourcePath: string }> {
  const sourcePath = join(directory, "live", "state.db");
  const backupPath = join(directory, "backups", "generation-001.db");
  const store = new JarvisSqliteStateStore(sourcePath);
  store.save(new JarvisControlPlane().snapshot(new Date("2026-09-21T15:00:00.000Z")));
  await createJarvisStateBackup({
    sourcePath,
    backupPath,
    generationId: "generation-001",
    now: new Date("2026-09-21T15:01:00.000Z"),
  });
  store.close();
  return { backupPath, sourcePath };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

test("OPS-016 restores a verified generation to a fresh isolated path without authorizing activation", async () => {
  await withTempDir(async (directory) => {
    const { backupPath } = await createBackup(directory);
    const restoredPath = join(directory, "restore-drill", "state.db");

    const result = await restoreJarvisStateBackupToIsolatedPath({ backupPath, destinationPath: restoredPath });
    assert.equal(result.sourceGenerationId, "generation-001");
    assert.equal(result.restoredPath, restoredPath);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.quickCheck, "ok");
    assert.equal(result.activationAuthorized, false);

    const restoredStore = new JarvisSqliteStateStore(restoredPath);
    try {
      assert.equal(restoredStore.load()?.generatedAt, "2026-09-21T15:00:00.000Z");
    } finally {
      restoredStore.close();
    }
  });
});

test("OPS-016 refuses to overwrite an existing restore destination", async () => {
  await withTempDir(async (directory) => {
    const { backupPath } = await createBackup(directory);
    const restoredPath = join(directory, "existing.db");
    await writeFile(restoredPath, "keep-me", "utf8");

    await assert.rejects(
      restoreJarvisStateBackupToIsolatedPath({ backupPath, destinationPath: restoredPath }),
      /restore_destination_exists/,
    );
    assert.equal(await readFile(restoredPath, "utf8"), "keep-me");
  });
});

test("OPS-016 rejects a corrupted backup before creating a restore destination", async () => {
  await withTempDir(async (directory) => {
    const { backupPath } = await createBackup(directory);
    const restoredPath = join(directory, "restore", "state.db");
    const bytes = await readFile(backupPath);
    bytes[0] = bytes[0] === 0 ? 1 : bytes[0] ^ 1;
    await writeFile(backupPath, bytes);

    await assert.rejects(
      restoreJarvisStateBackupToIsolatedPath({ backupPath, destinationPath: restoredPath }),
      /backup_digest_mismatch/,
    );
    assert.equal(await pathExists(restoredPath), false);
  });
});

test("OPS-016 rejects restoring a backup onto itself", async () => {
  await withTempDir(async (directory) => {
    const { backupPath } = await createBackup(directory);
    await assert.rejects(
      restoreJarvisStateBackupToIsolatedPath({ backupPath, destinationPath: backupPath }),
      /restore_destination_must_differ_from_backup/,
    );
  });
});
