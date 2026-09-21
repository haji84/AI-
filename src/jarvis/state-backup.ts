import { constants as fsConstants, createReadStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";

export interface JarvisStateBackupManifest {
  formatVersion: 1;
  generationId: string;
  createdAt: string;
  databaseFile: string;
  hashAlgorithm: "sha256";
  sha256: string;
  sizeBytes: number;
  pagesTransferred: number;
  quickCheck: "ok";
}

export interface CreateJarvisStateBackupOptions {
  sourcePath: string;
  backupPath: string;
  now?: Date;
  generationId?: string;
}

export interface VerifiedJarvisStateBackup {
  backupPath: string;
  manifestPath: string;
  manifest: JarvisStateBackupManifest;
}

const SHA256 = /^[a-f0-9]{64}$/;

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
    if (row?.quick_check !== "ok") throw new Error("backup_sqlite_integrity_failed");
    return "ok";
  } finally {
    db.close();
  }
}

function parseManifest(raw: string, backupPath: string): JarvisStateBackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("backup_manifest_invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("backup_manifest_invalid");
  const manifest = value as Partial<JarvisStateBackupManifest>;
  if (manifest.formatVersion !== 1) throw new Error("backup_manifest_format_unsupported");
  if (typeof manifest.generationId !== "string" || !manifest.generationId.trim()) throw new Error("backup_generation_id_invalid");
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) throw new Error("backup_created_at_invalid");
  if (manifest.databaseFile !== basename(backupPath)) throw new Error("backup_manifest_database_mismatch");
  if (manifest.hashAlgorithm !== "sha256") throw new Error("backup_hash_algorithm_unsupported");
  if (typeof manifest.sha256 !== "string" || !SHA256.test(manifest.sha256)) throw new Error("backup_digest_invalid");
  if (!Number.isSafeInteger(manifest.sizeBytes) || (manifest.sizeBytes ?? -1) < 1) throw new Error("backup_size_invalid");
  if (!Number.isSafeInteger(manifest.pagesTransferred) || (manifest.pagesTransferred ?? -1) < 1) throw new Error("backup_page_count_invalid");
  if (manifest.quickCheck !== "ok") throw new Error("backup_manifest_integrity_unverified");
  return manifest as JarvisStateBackupManifest;
}

export async function verifyJarvisStateBackup(
  backupPath: string,
  manifestPath = `${backupPath}.manifest.json`,
): Promise<VerifiedJarvisStateBackup> {
  const resolvedBackup = resolve(backupPath);
  const resolvedManifest = resolve(manifestPath);
  const manifest = parseManifest(await readFile(resolvedManifest, "utf8"), resolvedBackup);
  const fileStat = await stat(resolvedBackup);
  if (!fileStat.isFile()) throw new Error("backup_artifact_not_file");
  if (fileStat.size !== manifest.sizeBytes) throw new Error("backup_size_mismatch");
  const digest = await sha256File(resolvedBackup);
  if (digest !== manifest.sha256) throw new Error("backup_digest_mismatch");
  quickCheck(resolvedBackup);
  return { backupPath: resolvedBackup, manifestPath: resolvedManifest, manifest };
}

export async function createJarvisStateBackup(
  options: CreateJarvisStateBackupOptions,
): Promise<VerifiedJarvisStateBackup> {
  const sourcePath = resolve(options.sourcePath);
  const backupPath = resolve(options.backupPath);
  const manifestPath = `${backupPath}.manifest.json`;
  if (sourcePath === backupPath) throw new Error("backup_destination_must_differ_from_source");

  const sourceStat = await stat(sourcePath).catch(() => undefined);
  if (!sourceStat?.isFile()) throw new Error("backup_source_missing");
  if (await exists(backupPath) || await exists(manifestPath)) throw new Error("backup_generation_exists");

  await mkdir(dirname(backupPath), { recursive: true });
  const temporaryPath = `${backupPath}.tmp-${randomUUID()}`;
  const source = new DatabaseSync(sourcePath);
  let destinationCreated = false;
  try {
    const pagesTransferred = await backup(source, temporaryPath);
    source.close();
    quickCheck(temporaryPath);
    const temporaryStat = await stat(temporaryPath);
    const manifest: JarvisStateBackupManifest = {
      formatVersion: 1,
      generationId: options.generationId?.trim() || randomUUID(),
      createdAt: (options.now ?? new Date()).toISOString(),
      databaseFile: basename(backupPath),
      hashAlgorithm: "sha256",
      sha256: await sha256File(temporaryPath),
      sizeBytes: temporaryStat.size,
      pagesTransferred,
      quickCheck: "ok",
    };
    if (!manifest.generationId) throw new Error("backup_generation_id_invalid");

    await copyFile(temporaryPath, backupPath, fsConstants.COPYFILE_EXCL);
    destinationCreated = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rm(temporaryPath, { force: true });
    return verifyJarvisStateBackup(backupPath, manifestPath);
  } catch (error) {
    try { source.close(); } catch { /* already closed */ }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (destinationCreated) await rm(backupPath, { force: true }).catch(() => undefined);
    await rm(manifestPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
