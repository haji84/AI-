import { execFileSync } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonWorkerRuntime } from "../gai/common-worker-runtime.ts";
import { PC_PUBLIC_DIGEST, pcDigest, validatePcPublicWork, verifiedPcCompletion } from "./pc-durable-work.ts";
import type { DurableTask, DurableTaskExecutionClaim } from "../gai/durable-task-runtime.ts";
import { createHash, randomUUID, sign } from "node:crypto";
import type { PcLocalIdentity } from "./pc-local-identity.ts";
import { canonicalWorkerRequest, type JarvisWorkerIdentity } from "./worker-auth.ts";
import { privatePcOrigin, verifyPrivatePcResponse } from "./private-pc-transport.ts";
import { withPcExecutionLock } from "./pc-execution-lock.ts";

export function localBrokerOrigin(base: string): string {
  const url = new URL(base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) throw new Error("PC_BOOTSTRAP_LOOPBACK_REQUIRED");
  return url.origin;
}
export async function assertPcRuntime(base: string, revision: string, request = fetch): Promise<void> {
  base = localBrokerOrigin(base);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("PC_BOOTSTRAP_REVISION_MISMATCH");
  const response = await request(base + "/health", { signal: AbortSignal.timeout(5000) });
  const health = await response.json();
  if (!response.ok || health.ok !== true || health.runtimeRevision !== revision) throw new Error("PC_BOOTSTRAP_REVISION_MISMATCH");
}
/** Owner token is used only for local enrollment; worker heartbeat uses only its node key. */
export async function registerLocalPc(input: { base: string; revision: string; ownerToken: string;
  identity: PcLocalIdentity; alreadyEnrolled?: boolean; request?: typeof fetch }): Promise<void> {
  const request = input.request ?? fetch, base = localBrokerOrigin(input.base), identity = input.identity;
  await assertPcRuntime(base, input.revision, request);
  if (!input.ownerToken) throw new Error("PC_BOOTSTRAP_OWNER_UNAVAILABLE");
  const post = async (path: string, payload: unknown) => {
    const response = await request(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.ownerToken}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    if (response.status !== 201) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
    return response.json();
  };
  if (!input.alreadyEnrolled) {
    const challenge = await post("/api/jarvis/admin/pc-enrollment/challenge", { nodeId: identity.nodeId, platform: identity.platform, algorithm: identity.algorithm, publicKeyPem: identity.publicKeyPem });
    if (typeof challenge.challengeId !== "string" || challenge.challengeId.length > 100 ||
      typeof challenge.proofText !== "string" || !challenge.proofText.startsWith(`GORIQ-PC-ENROLL-v1\n${challenge.challengeId}\n`) ||
      !/^[a-f0-9]{64}$/.test(challenge.proofText.split("\n")[2] ?? "") || challenge.proofText.split("\n").length !== 3 ||
      !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now() || Date.parse(challenge.expiresAt) > Date.now() + 300_000) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
    const result = await post("/api/jarvis/admin/pc-enrollment/prove", { challengeId: challenge.challengeId,
      signatureBase64: sign(null, Buffer.from(challenge.proofText), identity.privateKeyPem).toString("base64") });
    if (result.node?.id !== identity.nodeId || result.node?.kind !== identity.platform) throw new Error("PC_BOOTSTRAP_ENROLLMENT_REJECTED");
  }
  const path = "/api/jarvis/worker/heartbeat", body = JSON.stringify({ status: "ready", capabilities: ["filesystem"] });
  const unsigned = { nodeId: identity.nodeId, path, method: "POST", timestamp: new Date().toISOString(), nonce: randomUUID(), bodySha256: createHash("sha256").update(body).digest("hex") };
  const response = await request(base + path, { method: "POST", body, headers: { "Content-Type": "application/json",
    "X-Jarvis-Node-Id": unsigned.nodeId, "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce,
    "X-Jarvis-Body-Sha256": unsigned.bodySha256, "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), identity.privateKeyPem).toString("base64") }, signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  if (!response.ok || result.node?.id !== identity.nodeId || result.node?.kind !== identity.platform) throw new Error("PC_BOOTSTRAP_HEARTBEAT_REJECTED");
}

export interface PcExecutionEvidence {
  status: "idle" | "completed"; nodeId: string; sourceRevision: string;
  taskId?: string; executionEpoch?: number; sha256?: string; bytes?: number;
  filesystemExecuted?: boolean; signedResultAccepted?: boolean; observedAt: string;
  reusedExistingExecution?: boolean; executionObservedAt?: string;
}
/** Bounded public input only. Never accepts a command, an existing file path or Owner credentials. */
export async function executeLocalPcWork(input: { base: string; revision: string; identity: PcLocalIdentity;
  request?: typeof fetch; taskId?: string }): Promise<PcExecutionEvidence> {
  const request = input.request ?? fetch, base = localBrokerOrigin(input.base);
  await assertPcRuntime(base, input.revision, request);
  return withPcExecutionLock(input.identity, () => executeClaimedPcWork({ ...input, base, request }));
}

/** Only an explicitly enrolled peer on the existing private Tailnet may issue bounded PUBLIC work. */
export async function executeRemotePcWork(input: { base: string; tailnetDomain: string; revision: string;
  identity: PcLocalIdentity; peer: JarvisWorkerIdentity; request?: typeof fetch; taskId?: string }): Promise<PcExecutionEvidence> {
  const base = privatePcOrigin(input.base, input.tailnetDomain), transport = input.request ?? fetch;
  if (input.peer.revokedAt || !["macbook", "zbook"].includes(input.peer.nodeId) ||
    input.peer.nodeId === input.identity.nodeId || input.peer.algorithm !== "ed25519" ||
    !/^[a-f0-9]{40}$/.test(input.revision)) throw new Error("PC_PRIVATE_PEER_REJECTED");
  const request: typeof fetch = async (url, options) => {
    const outbound = new Request(url, options);
    if (new URL(outbound.url).origin !== base || outbound.method !== "POST" ||
      new Headers(outbound.headers).has("authorization") || new Headers(outbound.headers).has("cookie")) {
      throw new Error("PC_PRIVATE_REQUEST_REJECTED");
    }
    const response = await transport(outbound.url, options);
    return verifyPrivatePcResponse(response, { request: outbound, peer: input.peer, revision: input.revision });
  };
  return withPcExecutionLock(input.identity, () => executeClaimedPcWork({ ...input, base, request }));
}
async function executeClaimedPcWork(input: { base: string; revision: string; identity: PcLocalIdentity;
  request: typeof fetch; taskId?: string }): Promise<PcExecutionEvidence> {
  const { request, base, identity } = input;
  const post = async (path: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    const unsigned = { nodeId: identity.nodeId, path, method: "POST", timestamp: new Date().toISOString(),
      nonce: randomUUID(), bodySha256: createHash("sha256").update(body).digest("hex") };
    const response = await request(base + path, { method: "POST", body, redirect: "error",
      headers: { "Content-Type": "application/json", "X-Jarvis-Node-Id": unsigned.nodeId,
        "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256,
        "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), identity.privateKeyPem).toString("base64") },
      signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("PC_WORK_SIGNED_REQUEST_REJECTED");
    return response.json();
  };
  const heartbeat = await post("/api/jarvis/worker/heartbeat", { status: "ready", capabilities: ["filesystem"] });
  if (heartbeat.node?.id !== identity.nodeId || heartbeat.node?.kind !== identity.platform ||
    !heartbeat.node.pcAuthority?.roles?.includes("Executor") ||
    !heartbeat.node.pcAuthority?.capabilityCeiling?.includes("filesystem")) throw new Error("PC_WORK_AUTHORITY_REQUIRED");
  const assignment = await post("/api/jarvis/worker/pc/next", input.taskId ? { taskId: input.taskId } : {});
  const evidence = { nodeId: identity.nodeId, sourceRevision: input.revision, observedAt: new Date().toISOString() };
  if (assignment.completed !== undefined) {
    if (!input.taskId || assignment.task !== null || assignment.claim !== undefined ||
      assignment.completed?.id !== input.taskId) throw new Error("PC_WORK_COMPLETION_REJECTED");
    const result = verifiedPcCompletion(assignment.completed, identity.nodeId, heartbeat.node.pcAuthority.goalIssue);
    return { ...evidence, status: "completed", taskId: input.taskId, executionEpoch: result.executionEpoch,
      sha256: result.sha256, bytes: result.bytes, signedResultAccepted: true,
      reusedExistingExecution: true, executionObservedAt: result.observedAt };
  }
  if (assignment.task === null) return { ...evidence, status: "idle" };
  const task = assignment.task as DurableTask, claim = assignment.claim as DurableTaskExecutionClaim;
  const work = validatePcPublicWork(task?.payload);
  if ((input.taskId && task.id !== input.taskId) || task.type !== PC_PUBLIC_DIGEST || task.migrationClass !== "RESTARTABLE" ||
    task.requiredCapabilities?.length !== 1 || task.requiredCapabilities[0] !== "filesystem" ||
    !claim || claim.taskId !== task.id || claim.owner !== identity.nodeId || task.leaseOwner !== identity.nodeId ||
    claim.epoch !== task.executionEpoch || !Number.isSafeInteger(claim.epoch) || claim.epoch < 1 ||
    claim.fencingToken !== task.fencingToken || typeof claim.fencingToken !== "string" || !claim.fencingToken ||
    claim.leaseUntil !== task.leaseUntil || Date.parse(claim.leaseUntil) <= Date.now() ||
    !Number.isFinite(Date.parse(claim.leaseUntil)) ||
    work.goalIssue !== heartbeat.node.pcAuthority.goalIssue ||
    (work.targetNodeId && work.targetNodeId !== identity.nodeId)) throw new Error("PC_WORK_ASSIGNMENT_REJECTED");
  const runtime = new CommonWorkerRuntime({ descriptor: { id: identity.nodeId, label: identity.nodeId,
    platform: identity.platform, capabilities: ["filesystem"], maxParallelTasks: 1, enabled: true,
    securityContext: { credentialIsolation: true, taskScopedAuthorization: true, acceptsRemoteSecrets: false } } });
  runtime.registerCapability("filesystem", async () => {
    const folder = await mkdtemp(join(tmpdir(), "goriq-public-work-"));
    try {
      const handle = await open(join(folder, "input.txt"), "wx+", 0o600);
      try {
        await handle.writeFile(work.content, "utf8"); await handle.sync();
        const bytes = (await handle.stat()).size, buffer = Buffer.alloc(bytes);
        let offset = 0;
        while (offset < bytes) {
          const read = await handle.read(buffer, offset, bytes - offset, offset);
          if (read.bytesRead === 0) throw new Error("PC_WORK_FILE_READ_FAILED");
          offset += read.bytesRead;
        }
        return { output: JSON.stringify({ sha256: createHash("sha256").update(buffer).digest("hex"), bytes }),
          evidence: { filesystemExecuted: true, taskId: task.id } };
      } finally { await handle.close(); }
    } finally { await rm(folder, { recursive: true }); }
  });
  const executed = await runtime.execute({ task: { id: task.id, description: work.capsule.currentJob,
    difficulty: 1, risk: "LOW" }, input: work.content, requestedCapability: "filesystem" });
  if (!executed.ok) throw new Error("PC_WORK_EXECUTION_FAILED");
  const detail = JSON.parse(executed.output);
  const expected = pcDigest(work.content);
  if (detail.sha256 !== expected.sha256 || detail.bytes !== expected.bytes) throw new Error("PC_WORK_ARTIFACT_REJECTED");
  const returned = await post("/api/jarvis/worker/pc/result", { taskId: task.id, claim, detail });
  if (returned.task?.id !== task.id || returned.task?.status !== "completed" || returned.task.result?.verified !== true ||
    returned.task.result.nodeId !== identity.nodeId || returned.task.result.executionEpoch !== claim.epoch ||
    returned.task.result.sha256 !== expected.sha256 || returned.task.result.bytes !== expected.bytes) throw new Error("PC_WORK_RESULT_REJECTED");
  return { ...evidence, status: "completed", taskId: task.id, executionEpoch: claim.epoch, ...expected,
    filesystemExecuted: true, signedResultAccepted: true, observedAt: new Date().toISOString() };
}

/** Owner-side checkout validation, before configuration or private key access. */
export function readCommittedPcWorkInput(revision: string, root = process.cwd()): string {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("PC_TASK_SOURCE_REJECTED");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000, maxBuffer: 131072 });
  try {
    if (git("rev-parse", "HEAD").trim() !== revision || git("status", "--porcelain", "--untracked-files=no").trim()) {
      throw new Error();
    }
    const content = git("show", revision + ":docs/architecture/goriq-distributed-node-fabric.md").replace(/\r\n/g, "\n");
    if (Buffer.byteLength(content) > 32768) throw new Error();
    return content;
  } catch { throw new Error("PC_TASK_SOURCE_REJECTED"); }
}
