import type { JarvisWorkerIdentity, JarvisWorkerSignatureAlgorithm } from "./worker-auth.ts";
import {
  JarvisDeviceReplacementCandidateManager,
  type JarvisReplacementChallenge,
  type JarvisVerifiedReplacementCandidate,
} from "./device-replacement-candidate.ts";

const MAX_READY = 100;
const MAX_READY_TTL_MS = 10 * 60_000;

type ReadyRecord = {
  candidate: JarvisVerifiedReplacementCandidate;
  expiresAt: string;
};

export interface JarvisReplacementProofSummary {
  status: "READY_FOR_HUMAN_GATE";
  requiresHumanGate: true;
  candidateId: string;
  nodeId: string;
  publicKeyFingerprint: string;
  verifiedAt: string;
  expiresAt: string;
}

export class JarvisDeviceReplacementTransport {
  private readonly candidates: JarvisDeviceReplacementCandidateManager;
  private readonly identityForNode: (nodeId: string) => JarvisWorkerIdentity | undefined;
  private readonly ready = new Map<string, ReadyRecord>();

  constructor(input: {
    identityForNode: (nodeId: string) => JarvisWorkerIdentity | undefined;
    candidates?: JarvisDeviceReplacementCandidateManager;
  }) {
    this.identityForNode = input.identityForNode;
    this.candidates = input.candidates ?? new JarvisDeviceReplacementCandidateManager();
  }

  createChallenge(input: {
    nodeId: string;
    publicKeyPem: string;
    algorithm: JarvisWorkerSignatureAlgorithm;
    ttlMs?: number;
    now?: Date;
  }): JarvisReplacementChallenge {
    const nodeId = input.nodeId.trim();
    if (!nodeId) throw new Error("replacement candidate requires nodeId");
    const currentIdentity = this.identityForNode(nodeId);
    if (!currentIdentity) throw new Error("replacement candidate current identity not found");
    return this.candidates.create({
      currentIdentity,
      replacement: { nodeId, publicKeyPem: input.publicKeyPem, algorithm: input.algorithm },
      ttlMs: input.ttlMs,
      now: input.now,
    });
  }

  prove(input: {
    candidateId: string;
    nodeId: string;
    signatureBase64: string;
    now?: Date;
  }): JarvisReplacementProofSummary {
    const now = input.now ?? new Date();
    this.cleanup(now);
    if (this.ready.size >= MAX_READY) throw new Error("replacement ready queue capacity reached");
    const candidate = this.candidates.verify({
      candidateId: input.candidateId,
      nodeId: input.nodeId,
      signatureBase64: input.signatureBase64,
      now,
    });
    const expiresAt = new Date(now.getTime() + MAX_READY_TTL_MS).toISOString();
    this.ready.set(candidate.candidateId, { candidate, expiresAt });
    return this.summary(candidate, expiresAt);
  }

  listReady(now = new Date()): Array<JarvisVerifiedReplacementCandidate & { expiresAt: string }> {
    this.cleanup(now);
    return Array.from(this.ready.values(), ({ candidate, expiresAt }) => ({ ...candidate, expiresAt }));
  }

  discard(candidateId: string): boolean {
    return this.ready.delete(candidateId);
  }

  pendingSize(now = new Date()): number {
    return this.candidates.size(now);
  }

  readySize(now = new Date()): number {
    this.cleanup(now);
    return this.ready.size;
  }

  private summary(candidate: JarvisVerifiedReplacementCandidate, expiresAt: string): JarvisReplacementProofSummary {
    return {
      status: candidate.status,
      requiresHumanGate: true,
      candidateId: candidate.candidateId,
      nodeId: candidate.nodeId,
      publicKeyFingerprint: candidate.publicKeyFingerprint,
      verifiedAt: candidate.verifiedAt,
      expiresAt,
    };
  }

  private cleanup(now: Date): void {
    for (const [candidateId, record] of this.ready) {
      if (Date.parse(record.expiresAt) <= now.getTime()) this.ready.delete(candidateId);
    }
  }
}
