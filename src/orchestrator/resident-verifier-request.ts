import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevelopmentJob } from "./development-job.ts";
import type { DevelopmentChangeSet } from "./development-change-set.ts";
import { createDevelopmentVerificationPlan } from "./development-verification-plan.ts";
import { localCandidateIdentity } from "./local-candidate-identity.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const safePath = (value: unknown): value is string => typeof value === "string"
  && /^(src|scripts|tests|docs)\/[A-Za-z0-9_./-]+$/.test(value)
  && !value.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
const exact = (value: object, keys: string) => Object.keys(value).sort().join(",") === keys;
export const MAX_VERIFIER_REQUEST_BYTES = 1024 * 1024;

/** Portable data only. No paths to host credentials, executable commands, or authority grants. */
export interface ResidentVerifierRequest {
  version: 1;
  executionContractDigest: string;
  expiresAt: string;
  request: {
    goalId: string; jobId: string; changeSetId: string; builderId: string;
    baseRevision: string; sourceRevision: string; artifactDigest: string;
    targetPath: string; allowedUntracked: string[]; requiredChecks: string[];
  };
  files: Array<{ path: string; sha256: string; contentBase64: string }>;
}

export function validateResidentVerifierRequest(value: ResidentVerifierRequest, now = new Date()): void {
  if (!value || !exact(value, "executionContractDigest,expiresAt,files,request,version") || value.version !== 1
    || !digest(value.executionContractDigest) || !Number.isFinite(Date.parse(value.expiresAt))
    || new Date(value.expiresAt).toISOString() !== value.expiresAt
    || Date.parse(value.expiresAt) <= now.getTime()) throw Error("VERIFIER_REQUEST_SCOPE_INVALID");
  const req = value.request;
  if (!req || !exact(req, "allowedUntracked,artifactDigest,baseRevision,builderId,changeSetId,goalId,jobId,requiredChecks,sourceRevision,targetPath")
    || ![req.goalId, req.jobId, req.changeSetId, req.builderId].every(id => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(id))
    || !/^[a-f0-9]{40}$/.test(req.baseRevision) || !digest(req.sourceRevision) || !digest(req.artifactDigest)
    || !safePath(req.targetPath) || !Array.isArray(req.allowedUntracked) || !req.allowedUntracked.length || req.allowedUntracked.length > 32
    || req.allowedUntracked.some(path => !safePath(path)) || new Set(req.allowedUntracked).size !== req.allowedUntracked.length
    || !req.allowedUntracked.includes(req.targetPath)) throw Error("VERIFIER_REQUEST_BINDING_INVALID");
  const plan = createDevelopmentVerificationPlan({ builderId: req.builderId, sourceRevision: req.sourceRevision,
    artifactDigest: req.artifactDigest, changedPaths: req.allowedUntracked });
  if (JSON.stringify(req.requiredChecks) !== JSON.stringify(plan.requiredChecks)
    || plan.requiredChecks.some(check => !["lint", "typecheck", "unit", "integration", "security", "build"].includes(check))) {
    throw Error("VERIFIER_REQUEST_CHECKS_UNSUPPORTED");
  }
  if (!Array.isArray(value.files) || value.files.length !== req.allowedUntracked.length) throw Error("VERIFIER_REQUEST_FILES_INVALID");
  const files: Record<string, Buffer> = {};
  for (const file of value.files) {
    if (!file || !exact(file, "contentBase64,path,sha256") || !req.allowedUntracked.includes(file.path) || files[file.path]
      || !digest(file.sha256) || typeof file.contentBase64 !== "string" || file.contentBase64.length > 174764) throw Error("VERIFIER_REQUEST_FILES_INVALID");
    const bytes = Buffer.from(file.contentBase64, "base64"), text = bytes.toString("utf8");
    if (bytes.length > 131072 || bytes.toString("base64") !== file.contentBase64 || !Buffer.from(text).equals(bytes)
      || text.includes("\0") || hash(bytes) !== file.sha256) throw Error("VERIFIER_REQUEST_FILE_DIGEST_MISMATCH");
    files[file.path] = bytes;
  }
  const identity = localCandidateIdentity(req.baseRevision, req.targetPath, files);
  if (identity.candidateRevision !== req.sourceRevision || identity.artifactDigest !== req.artifactDigest) throw Error("VERIFIER_REQUEST_CANDIDATE_MISMATCH");
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_VERIFIER_REQUEST_BYTES) throw Error("VERIFIER_REQUEST_TOO_LARGE");
}

