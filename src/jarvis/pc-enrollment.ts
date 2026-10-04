import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { lstat, mkdir, open, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { JarvisNode } from "./types.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";

export interface PcEnrollmentApproval {
  version: 1;
  issue: number;
  goalIssue: number;
  approvedAt: string;
  expiresAt: string;
  targets: Array<{ nodeId: string; platform: "macos" | "windows" | "linux" }>;
  roles: NonNullable<JarvisNode["pcAuthority"]>["roles"];
}
type Candidate = { node: JarvisNode; identity: JarvisWorkerIdentity; proofText: string; expiresAt: number };

export function validatePcEnrollmentApproval(value: unknown, now = new Date()): PcEnrollmentApproval {
  const approval = value as PcEnrollmentApproval;
  const start = Date.parse(approval?.approvedAt), end = Date.parse(approval?.expiresAt);
  if (approval?.version !== 1 || !Number.isSafeInteger(approval.issue) || approval.issue < 1 ||
    !Number.isSafeInteger(approval.goalIssue) || approval.goalIssue < 1 || !Number.isFinite(start) || !Number.isFinite(end) ||
    start > now.getTime() || end <= now.getTime() || end <= start || end - start > 86_400_000 ||
    !Array.isArray(approval.targets) || approval.targets.length < 1 || approval.targets.length > 100 ||
    approval.targets.some(t => !t || typeof t.nodeId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(t.nodeId) ||
      !["macos", "windows", "linux"].includes(t.platform)) ||
    new Set(approval.targets.map(t => t.nodeId)).size !== approval.targets.length ||
    !Array.isArray(approval.roles) || !approval.roles.length || new Set(approval.roles).size !== approval.roles.length ||
    approval.roles.some(r => !["Executor", "Storage", "Verifier", "Coordinator"].includes(r))) {
    throw new Error("PC_ENROLLMENT_APPROVAL_REQUIRED");
  }
  return structuredClone(approval);
}


/** Only the caller's independently approved, current grant may renew an identical scope. */
export function validatePcApprovalRenewal(previous: unknown, next: unknown, now = new Date()): PcEnrollmentApproval {
  const renewed = validatePcEnrollmentApproval(next, now);
  const prior = validatePcEnrollmentApproval(previous, new Date(Date.parse((previous as PcEnrollmentApproval)?.approvedAt)));
  const keys = ["version", "issue", "goalIssue", "approvedAt", "expiresAt", "targets", "roles"];
  if (Object.keys(prior).some(key => !keys.includes(key)) || Object.keys(renewed).some(key => !keys.includes(key))) {
    throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
  }
  const scope = (approval: PcEnrollmentApproval) => {
    const { approvedAt: _start, expiresAt: _end, ...rest } = approval;
    void _start; void _end;
    return rest;
  };
  if (!isDeepStrictEqual(scope(prior), scope(renewed)) ||
    Date.parse(renewed.approvedAt) < Date.parse(prior.approvedAt) ||
    Date.parse(renewed.expiresAt) < Date.parse(prior.expiresAt)) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
  return renewed;
}

/** Content-only update of an existing protected file; never creates files or changes ACL/owner. */
export async function renewPcApprovalFile(input: {
  path: string; approval: unknown; backup: (original: string) => Promise<void>; now?: Date;
}): Promise<boolean> {
  const before = await lstat(input.path), parent = await lstat(dirname(input.path));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !parent.isDirectory() || parent.isSymbolicLink()
    || (process.platform !== "win32" && (before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0
      || parent.uid !== process.getuid?.() || (parent.mode & 0o022) !== 0))) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
  const lockPath = input.path + ".renewal-lock";
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("PC_LOCAL_APPROVAL_BUSY");
    throw error;
  }
  // Never steal a lock after a crash. Recovery must investigate the existing lock first.
  try {
    const handle = await open(input.path, "r+");
    let original: string | undefined, changed = false;
    const read = async () => {
      const size = (await handle.stat()).size;
      if (size > 32768) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
      const bytes = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const result = await handle.read(bytes, offset, size - offset, offset);
        if (!result.bytesRead) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
        offset += result.bytesRead;
      }
      return bytes.toString("utf8");
    };
    const replace = async (text: string) => {
      const bytes = Buffer.from(text);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesWritten) throw new Error("PC_LOCAL_APPROVAL_RENEWAL_FAILED");
        offset += result.bytesWritten;
      }
      await handle.truncate(bytes.length); await handle.sync();
    };
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
      original = await read();
      const prior = JSON.parse(original);
      const renewed = validatePcApprovalRenewal(prior, input.approval, input.now);
      if (isDeepStrictEqual(prior, renewed)) return false;
      await input.backup(original);
      const current = await lstat(input.path);
      if (current.dev !== before.dev || current.ino !== before.ino || current.isSymbolicLink() || await read() !== original) {
        throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
      }
      changed = true;
      await replace(JSON.stringify(renewed));
      const after = await handle.stat();
      if (after.mode !== before.mode || after.uid !== before.uid || after.dev !== before.dev || after.ino !== before.ino ||
        !isDeepStrictEqual(JSON.parse(await read()), renewed)) throw new Error("PC_LOCAL_APPROVAL_RENEWAL_FAILED");
      return true;
    } catch (error) {
      if (changed && original !== undefined) {
        await replace(original);
        if (await read() !== original) throw new Error("PC_LOCAL_APPROVAL_RESTORE_FAILED");
      }
      throw error;
    } finally { await handle.close(); }
  } finally { await rmdir(lockPath); }
}

