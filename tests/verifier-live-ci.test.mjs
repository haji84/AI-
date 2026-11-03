import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";
import { assertHostedVerifierCI, auditLiveVerifierReceipt } from "../scripts/jarvis-verifier-live-ci.mjs";

const checks = ["lint", "typecheck", "unit", "integration", "security", "build"];
const commands = [["lint"], ["exec", "tsc", "--noEmit"], ["test"], ["test"], ["test:p8-security"], ["build", "--webpack"]];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "goriq-live-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receiptFile = join(root, "receipt.json"), logDirectory = receiptFile + ".logs";
  mkdirSync(logDirectory);
  const key = generateKeyPairSync("ed25519"), publicKeyPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const request = { goalId: "ci-goal", jobId: "ci-job", changeSetId: "ci-change", builderId: "ci-builder",
    verifierId: "ci-verifier", baseRevision: "a".repeat(40), sourceRevision: "b".repeat(64),
    artifactDigest: "c".repeat(64), targetPath: "docs/live-result.txt", allowedUntracked: ["docs/live-result.txt"],
    requiredChecks: [...checks], receiptFile };
  const expectedImage = "127.0.0.1:12345/verifier@sha256:" + "d".repeat(64), marker = "GORIQ_REAL_BOUNDARY_PROBE_PASS:fixture";
  const at = new Date().toISOString();
  const payload = { version: 1, verifierId: request.verifierId, goalId: request.goalId, jobId: request.jobId,
    changeSetId: request.changeSetId, builderId: request.builderId, baseRevision: request.baseRevision,
    sourceRevision: request.sourceRevision, artifactDigest: request.artifactDigest,
    issuedAt: at, expiresAt: new Date(Date.now() + 60_000).toISOString(), checks: [] };
  for (const [i, check] of checks.entries()) {
    const bytes = JSON.stringify({ sourceRevision: request.sourceRevision, fileHashes: { "docs/live-result.txt": "e".repeat(64) },
      command: "pnpm", args: commands[i], executionProfile: check === "build" ? "next-webpack-v1" : null,
      containerImage: expectedImage, exit: 0, signal: null,
      stdout: ["unit", "integration"].includes(check) ? marker : "real check output", stderr: "",
      errorCode: null, runErrorCode: null, closeObserved: true, cleanup: { attempted: true,
        containerName: "goriq-verifier-00000000-0000-4000-8000-" + String(i).padStart(12, "0"), confirmed: true,
        removal: { closeObserved: true, status: 1, errorCode: null },
        inspection: { closeObserved: true, status: 0, errorCode: null, stdout: "" } } }) + "\n";
    writeFileSync(join(logDirectory, check + ".json"), bytes);
    payload.checks.push({ check, status: "passed", outputDigest: sha(bytes), recordedAt: at });
  }
  const save = () => writeFileSync(receiptFile, JSON.stringify({ payload,
    signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(payload)), key.privateKey).toString("base64") }));
  save();
  const input = { request, publicKeyPem, expectedImage, boundaryMarker: marker,
    expectedFileHashes: { "docs/live-result.txt": "e".repeat(64) } };
  const changeLog = (name, change, resign = true) => {
    const file = join(logDirectory, name + ".json"), log = JSON.parse(readFileSync(file));
    change(log); const bytes = JSON.stringify(log) + "\n"; writeFileSync(file, bytes);
    if (resign) { payload.checks.find(c => c.check === name).outputDigest = sha(bytes); save(); }
  };
  return { input, payload, save, changeLog, receiptFile };
}

test("live CI accepts six signed exact-image logs with confirmed individual cleanup", t => {
  const f = fixture(t), result = auditLiveVerifierReceipt(f.input);
  assert.deepEqual(result.checks.map(c => c.check), checks);
  assert.equal(result.containerExecutionVerified, true);
  assert.equal(result.physicalAcceptanceVerified, false);
  assert.equal(result.receiptSha256, sha(readFileSync(f.receiptFile)));
});

test("retained log tampering fails even with a previously valid receipt signature", t => {
  const f = fixture(t);
  f.changeLog("unit", log => { log.stdout += "changed"; }, false);
  assert.throws(() => auditLiveVerifierReceipt(f.input), /LIVE_LOG_DIGEST_MISMATCH/);
});

