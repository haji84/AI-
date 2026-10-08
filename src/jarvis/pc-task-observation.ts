import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { DurableTask, DurableTaskExecutionClaim, DurableTaskStatus } from "../gai/durable-task-runtime.ts";
import { acquireCognitiveLease } from "../gai/cognitive-lease.ts";
import { JsonFileSyncStore, SyncRepository, type SyncStore } from "../gai/sync-engine.ts";
import { PC_PUBLIC_DIGEST, pcDigest, validatePcPublicWork, verifiedPcCompletion, type PcPublicWorkInput, type PcCompletedResult } from "./pc-durable-work.ts";
import { verifyWorkerRequest, type JarvisSignedWorkerRequest, type JarvisWorkerIdentity } from "./worker-auth.ts";
import type { JarvisNode } from "./types.ts";

export const PC_OBSERVATION_EXPORT = "/api/jarvis/worker/pc/observation/export";
export const PC_OBSERVATION_RECEIVE = "/api/jarvis/worker/pc/observation/receive";
export const PC_OBSERVATION_MAX_BYTES = 65536;
export interface PcTaskObservation {
  version: 1; id: string; idempotencyKey: string; type: typeof PC_PUBLIC_DIGEST;
  payload: PcPublicWorkInput; migrationClass: "RESTARTABLE"; requiredCapabilities: ["filesystem"];
  status: DurableTaskStatus; executionEpoch: number; sequence: number;
  claim?: DurableTaskExecutionClaim; result?: PcCompletedResult;
}
export interface PcObservationEnvelope { taskId: string; revision: string; sourceNodeId: string; observation: PcTaskObservation }
export interface PcObservationProvenance { rawBody: string; signed: JarvisSignedWorkerRequest; identity: JarvisWorkerIdentity }
interface Variant { digest: string; sourceNodeId: string; observation: PcTaskObservation; provenance: PcObservationProvenance }
export interface PcObservationBundle { version: 1; taskId: string; conflicted: boolean; variants: Variant[] }
export interface PcObservationAck { taskId: string; observationDigest: string; duplicate: boolean; conflicted: boolean }
const statuses = ["queued", "waiting-dependency", "leased", "running", "waiting-connectivity", "waiting-resource", "ready-to-publish", "retrying", "completed", "failed", "cancelled"];
function reject(): never { throw new Error("PC_OBSERVATION_REJECTED"); }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}
function nodeId(value: unknown): value is string { return value === "macbook" || value === "zbook"; }
function date(value: unknown): value is string { return typeof value === "string" && value.length <= 30 && Number.isFinite(Date.parse(value)); }
export function assertPcObserver(node: JarvisNode | undefined, identity: JarvisWorkerIdentity): void {
  if (!node || !nodeId(node.id) || node.kind !== (node.id === "macbook" ? "macos" : "windows") ||
    identity.nodeId !== node.id || identity.revokedAt || identity.algorithm !== "ed25519" ||
    node.pcAuthority?.version !== 1 || node.pcAuthority.approvalIssue !== 1662 || node.pcAuthority.goalIssue !== 1219 ||
    !node.pcAuthority.roles.includes("Storage") || !node.pcAuthority.roles.includes("Coordinator")) throw Error("PC_OBSERVATION_AUTHORITY_REQUIRED");
}
/** Validate observations as peer attestations, never as execution authorization. */
export function validatePcObservation(value: unknown): PcTaskObservation {
  if (!exact(value, ["version", "id", "idempotencyKey", "type", "payload", "migrationClass", "requiredCapabilities", "status", "executionEpoch", "sequence", "claim", "result"]) ||
    Buffer.byteLength(JSON.stringify(value)) > PC_OBSERVATION_MAX_BYTES) reject();
  const o = value as unknown as PcTaskObservation, payload = validatePcPublicWork(o.payload);
  const expectedId = "pc-" + createHash("sha256").update(`${payload.goalIssue}:${payload.idempotencyKey}`).digest("hex");
  if (o.version !== 1 || payload.goalIssue !== 1219 || (payload.targetNodeId !== undefined && !nodeId(payload.targetNodeId)) ||
    o.id !== expectedId || o.idempotencyKey !== expectedId || o.type !== PC_PUBLIC_DIGEST || o.migrationClass !== "RESTARTABLE" ||
    !isDeepStrictEqual(o.requiredCapabilities, ["filesystem"]) || !statuses.includes(o.status) ||
    !Number.isSafeInteger(o.executionEpoch) || o.executionEpoch < 0 || !Number.isSafeInteger(o.sequence) || o.sequence < 1) reject();
  if (["leased", "running"].includes(o.status)) {
    const c = o.claim;
    if (!exact(c, ["taskId", "owner", "epoch", "fencingToken", "leaseUntil"]) || c.taskId !== o.id || !nodeId(c.owner) ||
      c.epoch !== o.executionEpoch || c.epoch < 1 || typeof c.fencingToken !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(c.fencingToken) ||
      !date(c.leaseUntil) || (payload.targetNodeId && payload.targetNodeId !== c.owner)) reject();
  } else if (o.claim !== undefined) reject();
  if (o.status === "completed") {
    const r = o.result, expected = pcDigest(payload.content);
    if (!exact(r, ["sha256", "bytes", "nodeId", "goalIssue", "verified", "issuer", "executionEpoch", "observedAt"]) ||
      !nodeId(r.nodeId) || r.goalIssue !== payload.goalIssue || r.verified !== true || r.issuer !== "signed-worker-request" ||
      r.executionEpoch !== o.executionEpoch || o.executionEpoch < 1 || r.sha256 !== expected.sha256 || r.bytes !== expected.bytes ||
      !date(r.observedAt) || (payload.targetNodeId && payload.targetNodeId !== r.nodeId)) reject();
  } else if (o.result !== undefined) reject();
  return structuredClone(o);
}
/** Only local history is checked here; it is deliberately not sent as historical signature proof. */
export function projectPcObservation(task: DurableTask, now = new Date()): PcTaskObservation {
  if (!Array.isArray(task.history) || task.dependsOn.length || task.maxAttempts !== 3 || task.pinnedNodeId !== undefined) reject();
  const result = task.status === "completed" ? verifiedPcCompletion(task, (task.result as PcCompletedResult)?.nodeId, 1219, now) : undefined;
  return validatePcObservation({ version: 1, id: task.id, idempotencyKey: task.idempotencyKey, type: task.type,
    payload: task.payload, migrationClass: task.migrationClass, requiredCapabilities: task.requiredCapabilities,
    status: task.status, executionEpoch: task.executionEpoch, sequence: task.history.length,
    ...(["leased", "running"].includes(task.status) ? { claim: { taskId: task.id, owner: task.leaseOwner,
      epoch: task.executionEpoch, fencingToken: task.fencingToken, leaseUntil: task.leaseUntil } } : {}), ...(result ? { result } : {}) });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
export function observationDigest(value: PcTaskObservation): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function incompatible(a: Variant, b: Variant): boolean {
  const x = a.observation, y = b.observation;
  if (!isDeepStrictEqual(x.payload, y.payload)) return true;
  if (a.sourceNodeId === b.sourceNodeId && x.sequence === y.sequence && a.digest !== b.digest) return true;
  const terminal = (o: PcTaskObservation) => ["completed", "failed", "cancelled"].includes(o.status);
  if (a.sourceNodeId === b.sourceNodeId && x.sequence !== y.sequence) {
    const [older, newer] = x.sequence < y.sequence ? [x, y] : [y, x];
    if (newer.executionEpoch < older.executionEpoch || (terminal(older) &&
      (older.status !== newer.status || older.executionEpoch !== newer.executionEpoch || !isDeepStrictEqual(older.result, newer.result)))) return true;
  }
  if (x.executionEpoch !== y.executionEpoch) {
    // Different source histories have no proven causal handoff. Preserve the
    // ambiguity even when one independently observed epoch happens to be larger.
    return a.sourceNodeId !== b.sourceNodeId && !!(x.claim || y.claim || x.result || y.result || terminal(x) || terminal(y));
  }
  if (x.claim && y.claim && (x.claim.owner !== y.claim.owner || x.claim.fencingToken !== y.claim.fencingToken)) return true;
  if (x.result && y.result && !isDeepStrictEqual(x.result, y.result)) return true;
  if ((x.claim && y.result && x.claim.owner !== y.result.nodeId) || (y.claim && x.result && y.claim.owner !== x.result.nodeId)) return true;
  if (terminal(x) && terminal(y) && x.status !== y.status) return true;
  // Across source histories, a terminal/active disagreement has no proven causal ordering.
  return a.sourceNodeId !== b.sourceNodeId && terminal(x) !== terminal(y) && !!(x.claim || y.claim);
}
/** One locked SyncRepository bundle save; never references or writes an executable task store. */
export class PcTaskObservations {
  private readonly path: string;
  private readonly revision: string;
  private readonly store: () => SyncStore;
  constructor(path: string, revision: string, store?: () => SyncStore) {
    this.path = path; this.revision = revision; this.store = store ?? (() => new JsonFileSyncStore(path));
  }
  async get(taskId: string): Promise<PcObservationBundle | undefined> {
    return (await new SyncRepository(this.store()).get(taskId))?.value as PcObservationBundle | undefined;
  }
  async receive(value: unknown, proof: PcObservationProvenance, now = new Date()): Promise<PcObservationAck> {
    if (!exact(value, ["taskId", "revision", "sourceNodeId", "observation"]) || !/^[a-f0-9]{40}$/.test(this.revision) ||
      value.revision !== this.revision || !nodeId(value.sourceNodeId) || value.sourceNodeId !== proof.identity.nodeId ||
      proof.identity.algorithm !== "ed25519" || typeof proof.rawBody !== "string" || Buffer.byteLength(proof.rawBody) > PC_OBSERVATION_MAX_BYTES ||
      proof.signed.method !== "POST" || proof.signed.path !== PC_OBSERVATION_RECEIVE ||
      proof.signed.bodySha256 !== createHash("sha256").update(proof.rawBody).digest("hex") ||
      !isDeepStrictEqual(JSON.parse(proof.rawBody), value) || !verifyWorkerRequest({ identity: proof.identity, request: proof.signed, now }).ok) reject();
    const observation = validatePcObservation(value.observation);
    if (value.taskId !== observation.id) reject();
    const digest = observationDigest(observation), variant: Variant = { digest, sourceNodeId: value.sourceNodeId,
      observation, provenance: structuredClone(proof) };
    await mkdir(dirname(this.path), { recursive: true });
    const release = await acquireCognitiveLease(this.path + ".writer.lock", 2000);
    try {
      // Failed puts mutate SyncRepository memory; never reuse that repository after an operation.
      const repository = new SyncRepository(this.store()), records = await repository.list();
      const prior = records.find(record => record.recordId === observation.id)?.value as PcObservationBundle | undefined;
      if (prior && (prior.version !== 1 || prior.taskId !== observation.id || !Array.isArray(prior.variants) ||
        typeof prior.conflicted !== "boolean" || prior.variants.length > 16)) reject();
      const duplicate = prior?.variants.some(v => v.digest === digest && v.sourceNodeId === variant.sourceNodeId) === true;
      const conflicted = prior?.conflicted === true || (prior?.variants.some(v => incompatible(v, variant)) ?? false);
      if (!duplicate) {
        if ((!prior && records.length >= 64) || (prior?.variants.length ?? 0) >= 16) throw Error("PC_OBSERVATION_CAPACITY");
        const bundle: PcObservationBundle = { version: 1, taskId: observation.id, conflicted, variants: [...(prior?.variants ?? []), variant] };
        await repository.mutate({ recordId: observation.id, entityType: "evidence", deviceId: "pc-observation-adapter",
          ownerTaskId: observation.id, verification: { status: "unverified" }, value: bundle }, now);
      }
      return { taskId: observation.id, observationDigest: digest, duplicate, conflicted };
    } finally { await release(); }
  }
}
