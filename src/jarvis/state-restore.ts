import { constants as fsConstants, createReadStream } from "node:fs";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { verifyJarvisStateBackup } from "./state-backup.ts";

export interface RestoreJarvisStateBackupOptions {
  backupPath: string;
  destinationPath: string;
  manifestPath?: string;
}

export interface JarvisStateRestoreDrillResult {
  sourceGenerationId: string;
  backupPath: string;
  restoredPath: string;
  sha256: string;
  quickCheck: "ok";
  activationAuthorized: false;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function quickCheck(path: string): "ok" {
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: unknown } | undefined;
    if (row?.quick_check !== "ok") throw new Error("restored_sqlite_integrity_failed");
    return "ok";
  } finally {
    db.close();
  }
}

export async function restoreJarvisStateBackupToIsolatedPath(
  options: RestoreJarvisStateBackupOptions,
): Promise<JarvisStateRestoreDrillResult> {
  const backupPath = resolve(options.backupPath);
  const destinationPath = resolve(options.destinationPath);
  if (backupPath === destinationPath) throw new Error("restore_destination_must_differ_from_backup");
  if (await exists(destinationPath)) throw new Error("restore_destination_exists");

  const verified = await verifyJarvisStateBackup(backupPath, options.manifestPath);
  await mkdir(dirname(destinationPath), { recursive: true });

  const temporaryPath = `${destinationPath}.tmp-${randomUUID()}`;
  try {
    await copyFile(backupPath, temporaryPath, fsConstants.COPYFILE_EXCL);
    quickCheck(temporaryPath);
    const temporaryDigest = await sha256File(temporaryPath);
    if (temporaryDigest !== verified.manifest.sha256) throw new Error("restore_digest_mismatch");

    await copyFile(temporaryPath, destinationPath, fsConstants.COPYFILE_EXCL);
    const finalDigest = await sha256File(destinationPath);
    if (finalDigest !== verified.manifest.sha256) throw new Error("restore_final_digest_mismatch");
    quickCheck(destinationPath);

    return {
      sourceGenerationId: verified.manifest.generationId,
      backupPath,
      restoredPath: destinationPath,
      sha256: finalDigest,
      quickCheck: "ok",
      activationAuthorized: false,
    };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
