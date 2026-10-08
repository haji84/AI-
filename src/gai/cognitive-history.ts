import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { acquireCognitiveLease } from "./cognitive-lease.ts";
import { CognitiveLearningEngine, cognitiveLearningText, type CognitiveLearningPartition } from "./cognitive-learning.ts";
import { buildTrainingCandidateDataset, importHistoricalLearning, prepareCognitiveTrainingDataset,
  type HistoricalSourceKind, type LearningDataCandidate, type TrainingCandidateDataset } from "./cognitive-learning-data.ts";

interface HistoricalArtifact {
  id: string; path: string; kind: HistoricalSourceKind; familyId: string;
  classification: "public" | "internal"; scope: "owner" | "tester-private"; split?: "train" | "validation" | "heldout";
}
export interface CognitiveHistoryManifest { version: 1; sources: HistoricalArtifact[] }
interface HistoricalRecord { rootDigest: string; path: string; sourceSha256: string; candidate: LearningDataCandidate }
interface HistoryFile { version: 1; partition: CognitiveLearningPartition; records: HistoricalRecord[] }
const MAX_SOURCE = 8192; const MAX_MANIFEST = 32_768; const MAX_BATCH = 131_072;
const MAX_RECORDS = 500; const MAX_STORE = 5_242_880;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const pending = new Map<string, Promise<unknown>>();
function shape(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw Error(`Invalid ${label} schema`);
}
function id(value: unknown, name: string, max = 128): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^[a-zA-Z0-9:_-]{1,${max}}$`).test(value)) throw Error(`Invalid historical ${name}`);
}
function pathParts(value: unknown): string[] {
  if (typeof value !== "string" || !value || value.length > 128 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || isAbsolute(value) || win32.isAbsolute(value) || value.includes(":")) throw Error("Historical path outside allowed scope");
  const parts = value.split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:\.git|\.codex|\.ssh|\.env.*|credentials?)$/i.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Historical path outside allowed scope");
  return parts;
}
async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw Error("Historical file exceeds bound or is unsafe");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const initial = await file.stat();
    if (!initial.isFile() || initial.size > maximum || initial.dev !== before.dev || initial.ino !== before.ino) throw Error("Historical file changed before bounded read");
    const bytes = Buffer.alloc(maximum + 1); let length = 0;
    while (length < bytes.length) { const chunk = await file.read(bytes, length, bytes.length - length, length); if (!chunk.bytesRead) break; length += chunk.bytesRead; }
    const after = await file.stat();
    if (length > maximum || length !== initial.size || initial.size !== after.size || initial.mtimeMs !== after.mtimeMs) throw Error("Historical file changed or exceeded bound");
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
function decode(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw Error("Historical file contains invalid UTF-8"); }
}
async function safeDirectory(path: string, create: boolean): Promise<string> {
  if (create) await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe historical directory or symlink");
  return realpath(path);
}
async function artifactPath(root: string, path: string): Promise<string> {
  let target = root;
  for (const part of pathParts(path)) { target = join(target, part); if ((await lstat(target)).isSymbolicLink()) throw Error("Symlink historical source forbidden"); }
  const actual = await realpath(target); const rel = relative(root, actual);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) throw Error("Historical source outside allowed scope");
  return actual;
}
function descriptor(value: unknown): HistoricalArtifact {
  shape(value, ["id", "path", "kind", "familyId", "classification", "scope", "split"], "historical source");
  id(value.id, "source ID", 96); id(value.familyId, "family ID"); pathParts(value.path);
  if (value.scope !== "owner" && value.scope !== "tester-private") throw Error("Invalid historical private scope");
  if (value.classification !== "public" && value.classification !== "internal") throw Error("Invalid historical classification schema");
  if (value.split !== undefined && !["train", "validation", "heldout"].includes(value.split as string)) throw Error("Invalid historical split schema");
  // Delegate source-kind and all text/privacy validation to the existing importer.
  const source = value as unknown as HistoricalArtifact;
  importHistoricalLearning([{ id: source.id, kind: source.kind, sourceRef: "historical-schema", content: "metadata validation", sha256: digest("metadata validation"),
    partition: { tenantId: "validation", principalId: "validation" }, scope: source.scope, classification: source.classification, familyId: source.familyId }], { tenantId: "validation", principalId: "validation" });
  return { id: source.id, path: pathParts(source.path).join("/"), kind: source.kind, familyId: source.familyId,
    classification: source.classification, scope: source.scope, ...(source.split ? { split: source.split } : {}) };
}
function sourceReference(rootDigest: string, path: string, sourceSha256: string): string { return `local-history:${rootDigest}/${path}@sha256:${sourceSha256}`; }
function validateRecord(value: unknown, partition: CognitiveLearningPartition): HistoricalRecord {
  shape(value, ["rootDigest", "path", "sourceSha256", "candidate"], "historical record");
  if (typeof value.rootDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.rootDigest) || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256)) throw Error("Invalid historical provenance digest");
  pathParts(value.path);
  shape(value.candidate, ["id", "sourceRef", "sourceKind", "content", "sha256", "partition", "scope", "classification", "familyId", "status", "evidenceRefs", "split"], "historical candidate");
  const candidate = value.candidate as unknown as LearningDataCandidate;
  if (candidate.status !== "UNVERIFIED" || !Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length || !["owner", "tester-private"].includes(candidate.scope) ||
    candidate.sourceRef !== sourceReference(value.rootDigest, value.path as string, value.sourceSha256) || !candidate.id.startsWith("historical:")) throw Error("Historical candidate authority or provenance mismatch");
  const validated = importHistoricalLearning([{ id: candidate.id, kind: candidate.sourceKind, sourceRef: candidate.sourceRef, content: candidate.content,
    sha256: candidate.sha256, partition: candidate.partition, scope: candidate.scope, classification: candidate.classification, familyId: candidate.familyId, ...(candidate.split ? { split: candidate.split } : {}) }], partition)[0];
  if (!validated || JSON.stringify(validated) !== JSON.stringify(candidate)) throw Error("Historical candidate storage mismatch");
  return { rootDigest: value.rootDigest, path: value.path as string, sourceSha256: value.sourceSha256, candidate: validated };
}

/** Explicit host-authorized local history import; raw claims never become runtime knowledge or verified training data. */
export class CognitiveHistoricalLearningStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private target(partition: CognitiveLearningPartition): string {
    return join(dirname(new CognitiveLearningEngine(this.directory).partitionPath(partition, "experience.json")), "history.json");
  }
  private async serial<T>(partition: CognitiveLearningPartition, work: (target: string) => Promise<T>): Promise<T> {
    const target = this.target(partition); const previous = pending.get(target) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const root = await safeDirectory(this.directory, true); await safeDirectory(dirname(target), true);
      if (relative(root, await realpath(dirname(target))).startsWith("..")) throw Error("Historical storage outside scope");
      const release = await acquireCognitiveLease(target + ".lock", 2000);
      try { return await work(target); } finally { await release(); }
    });
    pending.set(target, current);
    try { return await current; } finally { if (pending.get(target) === current) pending.delete(target); }
  }
  private async load(target: string, partition: CognitiveLearningPartition): Promise<HistoricalRecord[]> {
    let bytes: Buffer;
    try { bytes = await boundedRead(target, MAX_STORE); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const value: unknown = JSON.parse(decode(bytes)); shape(value, ["version", "partition", "records"], "history storage");
    if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS || JSON.stringify(value.partition) !== JSON.stringify(partition)) throw Error("Historical storage partition or bound mismatch");
    const records = value.records.map(row => validateRecord(row, partition));
    if (new Set(records.map(row => row.candidate.id)).size !== records.length) throw Error("Historical duplicate source ID");
    return records;
  }
  async importManifest(manifestPath: string, dataRoot: string, partition: CognitiveLearningPartition): Promise<{ imported: number; existing: number; total: number }> {
    this.target(partition); partition = { tenantId: partition.tenantId, principalId: partition.principalId };
    const manifest: unknown = JSON.parse(decode(await boundedRead(resolve(manifestPath), MAX_MANIFEST)));
    shape(manifest, ["version", "sources"], "history manifest");
    if (manifest.version !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 24) throw Error("Historical manifest descriptor bound exceeded");
    const sources = manifest.sources.map(descriptor);
    if (new Set(sources.map(source => source.id)).size !== sources.length) throw Error("Historical source ID conflict");
    const root = await safeDirectory(resolve(dataRoot), false); const rootDigest = digest(root); let totalBytes = 0;
    const incoming: HistoricalRecord[] = [];
    for (const source of sources) {
      const bytes = await boundedRead(await artifactPath(root, source.path), MAX_SOURCE); totalBytes += bytes.length;
      if (totalBytes > MAX_BATCH) throw Error("Historical batch byte bound exceeded");
      const content = decode(bytes); cognitiveLearningText(content, "historical artifact", MAX_SOURCE);
      const sourceSha256 = digest(bytes);
      const candidate = importHistoricalLearning([{ id: `historical:${source.id}`, kind: source.kind, sourceRef: sourceReference(rootDigest, source.path, sourceSha256), content, sha256: digest(content),
        partition, scope: source.scope, classification: source.classification, familyId: source.familyId, ...(source.split ? { split: source.split } : {}) }], partition)[0];
      incoming.push({ rootDigest, path: source.path, sourceSha256, candidate });
    }
    return this.serial(partition, async target => {
      const records = await this.load(target, partition); let imported = 0; let existing = 0;
      for (const row of incoming) {
        const prior = records.find(record => record.candidate.id === row.candidate.id);
        if (prior) { if (JSON.stringify(prior) !== JSON.stringify(row)) throw Error("Historical source replay conflict"); existing++; }
        else { records.push(row); imported++; }
      }
      if (records.length > MAX_RECORDS) throw Error("Historical record capacity exceeded");
      if (imported) {
        const file: HistoryFile = { version: 1, partition: { ...partition }, records }; const raw = JSON.stringify(file);
        if (Buffer.byteLength(raw) > MAX_STORE) throw Error("Historical storage byte bound exceeded");
        const temporary = target + `.${randomUUID()}.tmp`;
        try { await writeFile(temporary, raw, { flag: "wx", mode: 0o600 }); await rename(temporary, target); }
        finally { await rm(temporary, { force: true }); }
      }
      return { imported, existing, total: records.length };
    });
  }
  async list(partition: CognitiveLearningPartition): Promise<LearningDataCandidate[]> {
    this.target(partition); partition = { tenantId: partition.tenantId, principalId: partition.principalId };
    return this.serial(partition, async target => structuredClone((await this.load(target, partition)).map(row => row.candidate)));
  }
  async summary(partition: CognitiveLearningPartition) {
    const rows = await this.list(partition); const sourceKinds: Record<string, number> = {};
    for (const row of rows) sourceKinds[row.sourceKind] = (sourceKinds[row.sourceKind] ?? 0) + 1;
    return { total: rows.length, unverified: rows.length, verified: 0, sourceKinds };
  }
  async trainingDataset(engine: CognitiveLearningEngine, partition: CognitiveLearningPartition, options: { scope?: "owner" | "tester-private" } = {}): Promise<TrainingCandidateDataset> {
    const live = await prepareCognitiveTrainingDataset(engine, partition, options);
    const history = await this.list(partition);
    const combined = buildTrainingCandidateDataset([...live.train, ...live.validation, ...live.heldout, ...history], partition);
    return { ...combined, rejected: [...live.rejected, ...combined.rejected] };
  }
}
