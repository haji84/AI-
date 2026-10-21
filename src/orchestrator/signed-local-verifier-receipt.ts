import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { DevelopmentVerificationCheck, DevelopmentVerificationEvidence, DevelopmentVerificationPlan } from "./development-verification-plan.ts";
import type { DevelopmentChangeSet } from "./development-change-set.ts";

export interface SignedLocalVerifierCheck {
  check: DevelopmentVerificationCheck;
  status: "passed" | "failed" | "inconclusive";
  outputDigest: string;
  recordedAt: string;
}
export interface SignedLocalVerifierPayload {
  version: 1;
  verifierId: string;
  goalId: string;
  jobId: string;
  changeSetId: string;
  builderId: string;
  baseRevision: string;
  sourceRevision: string;
  artifactDigest: string;
  issuedAt: string;
  expiresAt: string;
  checks: SignedLocalVerifierCheck[];
}
export interface SignedLocalVerifierReceipt {
  payload: SignedLocalVerifierPayload;
  signatureBase64: string;
}
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const CHECKS: ReadonlySet<string> = new Set(["lint", "typecheck", "unit", "integration", "security", "build", "visual", "windows", "macos", "physical-iphone"]);

/** All fields have a fixed canonical order. A signed label is not evidence without an owner-pinned, separately controlled verification key. */
export function canonicalLocalVerifierPayload(payload: SignedLocalVerifierPayload): string {
  const p = payload;
  return JSON.stringify({
    version: p.version, verifierId: p.verifierId, goalId: p.goalId, jobId: p.jobId,
    changeSetId: p.changeSetId, builderId: p.builderId, baseRevision: p.baseRevision,
    sourceRevision: p.sourceRevision, artifactDigest: p.artifactDigest,
    issuedAt: p.issuedAt, expiresAt: p.expiresAt,
    checks: p.checks.map(c => ({ check: c.check, status: c.status,
      outputDigest: c.outputDigest, recordedAt: c.recordedAt })),
  });
}

/** Only a separately provisioned verifier holds the private key; the resident executor gets the public key. */
export function validateSignedLocalVerifierReceipt(input: {
  receipt: SignedLocalVerifierReceipt;
  publicKeyPem: string;
  plan: DevelopmentVerificationPlan;
  changeSet: DevelopmentChangeSet;
  goalId: string;
  now?: Date;
}): DevelopmentVerificationEvidence[] {
  const { receipt, plan, changeSet, goalId } = input;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      Object.keys(receipt).sort().join(",") !== "payload,signatureBase64" ||
      !receipt.payload || typeof receipt.payload !== "object" || Array.isArray(receipt.payload)) {
    throw Error("SIGNED_VERIFIER_RECEIPT_INVALID");
  }
  const p = receipt.payload;
  if (Object.keys(p).sort().join(",") !==
      ["version", "verifierId", "goalId", "jobId", "changeSetId", "builderId",
       "baseRevision", "sourceRevision", "artifactDigest", "issuedAt", "expiresAt", "checks"].sort().join(",")) {
    throw Error("SIGNED_VERIFIER_RECEIPT_SCHEMA_INVALID");
  }
  if (p.version !== 1 || !p.verifierId || p.verifierId.length > 128 ||
      p.verifierId === plan.builderId || p.builderId !== plan.builderId ||
      p.goalId !== goalId || p.jobId !== changeSet.jobId || p.changeSetId !== changeSet.changeSetId ||
      !revision(p.baseRevision) || p.baseRevision !== changeSet.baseRevision ||
      !revision(p.sourceRevision) || p.sourceRevision !== plan.sourceRevision ||
      !digest(p.artifactDigest) || p.artifactDigest !== plan.artifactDigest ||
      p.artifactDigest !== changeSet.artifactDigest ||
      !iso(p.issuedAt) || !iso(p.expiresAt) || !Array.isArray(p.checks) ||
      p.checks.length === 0 || p.checks.length > CHECKS.size) {
    throw Error("SIGNED_VERIFIER_BINDING_INVALID");
  }
  const now = (input.now ?? new Date()).getTime(), issued = Date.parse(p.issuedAt), expiry = Date.parse(p.expiresAt);
  if (issued > now + 60_000 || expiry <= now || expiry <= issued || expiry - issued > 24 * 3600_000) {
    throw Error("SIGNED_VERIFIER_RECEIPT_EXPIRED");
  }
  const seen = new Set<string>();
  for (const check of p.checks) {
    if (!check || typeof check !== "object" || Array.isArray(check) ||
        Object.keys(check).sort().join(",") !== "check,outputDigest,recordedAt,status" ||
        !CHECKS.has(check.check) || seen.has(check.check) ||
        !["passed", "failed", "inconclusive"].includes(check.status) || !digest(check.outputDigest) ||
        !iso(check.recordedAt) || Date.parse(check.recordedAt) < issued - 60_000 ||
        Date.parse(check.recordedAt) > expiry) {
      throw Error("SIGNED_VERIFIER_CHECK_INVALID");
    }
    seen.add(check.check);
  }
  if (typeof receipt.signatureBase64 !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(receipt.signatureBase64)) {
    throw Error("SIGNED_VERIFIER_SIGNATURE_INVALID");
  }
  let valid = false;
  try {
    const key = createPublicKey(input.publicKeyPem);
    valid = key.asymmetricKeyType === "ed25519" &&
      verifySignature(null, Buffer.from(canonicalLocalVerifierPayload(p), "utf8"), key, Buffer.from(receipt.signatureBase64, "base64"));
  } catch { valid = false; }
  if (!valid) throw Error("SIGNED_VERIFIER_SIGNATURE_INVALID");
  return p.checks.map(check => ({
    check: check.check, verifierId: p.verifierId,
    sourceRevision: p.sourceRevision, artifactDigest: p.artifactDigest,
    status: check.status, recordedAt: check.recordedAt,
  }));
}

/** Explicit path for the owner-pinned verifier output, never inside a writable candidate workspace. */
export function readSignedLocalVerifierReceipt(input: {
  receiptPath: string;
  publicKeyPem: string;
  plan: DevelopmentVerificationPlan;
  changeSet: DevelopmentChangeSet;
  goalId: string;
  now?: Date;
}): DevelopmentVerificationEvidence[] {
  if (!isAbsolute(input.receiptPath)) throw Error("SIGNED_VERIFIER_RECEIPT_PATH_INVALID");
  const bytes = readFileSync(input.receiptPath);
  if (bytes.length === 0 || bytes.length > 24_576) throw Error("SIGNED_VERIFIER_RECEIPT_SIZE_INVALID");
  const receipt: unknown = JSON.parse(bytes.toString("utf8"));
  return validateSignedLocalVerifierReceipt({ ...input, receipt: receipt as SignedLocalVerifierReceipt });
}
