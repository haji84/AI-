import { createHash } from "node:crypto";
import { createDevelopmentChangeSet, type DevelopmentChangeSet } from "./development-change-set.ts";

export interface DevelopmentIntegrationCandidate {
  id: string;
  changedPaths: string[];
  patchDigest: string;
  satisfiedCriteria: string[];
}

export interface DevelopmentIntegrationStrategy {
  candidates(input: DevelopmentIntegrationInput): Promise<DevelopmentIntegrationCandidate[]>;
}

export interface DevelopmentIntegrationVerification {
  ok: boolean;
  evidenceDigest: string;
  failureSignature?: string;
}

export interface DevelopmentIntegrationInput {
  local: DevelopmentChangeSet;
  remote: DevelopmentChangeSet;
  acceptanceCriteria: string[];
  verify(candidate: DevelopmentIntegrationCandidate): Promise<DevelopmentIntegrationVerification>;
}

export interface DevelopmentIntegrationResult {
  ok: boolean;
  changeSet?: DevelopmentChangeSet;
  selectedCandidateId?: string;
  rejectedCandidates: string[];
  blocker?: string;
  preserved?: DevelopmentChangeSet[];
  provenance?: { sourceChangeSetIds: string[]; sourcePatchDigests: string[] };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class DevelopmentConflictIntegrator {
  private readonly strategy?: DevelopmentIntegrationStrategy;

  constructor(strategy?: DevelopmentIntegrationStrategy) {
    this.strategy = strategy;
  }

  async integrate(input: DevelopmentIntegrationInput): Promise<DevelopmentIntegrationResult> {
    const { local, remote } = input;
    if (local.jobId !== remote.jobId || local.workItemId !== remote.workItemId || local.baseRevision !== remote.baseRevision) {
      return { ok: false, blocker: "change_set_authority_mismatch", rejectedCandidates: [], preserved: [structuredClone(local), structuredClone(remote)] };
    }
    const overlaps = local.changedPaths.some((path) => remote.changedPaths.includes(path));
    const candidates = overlaps
      ? await this.strategy?.candidates(input) ?? []
      : [{
          id: "deterministic-independent-merge",
          changedPaths: [...new Set([...local.changedPaths, ...remote.changedPaths])].sort(),
          patchDigest: digest([local.patchDigest, remote.patchDigest]),
          satisfiedCriteria: [...input.acceptanceCriteria],
        }];
    const rejectedCandidates: string[] = [];
    const seenFailures = new Set<string>();
    for (const candidate of candidates) {
      if (!/^[a-f0-9]{64}$/.test(candidate.patchDigest)) {
        rejectedCandidates.push(`${candidate.id}:invalid_patch_digest`);
        continue;
      }
      const missing = input.acceptanceCriteria.filter((criterion) => !candidate.satisfiedCriteria.includes(criterion));
      if (missing.length) {
        rejectedCandidates.push(`${candidate.id}:missing_acceptance`);
        continue;
      }
      const verification = await input.verify(candidate);
      if (!verification.ok) {
        const failure = verification.failureSignature ?? "verification_failed";
        if (seenFailures.has(failure)) {
          rejectedCandidates.push(`${candidate.id}:equivalent_failure:${failure}`);
          continue;
        }
        seenFailures.add(failure);
        rejectedCandidates.push(`${candidate.id}:${failure}`);
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(verification.evidenceDigest)) {
        rejectedCandidates.push(`${candidate.id}:invalid_evidence_digest`);
        continue;
      }
      const now = new Date();
      const created = createDevelopmentChangeSet({
        changeSetId: `integrated-${digest([local.changeSetId, remote.changeSetId, candidate.id]).slice(0, 24)}`,
        jobId: local.jobId,
        workItemId: local.workItemId,
        deviceId: "goriq-integrator",
        baseRevision: local.baseRevision,
        changedPaths: candidate.changedPaths,
        affectedSymbols: [...new Set([...local.affectedSymbols, ...remote.affectedSymbols])],
        patchDigest: candidate.patchDigest,
        evidenceDigest: verification.evidenceDigest,
        rollback: { kind: "git-base", reference: local.baseRevision },
      }, now);
      return {
        ok: true,
        changeSet: { ...created, status: "VERIFIED", updatedAt: now.toISOString() },
        selectedCandidateId: candidate.id,
        rejectedCandidates,
        provenance: {
          sourceChangeSetIds: [local.changeSetId, remote.changeSetId],
          sourcePatchDigests: [local.patchDigest, remote.patchDigest],
        },
      };
    }
    return {
      ok: false,
      blocker: "no_verified_integration_candidate",
      rejectedCandidates,
      preserved: [structuredClone(local), structuredClone(remote)],
    };
  }
}

