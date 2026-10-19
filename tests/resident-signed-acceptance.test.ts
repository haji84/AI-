import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { localCandidateIdentity } from "../src/orchestrator/local-candidate-identity.ts";
import { canonicalLocalVerifierPayload, type SignedLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";
import { evaluateSignedFileAcceptance } from "../src/orchestrator/resident-signed-acceptance.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = new Date("2026-10-19T03:00:00.000Z");

test("acceptance binds an explicit criterion to signed checks and actual complete candidate bytes", async t => {
  const root = mkdtempSync(join(tmpdir(), "goriq-signed-acceptance-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"), workspace = join(root, "candidate");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q"); git("config", "core.autocrlf", "false");
  git("config", "user.name", "test-fixture"); git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "tests")); writeFileSync(join(repo, "tests", ".keep"), "baseline\n");
  git("add", "."); git("commit", "-qm", "fixture");
  const base = git("rev-parse", "HEAD"); git("worktree", "add", "--detach", workspace, base);
  const files = { "tests/result.txt": "accepted result\n", "tests/support.txt": "expected support\n" };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(workspace, path), content);
  const identity = localCandidateIdentity(base, "tests/result.txt", files);
  const changeSet = createDevelopmentChangeSet({ changeSetId: "change-a", jobId: "job-a", workItemId: "job-a:implement",
    deviceId: "builder", baseRevision: base, candidateRevision: identity.candidateRevision,
    changedPaths: Object.keys(files), affectedSymbols: [], patchDigest: identity.patchDigest,
    artifactDigest: identity.artifactDigest, artifactRef: `sha256:${identity.artifactDigest}`,
    evidenceDigest: hash("fixture"), rollback: { kind: "git-base", reference: base } });
  const plan = createDevelopmentVerificationPlan({ builderId: "builder", sourceRevision: identity.candidateRevision,
    artifactDigest: identity.artifactDigest, changedPaths: changeSet.changedPaths });
  const keys = generateKeyPairSync("ed25519");
  const payload: SignedLocalVerifierPayload = { version: 1, verifierId: "independent-fixture-signer", goalId: "goal-a",
    jobId: "job-a", changeSetId: "change-a", builderId: "builder", baseRevision: base,
    sourceRevision: plan.sourceRevision, artifactDigest: plan.artifactDigest, issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), checks: plan.requiredChecks.map(check => ({
      check, status: "passed", outputDigest: hash(check), recordedAt: now.toISOString() })) };
  const receiptPath = join(root, "receipt.json");
  const save = (p = payload) => writeFileSync(receiptPath, JSON.stringify({ payload: p,
    signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(p)), keys.privateKey).toString("base64") }));
  save();
  const input = { receiptPath, publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    plan, changeSet, goalId: "goal-a", workspace, targetPath: "tests/result.txt", now,
    criteria: [{ id: "criterion-2", description: "Exact approved result and support files", required: true }],
    contracts: [{ criterionId: "criterion-2", description: "Exact approved result and support files",
      expectedFiles: Object.entries(identity.fileHashes).map(([path, sha256]) => ({ path, sha256 })) }] };
  const result = await evaluateSignedFileAcceptance(input);
  assert.equal(result.length, 1); assert.equal(result[0]?.criterionId, "criterion-2");
  assert.equal(result[0]?.issuer, payload.verifierId); assert.equal(result[0]?.verified, true);
  assert.match(result[0]!.environment!, /^signed-receipt:sha256:/);
  assert.deepEqual(await evaluateSignedFileAcceptance(input), result, "resume must preserve evidence identity");

  await assert.rejects(() => evaluateSignedFileAcceptance({ ...input, goalId: "other-goal" }), /SIGNED_VERIFIER_BINDING/);
  await assert.rejects(() => evaluateSignedFileAcceptance({ ...input, contracts: [{ ...input.contracts[0]!, description: "Different criterion" }] }), /ACCEPTANCE_CONTRACT/);
  await assert.rejects(() => evaluateSignedFileAcceptance({ ...input, contracts: [] }), /ACCEPTANCE_CONTRACT/);
  await assert.rejects(() => evaluateSignedFileAcceptance({ ...input, contracts: [...input.contracts, ...input.contracts] }), /ACCEPTANCE_CONTRACT/);
  await assert.rejects(() => evaluateSignedFileAcceptance({ ...input, contracts: [{ ...input.contracts[0]!, expectedFiles: [{ path: "tests/result.txt", sha256: "f".repeat(64) }] }] }), /ACCEPTANCE_FILE_MISMATCH/);
  save({ ...payload, checks: payload.checks.map(c => ({ ...c, status: c.check === "security" ? "failed" : c.status })) });
  await assert.rejects(() => evaluateSignedFileAcceptance(input), /ACCEPTANCE_CHECKS_INCOMPLETE/);
  save();
  writeFileSync(join(workspace, "tests/support.txt"), "tampered support\n");
  await assert.rejects(() => evaluateSignedFileAcceptance(input), /ACCEPTANCE_CANDIDATE_MISMATCH/);
});
