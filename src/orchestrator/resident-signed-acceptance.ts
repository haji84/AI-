import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DevelopmentChangeSet } from "./development-change-set.ts";
import type { DevelopmentDefinitionOfDoneItem, DevelopmentEvidence } from "./development-job.ts";
import { evaluateDevelopmentVerification, type DevelopmentVerificationPlan } from "./development-verification-plan.ts";
import { validateSignedLocalVerifierReceipt, type SignedLocalVerifierReceipt } from "./signed-local-verifier-receipt.ts";
import { readBoundedRuntimeFile } from "./resident-runtime-files.ts";

export interface SignedFileAcceptanceContract {
  criterionId: string;
  description: string;
  expectedFiles: Array<{ path: string; sha256: string }>;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const safePath = (value: string) => /^(src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(value)
  && !value.split("/").some(part => !part || part === "." || part === "..");

export function assertSignedFileAcceptanceContracts(contracts: SignedFileAcceptanceContract[], criteria: DevelopmentDefinitionOfDoneItem[]): void {
  if (!Array.isArray(contracts) || contracts.length !== criteria.length || !contracts.length || contracts.length > 32) throw Error("ACCEPTANCE_CONTRACT_INVALID");
  const seen = new Set<string>();
  for (const contract of contracts) {
    if (!contract || typeof contract !== "object" || Object.keys(contract).sort().join(",") !== "criterionId,description,expectedFiles"
      || seen.has(contract.criterionId) || !criteria.some(c => c.id === contract.criterionId && c.description === contract.description)
      || !Array.isArray(contract.expectedFiles) || !contract.expectedFiles.length || contract.expectedFiles.length > 32
      || contract.expectedFiles.some(f => !f || Object.keys(f).sort().join(",") !== "path,sha256" || !safePath(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256))
      || new Set(contract.expectedFiles.map(f => f.path)).size !== contract.expectedFiles.length) {
      throw Error("ACCEPTANCE_CONTRACT_INVALID");
    }
    seen.add(contract.criterionId);
  }
}

/** Exact-file acceptance is an explicit host-pinned oracle, never inferred from prose or check labels.
 * The signer binds every candidate byte and check; the host evaluates the pinned criterion mapping.
 * This does not turn a hash comparison into proof of arbitrary functional requirements.
 */
export async function evaluateSignedFileAcceptance(input: {
  receiptPath: string; publicKeyPem: string; plan: DevelopmentVerificationPlan;
  changeSet: DevelopmentChangeSet; goalId: string; workspace: string; targetPath: string;
  allowedFiles?: string[];
  criteria: DevelopmentDefinitionOfDoneItem[]; contracts: SignedFileAcceptanceContract[]; now?: Date;
}): Promise<DevelopmentEvidence[]> {
  assertSignedFileAcceptanceContracts(input.contracts, input.criteria);
  const bytes = readBoundedRuntimeFile(input.receiptPath, 24576, [input.workspace]);
  const receipt = JSON.parse(bytes.toString("utf8")) as SignedLocalVerifierReceipt;
  const checks = validateSignedLocalVerifierReceipt({ ...input, receipt });
  if (!evaluateDevelopmentVerification(input.plan, checks).passed) throw Error("ACCEPTANCE_CHECKS_INCOMPLETE");
  const executable = fileURLToPath(new URL("../../scripts/jarvis-local-artifact-readback.mjs", import.meta.url));
  const observed = spawnSync(process.execPath, [executable], {
    input: JSON.stringify({ workspace: input.workspace, baseRevision: input.changeSet.baseRevision,
      targetPath: input.targetPath, allowedUntracked: input.allowedFiles ?? input.changeSet.changedPaths }),
    encoding: "utf8", timeout: 20000, maxBuffer: 32768, windowsHide: true,
    env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive,
      TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  if (observed.error || observed.status !== 0) throw Error("ACCEPTANCE_READBACK_UNAVAILABLE");
  const value = JSON.parse(observed.stdout) as { ok: boolean; attestation?: {
    candidateRevision: string; artifactDigest: string; fileHashes: Record<string, string>;
  } };
  const attestation = value.attestation;
  if (!value.ok || !attestation || attestation.candidateRevision !== input.plan.sourceRevision
    || attestation.artifactDigest !== input.plan.artifactDigest) throw Error("ACCEPTANCE_CANDIDATE_MISMATCH");
  return input.contracts.map(contract => {
    if (contract.expectedFiles.some(file => attestation.fileHashes[file.path] !== file.sha256)) throw Error("ACCEPTANCE_FILE_MISMATCH");
    const contractDigest = hash(JSON.stringify({ criterionId: contract.criterionId, description: contract.description,
      expectedFiles: [...contract.expectedFiles].sort((a, b) => a.path.localeCompare(b.path)) }));
    return { id: `${input.changeSet.jobId}:accept:${contractDigest}`, criterionId: contract.criterionId,
      kind: `development-acceptance:file-sha256:${contractDigest}`, issuer: receipt.payload.verifierId,
      verified: true, sourceRevision: input.plan.sourceRevision, artifactDigest: input.plan.artifactDigest,
      recordedAt: receipt.payload.issuedAt, environment: `signed-receipt:sha256:${hash(bytes)}` };
  });
}