test("a valid signature cannot turn a partial or failed check into full six-check acceptance", t => {
  const f = fixture(t);
  f.payload.checks.pop(); f.save();
  assert.throws(() => auditLiveVerifierReceipt(f.input), /LIVE_CHECK_SET_INVALID/);
  const g = fixture(t);
  g.payload.checks[0].status = "failed"; g.save();
  assert.throws(() => auditLiveVerifierReceipt(g.input), /LIVE_CHECK_NOT_PASSED/);
});

test("signed logs with a substituted image, command, source or file hash fail audit", t => {
  for (const change of [log => { log.containerImage = "other@sha256:" + "d".repeat(64); },
    log => { log.args = ["--version"]; }, log => { log.sourceRevision = "f".repeat(64); },
    log => { log.fileHashes["docs/live-result.txt"] = "f".repeat(64); }]) {
    const f = fixture(t); f.changeLog("lint", change);
    assert.throws(() => auditLiveVerifierReceipt(f.input), /LIVE_LOG_BINDING_INVALID/);
  }
});

test("unconfirmed cleanup, missing process close and missing boundary probe do not pass", t => {
  for (const change of [log => { log.cleanup.confirmed = false; }, log => { log.closeObserved = false; },
    log => { log.cleanup.inspection.stdout = log.cleanup.containerName; },
    log => { log.cleanup.inspection.status = 1; }, log => { log.errorCode = "ETIMEDOUT"; },
    log => { log.stdout = "suite ran without the live probe"; }]) {
    const f = fixture(t); f.changeLog("unit", change);
    assert.throws(() => auditLiveVerifierReceipt(f.input), /LIVE_LOG_EXECUTION_UNCONFIRMED|LIVE_BOUNDARY_PROBE_MISSING/);
  }
});

test("wrong public key or cross-Goal receipt is refused by the existing receipt consumer", t => {
  const f = fixture(t), other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => auditLiveVerifierReceipt({ ...f.input, publicKeyPem: other }), /SIGNATURE_INVALID/);
  assert.throws(() => auditLiveVerifierReceipt({ ...f.input,
    request: { ...f.input.request, goalId: "different-goal" } }), /BINDING_INVALID/);
});

test("a signed build log must identify the exact explicit Webpack production profile", t => {
  for (const change of [log => { delete log.executionProfile; },
    log => { log.executionProfile = "turbopack"; }, log => { log.args = ["build"]; }]) {
    const f = fixture(t); f.changeLog("build", change);
    assert.throws(() => auditLiveVerifierReceipt(f.input), /LIVE_LOG_BINDING_INVALID/);
  }
});

test("explicit live execution is limited to disposable hosted Linux, never local or self-hosted", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_TEMP: "/tmp/runner" };
  assert.doesNotThrow(() => assertHostedVerifierCI({ env, platform: "linux", argv: ["--execute-hosted-ci"] }));
  for (const changed of [{ ...env, GITHUB_ACTIONS: "false" }, { ...env, RUNNER_ENVIRONMENT: "self-hosted" },
    { ...env, RUNNER_OS: "Windows" }, { ...env, DOCKER_HOST: "tcp://remote:2375" },
    { ...env, DOCKER_CONTEXT: "remote" }, { ...env, RUNNER_TEMP: "relative" }]) {
    assert.throws(() => assertHostedVerifierCI({ env: changed, platform: "linux", argv: ["--execute-hosted-ci"] }), /LIVE_HOSTED_RUNNER_REQUIRED/);
  }
  assert.throws(() => assertHostedVerifierCI({ env, platform: "win32", argv: ["--execute-hosted-ci"] }), /LIVE_HOSTED_RUNNER_REQUIRED/);
  for (const argv of [[], ["--execute-hosted-ci", "anything"], ["--inspect"]]) {
    assert.throws(() => assertHostedVerifierCI({ env, platform: "linux", argv }), /LIVE_EXPLICIT_EXECUTION_REQUIRED/);
  }
});

test("running the live CI entry point locally fails visibly before doing setup", () => {
  const run = spawnSync(process.execPath, ["scripts/jarvis-verifier-live-ci.mjs", "--execute-hosted-ci"],
    { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "false" }, timeout: 5000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /LIVE_HOSTED_RUNNER_REQUIRED/);
});