/** Publish exactly the persisted GREEN Change Set. Replays never replace an earlier request.
 * Delivery still requires a separately approved authenticated transport; this is not a receipt.
 */
export function publishResidentVerifierRequest(input: {
  job: DevelopmentJob; changeSet: DevelopmentChangeSet; executionContractDigest: string;
  workspace: string; targetPath: string; allowedFiles: string[]; receiptFile: string; workspaces: string[];
}): { requestFile: string; sha256: string } {
  const { job, changeSet } = input;
  if (job.phase !== "VERIFYING" || job.blockers.length || changeSet.jobId !== job.jobId || changeSet.baseRevision !== job.baseRevision
    || changeSet.tddPhase === "red" || changeSet.status !== "LOCAL" || !changeSet.workItemId.endsWith(":implement")
    || !job.workItems.some(item => item.id === changeSet.workItemId) || !changeSet.changedPaths.includes(input.targetPath)
    || changeSet.changedPaths.some(path => !input.allowedFiles.includes(path))) throw Error("VERIFIER_REQUEST_NOT_CURRENT_CANDIDATE");
  const scope = { workspace: input.workspace, baseRevision: changeSet.baseRevision, targetPath: input.targetPath, allowedUntracked: input.allowedFiles };
  const attest = () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/jarvis-local-artifact-readback.mjs", import.meta.url))], {
      input: JSON.stringify(scope), encoding: "utf8", timeout: 15000, maxBuffer: 131072, windowsHide: true,
    });
    if (result.status !== 0 || result.error) throw Error("VERIFIER_REQUEST_READBACK_FAILED");
    const evidence = JSON.parse(result.stdout).attestation;
    if (evidence?.candidateRevision !== changeSet.candidateRevision || evidence?.artifactDigest !== changeSet.artifactDigest) throw Error("VERIFIER_REQUEST_READBACK_MISMATCH");
  };
  attest();
  const packet: ResidentVerifierRequest = { version: 1, executionContractDigest: input.executionContractDigest,
    expiresAt: Number.isFinite(Date.parse(job.approvalScope.expiresAt ?? "")) ? new Date(job.approvalScope.expiresAt!).toISOString() : "", request: {
      goalId: job.goalId, jobId: job.jobId, changeSetId: changeSet.changeSetId, builderId: changeSet.deviceId,
      baseRevision: changeSet.baseRevision, sourceRevision: changeSet.candidateRevision, artifactDigest: changeSet.artifactDigest,
      targetPath: input.targetPath, allowedUntracked: [...input.allowedFiles].sort(),
      requiredChecks: createDevelopmentVerificationPlan({ builderId: changeSet.deviceId, sourceRevision: changeSet.candidateRevision,
        artifactDigest: changeSet.artifactDigest, changedPaths: input.allowedFiles }).requiredChecks,
    }, files: [...input.allowedFiles].sort().map(path => {
      const bytes = readBoundedRuntimeFile(join(input.workspace, path), 131072);
      return { path, sha256: hash(bytes), contentBase64: bytes.toString("base64") };
    }) };
  validateResidentVerifierRequest(packet);
  attest();
  const bytes = Buffer.from(JSON.stringify(packet) + "\n");
  const requestFile = assertExternalRuntimePath(input.receiptFile + ".request.json", input.workspaces);
  mkdirSync(dirname(requestFile), { recursive: true });
  if (existsSync(requestFile)) {
    if (!readBoundedRuntimeFile(requestFile, MAX_VERIFIER_REQUEST_BYTES, input.workspaces).equals(bytes)) throw Error("VERIFIER_REQUEST_EXISTING_MISMATCH");
  } else {
    try { writeFileSync(requestFile, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST"
        || !readBoundedRuntimeFile(requestFile, MAX_VERIFIER_REQUEST_BYTES, input.workspaces).equals(bytes)) throw error;
    }
  }
  return { requestFile, sha256: hash(bytes) };
}
