import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createJarvisStateBackup, verifyJarvisStateBackup } from "./state-backup.ts";
import { restoreJarvisStateBackupToIsolatedPath } from "./state-restore.ts";

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_STORE = 64 * 1024 * 1024;
const MAX_STORAGE = 512 * 1024 * 1024;
const MAX_GENERATIONS = 32;
const MAX_DRILLS = 8;
const OPERATION_LOCK = ".operation.sqlite";
const STORES = ["broker", "compass"] as const;
const COVERAGE = {
  included: ["broker-sqlite", "compass-sqlite"],
  excluded: ["pc-task-json", "pc-observation-json", "configuration-and-credentials", "other-sidecars"],
  consistency: "per-store" as const,
};

export type LocalStateBackupCode = "private_storage_unsupported" | "unsafe_storage" | "source_unavailable" | "resource_limit" | "operation_busy" | "generation_not_found" | "catalog_invalid" | "verification_failed" | "operation_failed" | "invalid_request";
export class LocalStateBackupError extends Error {
  readonly code: LocalStateBackupCode;
  constructor(code: LocalStateBackupCode) { super(code); this.name = "LocalStateBackupError"; this.code = code; }
}
export type LocalStateBackupCommand = { operation: "create" } | { operation: "verify"; generationId: string };
export interface LocalStateBackupStoreMetadata { store: "broker" | "compass"; sha256: string; sizeBytes: number; pagesTransferred: number }
export interface LocalStateBackupGeneration {
  id: string;
  createdAt: string;
  status: "ready" | "verified" | "incomplete";
  stores: LocalStateBackupStoreMetadata[];
  activationAuthorized: false;
  verifiedAt?: string;
}
export interface LocalStateBackupListing {
  capability: { available: boolean; reason: "available" | LocalStateBackupCode };
  coverage: typeof COVERAGE;
  activationAuthorized: false;
  generations: LocalStateBackupGeneration[];
}

function fail(code: LocalStateBackupCode): never { throw new LocalStateBackupError(code); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)); }
function timestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }
export function parseLocalStateBackupCommand(value: unknown): LocalStateBackupCommand {
  if (!object(value)) fail("invalid_request");
  if (value.operation === "create" && exactKeys(value, ["operation"])) return { operation: "create" };
  if (value.operation === "verify" && exactKeys(value, ["operation", "generationId"]) && typeof value.generationId === "string" && ID.test(value.generationId)) return { operation: "verify", generationId: value.generationId };
  fail("invalid_request");
}

async function info(path: string) { return lstat(path).catch(() => undefined); }
function supported() { if (process.platform === "win32" || typeof process.getuid !== "function") fail("private_storage_unsupported"); }

// Inspect, never repair, preexisting protection. A sticky system temp parent is permitted.
async function ancestors(path: string) {
  supported();
  const root = parse(resolve(path)).root;
  let current = root;
  for (const part of resolve(path).slice(root.length).split(/[/\\]/).filter(Boolean)) {
    current = join(current, part);
    const stat = await info(current);
    if (!stat?.isDirectory() || stat.isSymbolicLink() || ![0, process.getuid!()].includes(stat.uid) || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)) fail("unsafe_storage");
  }
}
async function privateDirectory(path: string) {
  const stat = await info(path);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700) fail("unsafe_storage");
}
async function privateFile(path: string, max = MAX_STORE) {
  const stat = await info(path);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600) fail("unsafe_storage");
  if (stat.size < 1 || stat.size > max) fail("resource_limit");
  return stat;
}
async function newDirectory(path: string) {
  await mkdir(path, { mode: 0o700 });
  await privateDirectory(path);
}
async function newJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  await privateFile(path, 8192);
}
async function protectNewArtifacts(directory: string) {
  const names = await readdir(directory);
  if (names.length > 12) fail("resource_limit");
  for (const name of names) {
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid!()) fail("unsafe_storage");
    // The caller allocated this exclusive directory in this operation.
    await chmod(path, 0o600);
  }
}
function generationRecord(value: unknown, id: string): LocalStateBackupGeneration {
  if (!object(value) || !exactKeys(value, ["id", "createdAt", "status", "stores", "activationAuthorized"]) || value.id !== id || !timestamp(value.createdAt) || value.status !== "ready" || value.activationAuthorized !== false || !Array.isArray(value.stores) || value.stores.length !== 2) fail("catalog_invalid");
  const stores = value.stores.map((item, index) => {
    if (!object(item) || !exactKeys(item, ["store", "sha256", "sizeBytes", "pagesTransferred"]) || item.store !== STORES[index] || typeof item.sha256 !== "string" || !HASH.test(item.sha256) || !Number.isSafeInteger(item.sizeBytes) || (item.sizeBytes as number) < 1 || (item.sizeBytes as number) > MAX_STORE || !Number.isSafeInteger(item.pagesTransferred) || (item.pagesTransferred as number) < 1 || (item.pagesTransferred as number) > MAX_STORE / 512) fail("catalog_invalid");
    return { store: item.store, sha256: item.sha256, sizeBytes: item.sizeBytes, pagesTransferred: item.pagesTransferred } as LocalStateBackupStoreMetadata;
  });
  return { id, createdAt: value.createdAt, status: "ready", stores, activationAuthorized: false };
}

