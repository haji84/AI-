import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { CoordinatorLease, CoordinatorStore } from "../src/gai/distributed-coordinator.ts";

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

type Snapshot = { lease: CoordinatorLease; sha: string };
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
  #snapshot: Snapshot | undefined;
  #highWater: CoordinatorLease | undefined;

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
    const bytes = this.#seal(next);
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
      // An unexpected 2xx/5xx might follow a committed write; never retry it.
      if (response.status < 400 || response.status >= 500) fail("WRITE_OUTCOME_UNKNOWN");
      fail(`HTTP_${response.status}`);
    }
    try {
      const receipt = await this.#json(response);
      if (!record(receipt) || !record(receipt.content) || receipt.content.sha !== targetSha ||
          !record(receipt.commit) || typeof receipt.commit.sha !== "string" || !SHA.test(receipt.commit.sha)) fail("RESPONSE_INVALID");
      const verified = await this.#read();
      if (verified.sha !== targetSha || canonical(verified.lease) !== canonical(next)) fail("READBACK_MISMATCH");
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
    const lease = this.#open(bytes);
    const previous = this.#highWater;
    if (lease.epoch < this.#floor || (previous && (lease.epoch < previous.epoch ||
        (lease.epoch === previous.epoch && (lease.coordinatorId !== previous.coordinatorId ||
          lease.fencingToken !== previous.fencingToken || lease.issuedAt !== previous.issuedAt ||
          Date.parse(lease.updatedAt) < Date.parse(previous.updatedAt) ||
          Date.parse(lease.leaseUntil) < Date.parse(previous.leaseUntil)))))) fail("ROLLBACK");
    this.#highWater = structuredClone(lease);
    return {lease, sha: value.sha};
  }

  #open(bytes: Buffer): CoordinatorLease {
    try {
      const wire: unknown = JSON.parse(bytes.toString("utf8"));
      if (!record(wire) || Object.keys(wire).sort().join(",") !== "algorithm,ciphertext,nonce,tag,version" ||
          wire.version !== 1 || wire.algorithm !== "aes-256-gcm") fail("CIPHERTEXT_INVALID");
      const nonce = decodeBase64(wire.nonce, 12), tag = decodeBase64(wire.tag, 16);
      if (nonce.length !== 12 || tag.length !== 16) fail("CIPHERTEXT_INVALID");
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(this.#aad); decipher.setAuthTag(tag);
      const raw = Buffer.concat([decipher.update(decodeBase64(wire.ciphertext, 8192)), decipher.final()]);
      const lease: unknown = JSON.parse(raw.toString("utf8"));
      assertLease(lease);
      if (lease.clusterId !== this.#cluster) fail("LEASE_INVALID");
      return lease;
    } catch { fail("CIPHERTEXT_INVALID"); }
  }

  #seal(lease: CoordinatorLease): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(this.#aad);
    const ciphertext = Buffer.concat([cipher.update(canonical(lease)), cipher.final()]);
    return Buffer.from(JSON.stringify({version: 1, algorithm: "aes-256-gcm", nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64")}));
  }
}