export class PcEnrollmentService {
  private readonly approval: PcEnrollmentApproval;
  private readonly candidates = new Map<string, Candidate>();

  constructor(approval: PcEnrollmentApproval) { this.approval = structuredClone(approval); }

  offer(value: unknown, now = new Date()): { challengeId: string; proofText: string; expiresAt: string } {
    const approval = validatePcEnrollmentApproval(this.approval, now);
    const input = value as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(k => !["nodeId", "platform", "publicKeyPem", "algorithm"].includes(k)) ||
      typeof input.publicKeyPem !== "string" || input.publicKeyPem.length > 2_000 ||
      !approval.targets.some(t => t.nodeId === input.nodeId && t.platform === input.platform) ||
      !["ed25519", "ecdsa-p256-sha256"].includes(String(input.algorithm))) throw new Error("PC enrollment descriptor rejected");
    const key = createPublicKey(input.publicKeyPem);
    if (input.algorithm === "ed25519" ? key.asymmetricKeyType !== "ed25519" :
      key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("PC signing key rejected");
    for (const [id, entry] of this.candidates) if (entry.expiresAt <= now.getTime()) this.candidates.delete(id);
    if ([...this.candidates.values()].some(c => c.node.id === input.nodeId)) throw new Error("PC enrollment already pending");
    if (this.candidates.size >= approval.targets.length) throw new Error("PC enrollment capacity reached");
    const node: JarvisNode = {
      id: input.nodeId as string, label: input.nodeId as string, kind: input.platform as JarvisNode["kind"],
      status: "offline", capabilities: ["filesystem"], enrollment: "quick", lastSeenAt: now.toISOString(),
      telemetry: { checkedAt: now.toISOString() },
      policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false,
        allowRemoteControl: false, requireHumanForLockedDevice: true },
      pcAuthority: { version: 1, approvalIssue: approval.issue, goalIssue: approval.goalIssue,
        roles: [...approval.roles], capabilityCeiling: ["filesystem"] },
    };
    const identity: JarvisWorkerIdentity = { nodeId: node.id,
      publicKeyPem: key.export({ type: "spki", format: "pem" }).toString(),
      algorithm: input.algorithm as JarvisWorkerIdentity["algorithm"], enrolledAt: now.toISOString() };
    const challengeId = randomUUID();
    const digest = createHash("sha256").update(JSON.stringify({ node, identity })).digest("hex");
    const proofText = `GORIQ-PC-ENROLL-v1\n${challengeId}\n${digest}`;
    const expiresAt = Math.min(now.getTime() + 300_000, Date.parse(approval.expiresAt));
    this.candidates.set(challengeId, { node, identity, proofText, expiresAt });
    return { challengeId, proofText, expiresAt: new Date(expiresAt).toISOString() };
  }

  prove(id: string, signature: string, now = new Date()): { node: JarvisNode; identity: JarvisWorkerIdentity } {
    validatePcEnrollmentApproval(this.approval, now);
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.expiresAt <= now.getTime()) {
      this.candidates.delete(id); throw new Error("PC enrollment challenge expired or unknown");
    }
    if (typeof signature !== "string" || signature.length > 1_000 ||
      !verify(candidate.identity.algorithm === "ed25519" ? null : "sha256", Buffer.from(candidate.proofText),
        createPublicKey(candidate.identity.publicKeyPem), Buffer.from(signature, "base64"))) throw new Error("PC enrollment proof rejected");
    this.candidates.delete(id);
    return structuredClone({ node: candidate.node, identity: candidate.identity });
  }
}
