import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { CoordinatorClaim, CoordinatorLease, CoordinatorStore } from "../src/gai/distributed-coordinator.ts";
import type { WorkRunState } from "../src/orchestrator/work-run-state.ts";
import type { DurableTaskSnapshot } from "../src/gai/durable-task-runtime.ts";
import type { DevelopmentJobSnapshot } from "../src/orchestrator/development-job-store.ts";
import { assertDevelopmentJob, type DevelopmentJob } from "../src/orchestrator/development-job.ts";
import { GitHubCheckpointArchive, assertArchivePointer, type CheckpointArchivePointer } from "./goriq-github-checkpoint-archive.ts";

export interface GitHubCoordinatorStoreOptions {
  repository: string;
  stateBranch: string;
  clusterId: string;
  token: string;
  key: Buffer;
  // Trusted, independently retained floor; ciphertext integrity is not freshness.
  minimumEpoch: number;
  fetchImpl?: typeof fetch;
}

/** A complete, owner-supplied, JSON-only source checkpoint. The object is not
 * an authorization receipt and cannot migrate an unverified live Goal.
 * Immutable attempt/event records are NEVER pruned or replaced by this store.
 */
export interface GitHubGoalCheckpoint {
  version: 1;
  goalId: string;
  goalContractDigest: string;
  goal: { title: string; description: string; successCriteria: unknown[];
    constraints: unknown[]; createdAt: string; updatedAt: string };
  workRun: WorkRunState;
  tasks: DurableTaskSnapshot;
  // Only an owner-authenticated import may seed this separate canonical Job
  // snapshot. Legacy checkpoints without it cannot silently invent one.
  developmentJobs?: DevelopmentJobSnapshot;
  attempts: Array<{attemptId: string; jobId: string; record: unknown; recordSha256: string}>;
  events: Array<{eventId: string; record: unknown; recordSha256: string}>;
}

type Snapshot = { lease: CoordinatorLease; sha: string; checkpoint?: GitHubGoalCheckpoint; archivePointer?: CheckpointArchivePointer };
const STATE_PATH = "state/coordinator.enc.json";
const MAX_RESPONSE_BYTES = 65536;
const MAX_ENVELOPE_BYTES = 16384;
const KEYS = "clusterId,coordinatorId,epoch,fencingToken,issuedAt,leaseUntil,updatedAt";
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fail(code: string): never { throw new Error(`GITHUB_COORDINATOR_${code}`); }

function assertLease(value: unknown): asserts value is CoordinatorLease {
  if (!record(value) || Object.keys(value).sort().join(",") !== KEYS ||
      ![value.clusterId, value.coordinatorId, value.fencingToken].every(v => typeof v === "string" && ID.test(v)) ||
      !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 1) fail("LEASE_INVALID");
  const times = [value.issuedAt, value.updatedAt, value.leaseUntil];
  if (!times.every(v => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v)) fail("LEASE_INVALID");
  const [issued, updated, until] = times.map(v => Date.parse(v as string));
  if (issued > updated || until <= updated) fail("LEASE_INVALID");
}

function canonical(lease: CoordinatorLease): string {
  return JSON.stringify({clusterId: lease.clusterId, coordinatorId: lease.coordinatorId,
    epoch: lease.epoch, fencingToken: lease.fencingToken, issuedAt: lease.issuedAt,
    updatedAt: lease.updatedAt, leaseUntil: lease.leaseUntil});
}

