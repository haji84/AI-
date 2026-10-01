import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
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