interface PrimitiveJob { kind: "local-state-backup-primitive-v1"; operation: "create" | "verify"; sourcePaths: string[]; directory: string; id: string; createdAt: string; expected?: LocalStateBackupStoreMetadata[] }
async function primitive(job: PrimitiveJob): Promise<LocalStateBackupStoreMetadata[]> {
  const result: LocalStateBackupStoreMetadata[] = [];
  for (const [index, store] of STORES.entries()) {
    const backupPath = join(job.directory, `${store}.sqlite`);
    const verified = job.operation === "create"
      ? await createJarvisStateBackup({ sourcePath: job.sourcePaths[index], backupPath, generationId: job.id, now: new Date(job.createdAt) })
      : await verifyJarvisStateBackup(job.sourcePaths[index]);
    const manifest = verified.manifest;
    const expected = job.expected?.[index];
    if (manifest.generationId !== job.id || manifest.createdAt !== job.createdAt || manifest.sizeBytes > MAX_STORE || (expected && (manifest.sha256 !== expected.sha256 || manifest.sizeBytes !== expected.sizeBytes || manifest.pagesTransferred !== expected.pagesTransferred))) fail("verification_failed");
    if (job.operation === "verify") await restoreJarvisStateBackupToIsolatedPath({ backupPath: job.sourcePaths[index], destinationPath: backupPath });
    result.push({ store, sha256: manifest.sha256, sizeBytes: manifest.sizeBytes, pagesTransferred: manifest.pagesTransferred });
  }
  await protectNewArtifacts(job.directory);
  for (const name of await readdir(job.directory)) await privateFile(join(job.directory, name));
  return result;
}
if (!isMainThread && workerData?.kind === "local-state-backup-primitive-v1") {
  void primitive(workerData as PrimitiveJob).then(stores => parentPort?.postMessage({ ok: true, stores }), () => parentPort?.postMessage({ ok: false }));
}
async function runPrimitive(job: PrimitiveJob): Promise<LocalStateBackupStoreMetadata[]> {
  return new Promise((resolveJob, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }, stdout: true, stderr: true });
    // Helpers never log private payloads; still do not forward worker diagnostics.
    worker.stdout?.resume(); worker.stderr?.resume();
    let settled = false;
    const finish = (stores?: LocalStateBackupStoreMetadata[], code?: LocalStateBackupCode) => {
      if (settled) return; settled = true; clearTimeout(timer); clearInterval(quotaTimer);
      void worker.terminate().then(async () => {
        await protectNewArtifacts(job.directory);
        if (stores) resolveJob(stores);
        else reject(new LocalStateBackupError(code ?? (job.operation === "verify" ? "verification_failed" : "operation_failed")));
      }).catch(() => reject(new LocalStateBackupError("operation_failed")));
    };
    const timer = setTimeout(() => finish(), 15_000);
    let inspecting = false;
    const quotaTimer = setInterval(() => {
      if (inspecting || settled) return; inspecting = true;
      void readdir(job.directory).then(async names => {
        if (names.length > 12) return finish(undefined, "resource_limit");
        let bytes = 0;
        for (const name of names) {
          const stat = await info(join(job.directory, name));
          if (!stat) continue; // A helper may have just removed its own temporary copy.
          if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || stat.nlink !== 1) return finish(undefined, "unsafe_storage");
          bytes += stat.size;
          if (stat.size > MAX_STORE || bytes > MAX_STORE * 3) return finish(undefined, "resource_limit");
        }
      }).catch(() => finish()).finally(() => { inspecting = false; });
    }, 100);
    worker.once("message", (value: { ok?: boolean; stores?: LocalStateBackupStoreMetadata[] }) => finish(value.ok && Array.isArray(value.stores) ? value.stores : undefined));
    worker.once("error", () => finish()); worker.once("exit", () => finish());
  });
}

