import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import {
  canonicalLocalVerifierPayload, validateSignedLocalVerifierReceipt,
  readSignedLocalVerifierReceipt, type SignedLocalVerifierPayload,
  type SignedLocalVerifierReceipt,
} from "../src/orchestrator/signed-local-verifier-receipt.ts";

const base = "a".repeat(40), artifact = "b".repeat(64), patch = "c".repeat(64);
const changeSet = createDevelopmentChangeSet({
  changeSetId: "change-1", jobId: "job-1", workItemId: "implement",
  deviceId: "local-ollama-builder", baseRevision: base,
  candidateRevision: "d".repeat(64), changedPaths: ["tests/fixtures/smoke.py"],
  affectedSymbols: [], patchDigest: patch, artifactDigest: artifact,
  artifactRef: "sha256:" + artifact, evidenceDigest: "e".repeat(64),
  rollback: { kind: "git-base", reference: base },
});
const plan = createDevelopmentVerificationPlan({
  builderId: changeSet.deviceId, sourceRevision: changeSet.candidateRevision,
  artifactDigest: changeSet.artifactDigest, changedPaths: changeSet.changedPaths,
});
const now = new Date("2026-10-18T01:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const pem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const signer = (payload: SignedLocalVerifierPayload): SignedLocalVerifierReceipt => ({
  payload, signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(payload)), keys.privateKey).toString("base64"),
});
function data(): SignedLocalVerifierPayload {
  return {
    version: 1, verifierId: "zbook-isolated-verifier",
    goalId: "goal-1", jobId: changeSet.jobId, changeSetId: changeSet.changeSetId,
    builderId: plan.builderId, baseRevision: changeSet.baseRevision,
    sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest,
    issuedAt: "2026-10-18T00:59:00.000Z", expiresAt: "2026-10-18T01:20:00.000Z",
    checks: plan.requiredChecks.map(check => ({ check, status: "passed" as const,
      outputDigest: "f".repeat(64), recordedAt: "2026-10-18T00:59:15.000Z" })),
  };
}
const verify = (receipt: SignedLocalVerifierReceipt, opt: Partial<Parameters<typeof validateSignedLocalVerifierReceipt>[0]> = {}) =>
  validateSignedLocalVerifierReceipt({ receipt, publicKeyPem: pem, plan, changeSet, goalId: "goal-1", now, ...opt });

test("separately signed development checks bind exact Goal/Change Set and all required profiles", () => {
  const signed = signer(data());
  const evidence = verify(signed);
  assert.equal(evidence.length, plan.requiredChecks.length);
  assert.ok(evidence.every(e => e.verifierId === "zbook-isolated-verifier"
    && e.artifactDigest === artifact && e.sourceRevision === changeSet.candidateRevision));
  const root = mkdtempSync(join(tmpdir(), "goriq-receipt-"));
  try {
    const file = join(root, "verifier.json");
    writeFileSync(file, JSON.stringify(signed));
    assert.deepEqual(readSignedLocalVerifierReceipt({
      receiptPath: file, publicKeyPem: pem, changeSet, plan, goalId: "goal-1", now,
    }), evidence);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("Builder text, forged verifier label and changed check result cannot forge Ed25519 evidence", () => {
  const forged = signer(data());
  forged.payload.checks[0]!.status = "passed";
  forged.payload.checks[0]!.outputDigest = "1".repeat(64);
  assert.throws(() => verify(forged), /SIGNED_VERIFIER_SIGNATURE_INVALID/);
  const renamed = signer(data());
  renamed.payload.verifierId = "independent-just-trust-me";
  assert.throws(() => verify(renamed), /SIGNED_VERIFIER_SIGNATURE_INVALID/);
  const wrongKey = generateKeyPairSync("ed25519").publicKey.export({format:"pem",type:"spki"}).toString();
  assert.throws(() => verify(signer(data()), {publicKeyPem:wrongKey}), /SIGNED_VERIFIER_SIGNATURE_INVALID/);
});
test("replay to another Goal, revision, Builder, candidate or clock fails closed", () => {
  const good = signer(data());
  assert.throws(() => verify(good, {goalId:"another-goal"}), /SIGNED_VERIFIER_BINDING_INVALID/);
  assert.throws(() => verify(good, {now: new Date("2026-10-19T03:00:00.000Z")}), /SIGNED_VERIFIER_RECEIPT_EXPIRED/);
  assert.throws(() => verify(signer({...data(),builderId:"builder-other"})), /SIGNED_VERIFIER_BINDING_INVALID/);
  assert.throws(() => verify(signer({...data(),sourceRevision:"9".repeat(64)})), /SIGNED_VERIFIER_BINDING_INVALID/);
  assert.throws(() => verify(signer({...data(),changeSetId:"different"})), /SIGNED_VERIFIER_BINDING_INVALID/);
});
test("unknown/duplicate checks and unsigned fields are not accepted as executable evidence", () => {
  const duplicate = data();
  duplicate.checks.push(duplicate.checks[0]!);
  assert.throws(() => verify(signer(duplicate)), /SIGNED_VERIFIER_CHECK_INVALID/);
  const bad = data();
  bad.checks[0]!.check = "fictitious" as "lint";
  assert.throws(() => verify(signer(bad)), /SIGNED_VERIFIER_CHECK_INVALID/);
  const expanded = signer(data()) as SignedLocalVerifierReceipt & { approved?: boolean };
  expanded.approved = true;
  assert.throws(() => verify(expanded), /SIGNED_VERIFIER_RECEIPT_INVALID/);
  const builder = signer({...data(), verifierId:"local-ollama-builder"});
  assert.throws(() => verify(builder), /SIGNED_VERIFIER_BINDING_INVALID/);
});