const HASH = /^[a-f0-9]{64}$/;
const RUN_PHASES = new Set(["QUEUED","PLANNING","RUNNING","VERIFYING","RECOVERING","HUMAN_GATE","BLOCKED","COMPLETED","FAILED"]);
function checkpointJson(v: unknown): string {
  try { const json = JSON.stringify(v); if (!json || JSON.stringify(JSON.parse(json)) !== json) fail("CHECKPOINT_INVALID"); return json; }
  catch { fail("CHECKPOINT_INVALID"); }
}
function digest(v: unknown): string { return createHash("sha256").update(checkpointJson(v)).digest("hex"); }
function assertCheckpoint(v: unknown): asserts v is GitHubGoalCheckpoint {
  if (!record(v) || ![
      "attempts,events,goal,goalContractDigest,goalId,tasks,version,workRun",
      "attempts,developmentJobs,events,goal,goalContractDigest,goalId,tasks,version,workRun",
    ].includes(Object.keys(v).sort().join(",")) ||
      v.version !== 1 || typeof v.goalId !== "string" || !ID.test(v.goalId) ||
      !record(v.goal) || typeof v.goal.title !== "string" || typeof v.goal.description !== "string" ||
      !Array.isArray(v.goal.successCriteria) || !Array.isArray(v.goal.constraints) ||
      ![v.goal.createdAt,v.goal.updatedAt].every(t=>typeof t === "string" && Number.isFinite(Date.parse(t))) ||
      typeof v.goalContractDigest !== "string" || !HASH.test(v.goalContractDigest) ||
      v.goalContractDigest !== digest(v.goal) || !record(v.workRun) ||
      v.workRun.goalId !== v.goalId || typeof v.workRun.runId !== "string" || !ID.test(v.workRun.runId) ||
      !RUN_PHASES.has(v.workRun.phase as string) || !Array.isArray(v.workRun.blockers) ||
      !Array.isArray(v.workRun.evidenceRefs) ||
      !record(v.tasks) || v.tasks.version !== 1 || !Array.isArray(v.tasks.tasks) ||
      typeof v.tasks.savedAt !== "string" || !Number.isFinite(Date.parse(v.tasks.savedAt)) ||
      !Array.isArray(v.attempts) || !Array.isArray(v.events)) fail("CHECKPOINT_INVALID");
  const jobs = new Set<string>();
  for (const task of v.tasks.tasks) {
    if (!record(task) || typeof task.id !== "string" || !ID.test(task.id) || jobs.has(task.id) ||
        !Array.isArray(task.history) || !Number.isSafeInteger(task.executionEpoch) || (task.executionEpoch as number) < 0) fail("CHECKPOINT_INVALID");
    jobs.add(task.id);
  }
  if (v.developmentJobs !== undefined) {
    const snapshot = v.developmentJobs;
    if (!record(snapshot) || Object.keys(snapshot).sort().join(",") !== "jobs,savedAt,version" ||
        snapshot.version !== 1 || !Array.isArray(snapshot.jobs) ||
        typeof snapshot.savedAt !== "string" || !Number.isFinite(Date.parse(snapshot.savedAt))) fail("CHECKPOINT_INVALID");
    const jobIds = new Set<string>();
    for (const job of snapshot.jobs) {
      if (!record(job) || typeof job.jobId !== "string" || !ID.test(job.jobId) ||
          jobIds.has(job.jobId) || job.goalId !== v.goalId) fail("CHECKPOINT_INVALID");
      try { assertDevelopmentJob(job as unknown as DevelopmentJob); } catch { fail("CHECKPOINT_INVALID"); }
      if (!Array.isArray(job.history) || !Array.isArray(job.attempts) ||
          !Array.isArray(job.evidence) || !Array.isArray(job.failureSignatures) ||
          !Array.isArray(job.rejectedStrategyIds)) fail("CHECKPOINT_INVALID");
      jobIds.add(job.jobId);
    }
  }
  for (const [items,idField] of [[v.attempts,"attemptId"],[v.events,"eventId"]] as const) {
    const ids = new Set<string>();
    for (const item of items) {
      if (!record(item) || typeof item[idField] !== "string" || !ID.test(item[idField]) || ids.has(item[idField]) ||
          typeof item.recordSha256 !== "string" || !HASH.test(item.recordSha256) || item.recordSha256 !== digest(item.record) ||
          (idField === "attemptId" && (typeof item.jobId !== "string" || !jobs.has(item.jobId)))) fail("CHECKPOINT_INVALID");
      ids.add(item[idField]);
    }
  }
  // History length is not capped here. Large snapshots use immutable encrypted
  // archive parts; the small coordinator root remains one fenced CAS record.
}
function assertAppendOnly(previous: GitHubGoalCheckpoint, next: GitHubGoalCheckpoint): void {
  if (previous.goalId !== next.goalId || checkpointJson(previous.goal) !== checkpointJson(next.goal) ||
      previous.goalContractDigest !== next.goalContractDigest || previous.workRun.runId !== next.workRun.runId) fail("CHECKPOINT_HISTORY_INVALID");
  for (const key of ["attempts","events"] as const) {
    if (next[key].length < previous[key].length ||
        previous[key].some((item,i) => checkpointJson(item) !== checkpointJson(next[key][i]))) fail("CHECKPOINT_HISTORY_INVALID");
  }
  if (Boolean(previous.developmentJobs) !== Boolean(next.developmentJobs)) fail("CHECKPOINT_HISTORY_INVALID");
  if (previous.developmentJobs && next.developmentJobs) {
    for (const oldJob of previous.developmentJobs.jobs) {
      const newer = next.developmentJobs.jobs.find(job=>job.jobId === oldJob.jobId);
      if (!newer || newer.baseRevision !== oldJob.baseRevision ||
          checkpointJson(newer.approvalScope) !== checkpointJson(oldJob.approvalScope) ||
          checkpointJson(newer.definitionOfDone) !== checkpointJson(oldJob.definitionOfDone) ||
          checkpointJson(newer.workItems) !== checkpointJson(oldJob.workItems) ||
          Date.parse(newer.updatedAt) < Date.parse(oldJob.updatedAt) ||
          (["COMPLETED","CANCELLED"].includes(oldJob.phase) && newer.phase !== oldJob.phase)) fail("CHECKPOINT_HISTORY_INVALID");
      for (const field of ["history","attempts","evidence","failureSignatures","rejectedStrategyIds"] as const) {
        if (newer[field].length < oldJob[field].length ||
            oldJob[field].some((item,i)=>checkpointJson(item)!==checkpointJson(newer[field][i]))) fail("CHECKPOINT_HISTORY_INVALID");
      }
      const added = newer.history.slice(oldJob.history.length);
      if (added.length) {
        let phase = oldJob.phase;
        for (const transition of added) {
          if (transition.actor !== "state-controller" || transition.from !== phase ||
              typeof transition.to !== "string") fail("CHECKPOINT_HISTORY_INVALID");
          phase = transition.to;
        }
        if (phase !== newer.phase) fail("CHECKPOINT_HISTORY_INVALID");
      } else if (newer.phase !== oldJob.phase) fail("CHECKPOINT_HISTORY_INVALID");
    }
  }
  for (const oldTask of previous.tasks.tasks) {
    const newer = next.tasks.tasks.find(task=>task.id===oldTask.id);
    if (!newer || newer.history.length < oldTask.history.length ||
        oldTask.history.some((item,i)=>checkpointJson(item)!==checkpointJson(newer.history[i])) ||
        newer.executionEpoch < oldTask.executionEpoch || newer.attempts < oldTask.attempts ||
        ((oldTask.status==="completed" || oldTask.status==="cancelled") && oldTask.status !== newer.status)) fail("CHECKPOINT_HISTORY_INVALID");
  }
}