/** Broker-only adapter. Its constructor receives the Broker's existing trusted configuration. */
export class LocalStateBackups {
  private readonly sourcePaths: string[];
  private readonly root: string;
  private busy = false;
  constructor(config: { brokerPath: string; compassPath: string }) {
    this.sourcePaths = [resolve(config.brokerPath), resolve(config.compassPath)];
    this.root = this.sourcePaths[0] + ".state-backups";
  }
  private async sources() {
    supported();
    if (this.sourcePaths[0] === this.sourcePaths[1]) fail("source_unavailable");
    for (const path of this.sourcePaths) {
      await ancestors(dirname(path));
      const stat = await info(path);
      if (!stat) fail("source_unavailable");
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid!()) fail("unsafe_storage");
      const wal = await info(path + "-wal");
      if (wal && (!wal.isFile() || wal.isSymbolicLink() || wal.nlink !== 1 || wal.uid !== process.getuid!())) fail("unsafe_storage");
      const shm = await info(path + "-shm");
      if (shm && (!shm.isFile() || shm.isSymbolicLink() || shm.nlink !== 1 || shm.uid !== process.getuid!())) fail("unsafe_storage");
      if (stat.size < 1) fail("source_unavailable");
      if (stat.size + (wal?.size ?? 0) > MAX_STORE) fail("resource_limit");
    }
  }
  private async storage(create = false) {
    supported(); await ancestors(dirname(this.root));
    if (!(await info(this.root))) {
      if (!create) return false;
      try { await newDirectory(this.root); } catch (error) { if (!(await info(this.root))) throw error; }
    }
    await privateDirectory(this.root);
    // Unknown old-format locks cannot safely be attributed to a dead writer.
    if (await info(join(this.root, ".operation"))) fail("operation_busy");
    if (await info(join(this.root, OPERATION_LOCK))) await this.controlFile();
    return true;
  }
  private async controlFile() {
    const stat = await info(join(this.root, OPERATION_LOCK));
    // This coordinator is always empty: no schema, table or user-state writes.
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.size !== 0) fail("unsafe_storage");
    return stat;
  }
  private async entries() {
    const entries = await readdir(this.root);
    if (entries.includes(OPERATION_LOCK)) await this.controlFile();
    if (entries.length > MAX_GENERATIONS + 1 || entries.some(name => name !== OPERATION_LOCK && !ID.test(name))) fail("catalog_invalid");
    return entries.filter(name => ID.test(name));
  }
  private async budget(path = this.root, depth = 0): Promise<number> {
    if (depth > 2) fail("unsafe_storage");
    await privateDirectory(path);
    const names = await readdir(path);
    if (names.length > (depth === 0 ? MAX_GENERATIONS + 1 : 32)) fail("resource_limit");
    let bytes = 0;
    for (const name of names) {
      if (depth === 0 && name === OPERATION_LOCK) { bytes += (await this.controlFile()).size; continue; }
      const child = join(path, name), stat = await lstat(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) bytes += await this.budget(child, depth + 1);
      else bytes += (await privateFile(child)).size;
      if (bytes > MAX_STORAGE) fail("resource_limit");
    }
    return bytes;
  }
  private async record(id: string): Promise<LocalStateBackupGeneration> {
    const directory = join(this.root, id);
    await privateDirectory(directory);
    const metadataPath = join(directory, "generation.json");
    if (!(await info(metadataPath))) return { id, createdAt: new Date((await lstat(directory)).birthtimeMs).toISOString(), status: "incomplete", stores: [], activationAuthorized: false };
    await privateFile(metadataPath, 8192);
    let value: unknown;
    try { value = JSON.parse(await readFile(metadataPath, "utf8")); } catch { fail("catalog_invalid"); }
    const generation = generationRecord(value, id);
    const children = await readdir(directory);
    if (children.some(name => !["generation.json", "broker.sqlite", "broker.sqlite.manifest.json", "compass.sqlite", "compass.sqlite.manifest.json"].includes(name) && !/^drill-[a-f0-9-]{36}$/.test(name))) fail("catalog_invalid");
    const drills = children.filter(name => name.startsWith("drill-"));
    if (drills.length > MAX_DRILLS) fail("resource_limit");
    for (const name of drills) {
      const resultPath = join(directory, name, "verification.json");
      await privateDirectory(join(directory, name));
      if (!(await info(resultPath))) continue;
      await privateFile(resultPath, 8192);
      let drill: unknown;
      try { drill = JSON.parse(await readFile(resultPath, "utf8")); } catch { fail("catalog_invalid"); }
      if (!object(drill) || !exactKeys(drill, ["generationId", "verifiedAt", "activationAuthorized"]) || drill.generationId !== id || !timestamp(drill.verifiedAt) || drill.activationAuthorized !== false) fail("catalog_invalid");
      if (!generation.verifiedAt || generation.verifiedAt < drill.verifiedAt) { generation.status = "verified"; generation.verifiedAt = drill.verifiedAt; }
    }
    return generation;
  }
  async list(): Promise<LocalStateBackupListing> {
    try {
      await this.sources();
      const generations: LocalStateBackupGeneration[] = [];
      if (await this.storage()) { await this.budget(); for (const id of await this.entries()) generations.push(await this.record(id)); }
      return { capability: { available: true, reason: "available" }, coverage: COVERAGE, activationAuthorized: false, generations: generations.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    } catch (error) {
      return { capability: { available: false, reason: error instanceof LocalStateBackupError ? error.code : "operation_failed" }, coverage: COVERAGE, activationAuthorized: false, generations: [] };
    }
  }
  private async operation<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy) fail("operation_busy"); this.busy = true;
    let lock: DatabaseSync | undefined;
    try {
      await this.storage(true);
      const path = join(this.root, OPERATION_LOCK);
      try { const created = await open(path, "wx", 0o600); await created.close(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.controlFile();
      // Reserve one native writer slot. Never unlink this inode:
      // the OS releases its transaction on process death, without PID/reaper races.
      lock = new DatabaseSync(path);
      // This empty, coordination-only connection needs no on-disk rollback journal.
      // MEMORY avoids a catalog sidecar; IMMEDIATE permits concurrent readers.
      try { lock.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=MEMORY; BEGIN IMMEDIATE"); }
      catch { fail("operation_busy"); }
      return await run();
    } catch (error) { throw error instanceof LocalStateBackupError ? error : new LocalStateBackupError("operation_failed"); }
    finally { try { lock?.close(); } finally { this.busy = false; } }
  }
  async create(): Promise<LocalStateBackupGeneration> {
    return this.operation(async () => {
      await this.sources(); const entries = await this.entries();
      // Include the helper's temporary copy in the worst-case storage reservation.
      if (entries.length >= MAX_GENERATIONS || await this.budget() + MAX_STORE * 3 > MAX_STORAGE) fail("resource_limit");
      const id = randomUUID(), directory = join(this.root, id), createdAt = new Date().toISOString();
      await newDirectory(directory);
      const stores = await runPrimitive({ kind: "local-state-backup-primitive-v1", operation: "create", sourcePaths: this.sourcePaths, directory, id, createdAt });
      const generation: LocalStateBackupGeneration = { id, createdAt, status: "ready", stores, activationAuthorized: false };
      await newJson(join(directory, "generation.json"), generation); return generation;
    });
  }
  async verify(id: string): Promise<LocalStateBackupGeneration> {
    if (!ID.test(id)) fail("invalid_request");
    return this.operation(async () => {
      if (!(await this.entries()).includes(id)) fail("generation_not_found");
      const generation = await this.record(id), directory = join(this.root, id);
      if (generation.status === "incomplete") fail("verification_failed");
      // Check artifacts before the resource scan, so a substituted symlink is an explicit rejection.
      for (const store of STORES) { await privateFile(join(directory, `${store}.sqlite`)); await privateFile(join(directory, `${store}.sqlite.manifest.json`), 8192); }
      // Reject changed content against the catalog before reserving a new drill directory.
      for (const item of generation.stores) {
        const digest = createHash("sha256").update(await readFile(join(directory, `${item.store}.sqlite`))).digest("hex");
        if (digest !== item.sha256) fail("verification_failed");
      }
      if ((await readdir(directory)).filter(name => name.startsWith("drill-")).length >= MAX_DRILLS || await this.budget() + MAX_STORE * 3 > MAX_STORAGE) fail("resource_limit");
      const drill = join(directory, "drill-" + randomUUID()); await newDirectory(drill);
      await runPrimitive({ kind: "local-state-backup-primitive-v1", operation: "verify", sourcePaths: STORES.map(store => join(directory, `${store}.sqlite`)), directory: drill, id, createdAt: generation.createdAt, expected: generation.stores });
      const verifiedAt = new Date().toISOString();
      await newJson(join(drill, "verification.json"), { generationId: id, verifiedAt, activationAuthorized: false });
      return { ...generation, status: "verified", verifiedAt, activationAuthorized: false };
    });
  }
}