function blobSha(bytes: Buffer): string {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

function decodeBase64(value: unknown, limit: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4) fail("CIPHERTEXT_INVALID");
  const bytes = Buffer.from(value as string, "base64");
  if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== value) fail("CIPHERTEXT_INVALID");
  return bytes;
}

/** Optional encrypted persistence for the EXISTING coordinator. No bootstrap,
 * scheduler, Goal migration, credential provisioning or runtime activation.
 * This lease store alone does not fence external Job or side-effect writes.
 */
export class GitHubCoordinatorStore implements CoordinatorStore {
  readonly #url: string;
  readonly #branch: string;
  readonly #cluster: string;
  readonly #token: string;
  readonly #key: Buffer;
  readonly #aad: Buffer;
  readonly #floor: number;
  readonly #fetch: typeof fetch;
  readonly #archive: GitHubCheckpointArchive;
  #snapshot: Snapshot | undefined;
  #highWater: CoordinatorLease | undefined;
  #checkpointHighWater: GitHubGoalCheckpoint | undefined;

  constructor(options: GitHubCoordinatorStoreOptions) {
    if (!options || !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.repository ?? "") ||
        !/^goriq-state\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(options.stateBranch ?? "") ||
        options.stateBranch.includes("//") || options.stateBranch.endsWith("/") ||
        !ID.test(options.clusterId ?? "") || !/^[A-Za-z0-9_.-]{8,512}$/.test(options.token ?? "") ||
        !Buffer.isBuffer(options.key) || options.key.length !== 32 ||
        !Number.isSafeInteger(options.minimumEpoch) || options.minimumEpoch < 1 ||
        (options.fetchImpl !== undefined && typeof options.fetchImpl !== "function")) fail("CONFIG_INVALID");
    this.#branch = options.stateBranch;
    this.#cluster = options.clusterId;
    this.#token = options.token;
    this.#key = Buffer.from(options.key);
    this.#floor = options.minimumEpoch;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#archive = new GitHubCheckpointArchive(options);
    this.#url = `https://api.github.com/repos/${options.repository}/contents/${STATE_PATH}`;
    this.#aad = Buffer.from(JSON.stringify(["goriq-coordinator-v1", options.repository,
      options.stateBranch, STATE_PATH, options.clusterId]));
  }

  async load(): Promise<CoordinatorLease> {
    const current = await this.#read();
    this.#snapshot = current;
    return structuredClone(current.lease);
  }

  async save(lease: CoordinatorLease): Promise<void> {
    void lease;
    fail("CAS_REQUIRED");
  }

  async compareAndSwap(expected: CoordinatorLease | null, next: CoordinatorLease): Promise<boolean> {
    if (expected === null) fail("BOOTSTRAP_FORBIDDEN");
    assertLease(expected); assertLease(next);
    const observed = this.#snapshot;
    if (!observed) fail("READ_REQUIRED");
    if (canonical(observed.lease) !== canonical(expected)) return false;
    this.#assertTransition(expected, next);
    // A fresh read detects another process's update. The conditional PUT closes
    // the remaining read/write race; do not retry a conflict with a newer SHA.
    const current = await this.#read();
    this.#snapshot = current;
    if (current.sha !== observed.sha) return false;
    return this.#write(current, next, current.checkpoint);
  }

  /** The full Goal/Job/attempt record and its coordinator lease share ONE
   * encrypted Git blob and ONE conditional SHA update. Lease-only v1 sources
   * are never silently upgraded or used to manufacture owner Goal state.
   */
  async loadCheckpoint(): Promise<GitHubGoalCheckpoint> {
    const snapshot = await this.#read();
    this.#snapshot = snapshot;
    if (!snapshot.checkpoint) fail("CHECKPOINT_MISSING");
    return structuredClone(snapshot.checkpoint);
  }

  async compareAndSwapCheckpoint(expected: GitHubGoalCheckpoint, next: GitHubGoalCheckpoint,
    claim: CoordinatorClaim): Promise<boolean> {
    assertCheckpoint(expected); assertCheckpoint(next);
    const observed = this.#snapshot;
    if (!observed?.checkpoint) fail("CHECKPOINT_READ_REQUIRED");
    if (checkpointJson(observed.checkpoint) !== checkpointJson(expected)) return false;
    const lease = observed.lease;
    if (!claim || claim.clusterId !== lease.clusterId || claim.coordinatorId !== lease.coordinatorId ||
        claim.epoch !== lease.epoch || claim.fencingToken !== lease.fencingToken ||
        claim.leaseUntil !== lease.leaseUntil || Date.parse(lease.leaseUntil) <= Date.now()) fail("CLAIM_INVALID");
    assertAppendOnly(expected, next);
    const current = await this.#read();
    this.#snapshot = current;
    if (current.sha !== observed.sha) return false;
    return this.#write(current, lease, next, true);
  }

  async #write(current: Snapshot, next: CoordinatorLease, checkpoint?: GitHubGoalCheckpoint, requireLiveClaim = false): Promise<boolean> {
    // Stage immutable history BEFORE publishing the single authoritative root.
    // A failed staging operation leaves the previous root intact. Concurrent
    // writers may leave unreferenced parts, never an accepted truncated Goal.
    let archivePointer = current.archivePointer;
    if (checkpoint) {
      const changed = checkpointJson(current.checkpoint ?? null) !== checkpointJson(checkpoint);
      if (archivePointer && changed) {
        archivePointer = await this.#archive.stage(checkpointJson(checkpoint), archivePointer);
      } else if (!archivePointer && Buffer.byteLength(checkpointJson(checkpoint), "utf8") > 6500) {
        archivePointer = await this.#archive.stage(checkpointJson(checkpoint), null);
      }
    } else if (archivePointer) fail("CHECKPOINT_HISTORY_INVALID");
    // Chunks can take a long time to upload. A claim valid when staging starts
    // must not publish after its lease expired. Require room for the bounded
    // root request; otherwise the authenticated controller must renew first.
    if (requireLiveClaim && Date.parse(current.lease.leaseUntil) <= Date.now() + 10_000)
      fail("CLAIM_EXPIRED_BEFORE_PUBLICATION");
    const bytes = this.#seal(next, archivePointer ? undefined : checkpoint, archivePointer);
    const targetSha = blobSha(bytes);
    let response: Response;
    try {
      response = await this.#request("PUT", JSON.stringify({
        message: "chore(goriq): checkpoint coordinator lease", branch: this.#branch,
        sha: current.sha, content: bytes.toString("base64"),
      }));
    } catch {
      this.#snapshot = undefined;
      fail("WRITE_OUTCOME_UNKNOWN");
    }
    if (response.status === 409) { this.#snapshot = undefined; return false; }
    if (response.status !== 200) {
      this.#snapshot = undefined;
      if (response.status < 400 || response.status >= 500) fail("WRITE_OUTCOME_UNKNOWN");
      fail(`HTTP_${response.status}`);
    }
    try {
      const receipt = await this.#json(response);
      if (!record(receipt) || !record(receipt.content) || receipt.content.sha !== targetSha ||
          !record(receipt.commit) || typeof receipt.commit.sha !== "string" || !SHA.test(receipt.commit.sha)) fail("RESPONSE_INVALID");
      const verified = await this.#read();
      if (verified.sha !== targetSha || canonical(verified.lease) !== canonical(next) ||
          checkpointJson(verified.checkpoint ?? null) !== checkpointJson(checkpoint ?? null) ||
          checkpointJson(verified.archivePointer ?? null) !== checkpointJson(archivePointer ?? null)) fail("READBACK_MISMATCH");
      this.#snapshot = verified;
      return true;
    } catch {
      this.#snapshot = undefined;
      fail("WRITE_OUTCOME_UNKNOWN");
    }
  }

  #assertTransition(expected: CoordinatorLease, next: CoordinatorLease): void {
    if (expected.clusterId !== this.#cluster || next.clusterId !== this.#cluster ||
        expected.epoch < this.#floor || Date.parse(next.updatedAt) < Date.parse(expected.updatedAt) ||
        Date.parse(next.issuedAt) < Date.parse(expected.issuedAt)) fail("TRANSITION_INVALID");
    if (next.epoch === expected.epoch) {
      if (next.coordinatorId !== expected.coordinatorId || next.fencingToken !== expected.fencingToken ||
          next.issuedAt !== expected.issuedAt || Date.parse(next.leaseUntil) < Date.parse(expected.leaseUntil)) fail("TRANSITION_INVALID");
    } else if (next.epoch !== expected.epoch + 1 || next.fencingToken === expected.fencingToken) fail("TRANSITION_INVALID");
  }

  async #request(method: "GET" | "PUT", body?: string): Promise<Response> {
    return this.#fetch(method === "GET" ? `${this.#url}?ref=${encodeURIComponent(this.#branch)}` : this.#url, {
      method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: {Authorization: `Bearer ${this.#token}`, Accept: "application/vnd.github+json",
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"},
      ...(body === undefined ? {} : {body}),
    });
  }

  async #json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) fail("RESPONSE_INVALID");
    const chunks: Buffer[] = []; let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          fail("RESPONSE_TOO_LARGE");
        }
        chunks.push(Buffer.from(part.value));
      }
    } catch (error) {
      if (error instanceof Error && error.message === "GITHUB_COORDINATOR_RESPONSE_TOO_LARGE") throw error;
      fail("RESPONSE_UNAVAILABLE");
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("RESPONSE_INVALID"); }
  }

  async #read(): Promise<Snapshot> {
    let response: Response;
    try { response = await this.#request("GET"); }
    catch { fail("READ_UNAVAILABLE"); }
    if (response.status === 404) fail("STATE_MISSING");
    if (response.status !== 200) fail(`HTTP_${response.status}`);
    const value = await this.#json(response);
    if (!record(value) || value.type !== "file" || value.path !== STATE_PATH || value.encoding !== "base64" ||
        typeof value.content !== "string" || typeof value.sha !== "string" || !SHA.test(value.sha)) fail("RESPONSE_INVALID");
    // The Contents API inserts line breaks in base64, but no other whitespace.
    const encoded = value.content.replace(/[\r\n]/g, "");
    let bytes: Buffer;
    try { bytes = decodeBase64(encoded, MAX_ENVELOPE_BYTES); }
    catch { fail("RESPONSE_INVALID"); }
    if (blobSha(bytes) !== value.sha) fail("RESPONSE_INVALID");
    const opened = this.#open(bytes);
    let checkpoint = opened.checkpoint;
    if (opened.archivePointer) {
      const json = await this.#archive.restore(opened.archivePointer);
      try { checkpoint = JSON.parse(json) as GitHubGoalCheckpoint; }
      catch { fail("CHECKPOINT_INVALID"); }
      assertCheckpoint(checkpoint);
    }
    const lease = opened.lease;
    const previous = this.#highWater;
    if (lease.epoch < this.#floor || (previous && (lease.epoch < previous.epoch ||
        (lease.epoch === previous.epoch && (lease.coordinatorId !== previous.coordinatorId ||
          lease.fencingToken !== previous.fencingToken || lease.issuedAt !== previous.issuedAt ||
          Date.parse(lease.updatedAt) < Date.parse(previous.updatedAt) ||
          Date.parse(lease.leaseUntil) < Date.parse(previous.leaseUntil)))))) fail("ROLLBACK");
    if (this.#checkpointHighWater) {
      if (!checkpoint) fail("CHECKPOINT_HISTORY_INVALID");
      assertAppendOnly(this.#checkpointHighWater, checkpoint);
    }
    this.#highWater = structuredClone(lease);
    if (checkpoint) this.#checkpointHighWater = structuredClone(checkpoint);
    return {lease, sha: value.sha, checkpoint, archivePointer: opened.archivePointer};
  }

  #open(bytes: Buffer): {lease: CoordinatorLease; checkpoint?: GitHubGoalCheckpoint; archivePointer?: CheckpointArchivePointer} {
    try {
      const wire: unknown = JSON.parse(bytes.toString("utf8"));
      if (!record(wire) || Object.keys(wire).sort().join(",") !== "algorithm,ciphertext,nonce,tag,version" ||
          wire.version !== 1 || wire.algorithm !== "aes-256-gcm") fail("CIPHERTEXT_INVALID");
      const nonce = decodeBase64(wire.nonce, 12), tag = decodeBase64(wire.tag, 16);
      if (nonce.length !== 12 || tag.length !== 16) fail("CIPHERTEXT_INVALID");
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(this.#aad); decipher.setAuthTag(tag);
      const raw = Buffer.concat([decipher.update(decodeBase64(wire.ciphertext, 8192)), decipher.final()]);
      const plain: unknown = JSON.parse(raw.toString("utf8"));
      if (record(plain) && plain.schema === 3) {
        if (Object.keys(plain).sort().join(",") !== "archivePointer,lease,schema") fail("CIPHERTEXT_INVALID");
        assertLease(plain.lease); assertArchivePointer(plain.archivePointer);
        if (plain.lease.clusterId !== this.#cluster) fail("LEASE_INVALID");
        return {lease: plain.lease, archivePointer: plain.archivePointer};
      }
      if (record(plain) && plain.schema === 2) {
        if (Object.keys(plain).sort().join(",") !== "checkpoint,lease,schema") fail("CIPHERTEXT_INVALID");
        assertLease(plain.lease); assertCheckpoint(plain.checkpoint);
        if (plain.lease.clusterId !== this.#cluster) fail("LEASE_INVALID");
        return {lease: plain.lease, checkpoint: plain.checkpoint};
      }
      assertLease(plain);
      if (plain.clusterId !== this.#cluster) fail("LEASE_INVALID");
      return {lease: plain};
    } catch { fail("CIPHERTEXT_INVALID"); }
  }

  #seal(lease: CoordinatorLease, checkpoint?: GitHubGoalCheckpoint, archivePointer?: CheckpointArchivePointer): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(this.#aad);
    if (checkpoint) assertCheckpoint(checkpoint);
    if (archivePointer) assertArchivePointer(archivePointer);
    const plaintext = archivePointer ? JSON.stringify({schema:3,lease,archivePointer}) :
      checkpoint ? JSON.stringify({schema:2,lease,checkpoint}) : canonical(lease);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(JSON.stringify({version: 1, algorithm: "aes-256-gcm", nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64")}));
  }
}
