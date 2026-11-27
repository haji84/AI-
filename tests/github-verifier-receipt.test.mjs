import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { crc32 } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as live from "../scripts/jarvis-verifier-live-ci.mjs";
import { canonicalLocalVerifierPayload } from "../src/orchestrator/signed-local-verifier-receipt.ts";

const checks = ["lint", "typecheck", "unit", "integration", "security", "build"];
const commands = [["lint"], ["exec", "tsc", "--noEmit"], ["test"], ["test"], ["test:p8-security"], ["build", "--webpack"]];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Fixture signatures and process records below are synthetic software-test
// data. They are never evidence of hosted execution or a provisioned signer.
function rawFixture() {
  const key = generateKeyPairSync("ed25519"), at = new Date().toISOString();
  const request = { goalId: "ci-goal-fixture", jobId: "ci-job-fixture", changeSetId: "ci-change-fixture",
    builderId: "ci-untrusted-container", verifierId: "ci-host-signer", baseRevision: "a".repeat(40),
    sourceRevision: "b".repeat(64), artifactDigest: "c".repeat(64), allowedUntracked: ["docs/live-result.txt"] };
  const payload = { version: 1, verifierId: request.verifierId, goalId: request.goalId, jobId: request.jobId,
    changeSetId: request.changeSetId, builderId: request.builderId, baseRevision: request.baseRevision,
    sourceRevision: request.sourceRevision, artifactDigest: request.artifactDigest, issuedAt: at,
    expiresAt: new Date(Date.now() + 600000).toISOString(), checks: [] };
  const expectedImage = `127.0.0.1:12345/verifier@sha256:${"d".repeat(64)}`, boundaryMarker = "GORIQ_REAL_BOUNDARY_PROBE_PASS:fixture";
  const expectedFileHashes = { "docs/live-result.txt": "e".repeat(64) }, logs = new Map();
  for (const [i, check] of checks.entries()) {
    const bytes = Buffer.from(JSON.stringify({ sourceRevision: request.sourceRevision, fileHashes: expectedFileHashes,
      command: "pnpm", args: commands[i], timeoutMs: ["unit", "integration"].includes(check) ? 300000 : 180000,
      executionProfile: check === "build" ? "next-webpack-v1" : null, containerImage: expectedImage,
      exit: check === "lint" ? 1 : 0, signal: null, stdout: ["unit", "integration"].includes(check) ? boundaryMarker : "fixture output", stderr: "",
      errorCode: null, runErrorCode: null, closeObserved: true, cleanup: { attempted: true, confirmed: true,
        containerName: `goriq-verifier-00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        removal: { closeObserved: true, errorCode: null }, inspection: { closeObserved: true, errorCode: null, status: 0, stdout: "" } } }) + "\n");
    logs.set(check, bytes);
    payload.checks.push({ check, status: check === "lint" ? "failed" : "passed", outputDigest: hash(bytes), recordedAt: at });
  }
  const seal = () => Buffer.from(JSON.stringify({ payload, signatureBase64: sign(null, Buffer.from(canonicalLocalVerifierPayload(payload)), key.privateKey).toString("base64") }) + "\n");
  const input = () => ({ request, publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    expectedImage, expectedFileHashes, boundaryMarker, receiptBytes: seal(), logs });
  const change = (check, mutate) => {
    const log = JSON.parse(logs.get(check)); mutate(log);
    const bytes = Buffer.from(JSON.stringify(log) + "\n"); logs.set(check, bytes);
    payload.checks.find(item => item.check === check).outputDigest = hash(bytes);
  };
  return { input, payload, logs, change };
}

test("complete CI audit preserves normal failed checks and validates all six raw records", () => {
  const f = rawFixture();
  assert.doesNotThrow(() => live.auditCompleteLiveVerifierEvidence(f.input()));
  const result = live.auditCompleteLiveVerifierEvidence(f.input());
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.map(item => item.status), ["failed", "passed", "passed", "passed", "passed", "passed"]);
  assert.equal(result.physicalAcceptanceVerified, false);
});

test("complete CI audit refuses missing, inconclusive, infrastructure, timeout, cleanup and status-mismatched records", () => {
  for (const mutate of [f => f.logs.delete("build"), f => { f.payload.checks[0].status = "inconclusive"; },
    f => f.change("lint", log => { log.exit = 125; }), f => f.change("lint", log => { log.exit = 126; }),
    f => f.change("lint", log => { log.exit = 127; }), f => f.change("lint", log => { log.exit = 137; }),
    f => f.change("lint", log => { log.signal = "SIGKILL"; }), f => f.change("lint", log => { log.timeoutMs = 999999; }),
    f => f.change("lint", log => { log.cleanup.confirmed = false; }), f => f.change("lint", log => { log.exit = 0; }),
    f => f.change("unit", log => { log.stdout = "missing boundary"; })]) {
    const f = rawFixture(); mutate(f);
    assert.throws(() => live.auditCompleteLiveVerifierEvidence(f.input()), /LIVE_/);
  }
});

test("legacy PASS-only auditor retains its original serialized output contract", t => {
  const f = rawFixture(), root = mkdtempSync(join(tmpdir(), "github-verifier-legacy-")), receiptFile = join(root, "receipt.json");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  f.payload.checks[0].status = "passed"; f.change("lint", log => { log.exit = 0; });
  const input = f.input(); mkdirSync(receiptFile + ".logs"); writeFileSync(receiptFile, input.receiptBytes);
  for (const [check, bytes] of f.logs) writeFileSync(join(receiptFile + ".logs", check + ".json"), bytes);
  const result = live.auditLiveVerifierReceipt({ ...input, request: { ...input.request, receiptFile } });
  assert.deepEqual(Object.keys(result).sort(), ["checks", "containerExecutionVerified", "physicalAcceptanceVerified", "receiptSha256"]);
  assert.ok(result.checks.every(check => Object.keys(check).sort().join(",") === "check,containerName,outputDigest"));
});

const protectedPaths = [".github/workflows/ci.yml", "scripts/jarvis-verifier-live-ci.mjs", "scripts/jarvis-independent-check-runner.mjs",
  "scripts/jarvis-independent-artifact-attestation.mjs", "scripts/jarvis-verifier-safe-git.mjs", "scripts/jarvis-verifier-container.mjs",
  "scripts/jarvis-verifier-offline-workspace.mjs", "scripts/jarvis-verifier-resource-observer.mjs", "src/orchestrator/local-candidate-identity.ts",
  "src/orchestrator/development-verification-plan.ts", "src/orchestrator/signed-local-verifier-receipt.ts", "tests/fixtures/verifier-image/Dockerfile",
  "scripts/jarvis-github-verifier-receipt.mjs", "scripts/jarvis-verifier-request-transfer.mjs", "src/orchestrator/resident-verifier-request.ts",
  "src/orchestrator/resident-runtime-files.ts", "package.json", "pnpm-lock.yaml"];
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function zip(files) {
  const entries = [], central = []; let offset = 0;
  for (const [name, bytes] of files) {
    const encoded = Buffer.from(name), local = Buffer.alloc(30), header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(encoded.length, 26);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc32(bytes), 16);
    header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(encoded.length, 28); header.writeUInt32LE(offset, 42);
    entries.push(local, encoded, bytes); central.push(header, encoded); offset += local.length + encoded.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, directory, end]);
}
function githubFixture() {
  const base = "1".repeat(40), published = "2".repeat(40), baseTree = "3".repeat(40), candidateTree = "4".repeat(40);
  const at = Date.now(), iso = delta => new Date(at + delta).toISOString();
  const original = Buffer.from("export const value = 1;\n"), changed = Buffer.from("export const value = 2;\n");
  const probe = Buffer.from("// owner-frozen normal profile probe, fixture only\n");
  const before = new Map(protectedPaths.map(path => [path, Buffer.from(`reviewed:${path}\n`)])); before.set("src/value.ts", original);
  const after = new Map(before); after.set("src/value.ts", changed); after.set("tests/frozen-probe.test.mjs", probe);
  const edits = [{ path: "src/value.ts", beforeSha256: hash(original), afterSha256: hash(changed) }];
  const manifest = [["src/value.ts", hash(original), hash(changed)], ["tests/frozen-probe.test.mjs", null, hash(probe)]];
  const sourceRevision = hash(`candidate\0${base}\0${hash(`tracked-edits-v2\0${JSON.stringify(manifest)}`)}`);
  const packet = { version: 2, kind: "tracked-repair-verifier-request", executionContractDigest: "5".repeat(64), expiresAt: iso(3600000),
    request: { goalId: "actual-goal", jobId: "actual-job", changeSetId: "actual-change", builderId: "actual-model-builder", baseRevision: base,
      sourceRevision, artifactDigest: hash(changed), targetPath: "src/value.ts", allowedUntracked: ["tests/frozen-probe.test.mjs"],
      requiredChecks: [...checks], trackedEdits: { version: 2, files: edits } },
    files: [["src/value.ts", changed], ["tests/frozen-probe.test.mjs", probe]].map(([path, bytes]) => ({ path, sha256: hash(bytes), contentBase64: bytes.toString("base64") })) };
  const requestBytes = Buffer.from(JSON.stringify(packet) + "\n"), key = generateKeyPairSync("ed25519");
  const pins = { version: 1, repository: "haji84/AI-", requestSha256: hash(requestBytes), executionContractDigest: packet.executionContractDigest,
    request: globalThis.structuredClone(packet.request), notBefore: iso(-120000), expiresAt: iso(3600000), candidateCommit: published,
    verifierId: "mac-actual-verifier", publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
    workflowId: 100, runId: 200, runAttempt: 1, jobId: 300, artifactId: 400 };
  const raw = rawFixture(), ci = raw.input().request, id = "00000000-0000-4000-8000-000000000001";
  const receiptPath = "/home/runner/work/_temp/goriq-verifier-live-Ab123x/receipt.json";
  const ciFiles = { "docs/verifier-live-result.txt": hash("Full repository real-container CI candidate\n"),
    "tests/verifier-ci-boundary-probe.test.mjs": hash(live.boundaryProbe("/home/runner/work/_temp/goriq-verifier-live-Ab123x/ephemeral-ci-signer.pem", `GORIQ_REAL_BOUNDARY_PROBE_PASS:${id}`)) };
  const ciSource = hash(`candidate\0${published}\0${hash(`create-set-v1\0${JSON.stringify(Object.entries(ciFiles))}`)}`);
  Object.assign(ci, { goalId: `ci-goal-${id}`, jobId: `ci-job-${id}`, changeSetId: `ci-change-${id}`, baseRevision: published,
    sourceRevision: ciSource, artifactDigest: ciFiles["docs/verifier-live-result.txt"], allowedUntracked: Object.keys(ciFiles) });
  Object.assign(raw.payload, { goalId: ci.goalId, jobId: ci.jobId, changeSetId: ci.changeSetId, baseRevision: published,
    sourceRevision: ciSource, artifactDigest: ci.artifactDigest, issuedAt: iso(-80000), expiresAt: iso(600000) });
  for (const check of checks) {
    raw.payload.checks.find(item => item.check === check).recordedAt = iso(-30000);
    raw.change(check, log => { log.sourceRevision = ciSource; log.fileHashes = ciFiles;
      if (["unit", "integration"].includes(check)) log.stdout = `GORIQ_REAL_BOUNDARY_PROBE_PASS:${id}`; });
  }
  const image = raw.input().expectedImage, files = new Map(raw.logs.entries().map(([name, bytes]) => [`checks/${name}.json`, bytes]));
  const put = (name, data) => files.set(name, Buffer.from(JSON.stringify(data) + "\n"));
  files.set("public-key.pem", Buffer.from(raw.input().publicKeyPem)); files.set("receipt.json", raw.input().receiptBytes);
  put("runner-result.json", { verified: false, checks: raw.payload.checks.map(({ check, status, outputDigest }) => ({ check, status, outputDigest })),
    receiptPath, artifactDigest: ci.artifactDigest, sourceRevision: ciSource });
  put("image.json", { image, buildProfile: "next-webpack-v1", buildContextHashes: Object.fromEntries([
    ["package.json", "package.json"], ["pnpm-lock.yaml", "pnpm-lock.yaml"], ["Dockerfile", "tests/fixtures/verifier-image/Dockerfile"],
    ["jarvis-verifier-offline-workspace.mjs", "scripts/jarvis-verifier-offline-workspace.mjs"]].map(([name, path]) => [name, hash(before.get(path))])) });
  put("environment.json", { evidenceClass: "HOSTED_CONTAINER_CI", physicalAcceptanceVerified: false, baseRevision: published,
    githubRunId: "200", node: "v24.19.0", limits: { timeoutMs: 180000, timeoutMsByCheck: Object.fromEntries(checks.map(check => [check, ["unit", "integration"].includes(check) ? 300000 : 180000])),
      memoryBytes: 2147483648, pids: 128, tmpfsMiB: 1536, network: "none", uid: 65534 } });
  put("result.json", { status: "FAILED", physicalAcceptanceVerified: false, baseRevision: published, image,
    error: "LIVE_CHECK_NOT_PASSED", fixtureCleanupConfirmed: true });
  const artifact = { id: 400, name: `independent-verifier-container-${published}`, expired: false, created_at: iso(-20000), expires_at: iso(86400000),
    workflow_run: { id: 200, head_sha: published } };
  const run = { id: 200, run_attempt: 1, workflow_id: 100, event: "workflow_dispatch", head_sha: published, path: ".github/workflows/ci.yml",
    status: "completed", conclusion: "failure", created_at: iso(-110000), updated_at: iso(-10000), repository: { full_name: "haji84/AI-" }, head_repository: { full_name: "haji84/AI-" } };
  const job = { id: 300, run_id: 200, run_attempt: 1, head_sha: published, name: "independent-verifier-container", status: "completed", conclusion: "failure",
    started_at: iso(-90000), completed_at: iso(-10000), labels: ["ubuntu-24.04"], runner_group_name: "GitHub Actions", runner_group_id: 0, steps: [
      { name: "Run actions/checkout@v4", status: "completed", conclusion: "success" }, { name: "Run actions/setup-node@v4", status: "completed", conclusion: "success" },
      { name: "Real restricted-container six-check verification", status: "completed", conclusion: "failure" }, { name: "Retain hosted-container evidence", status: "completed", conclusion: "success" }] };
  const root = "/repos/haji84/AI-", responses = new Map([
    [`${root}/git/commits/${base}`, { sha: base, tree: { sha: baseTree } }], [`${root}/git/commits/${published}`, { sha: published, tree: { sha: candidateTree }, parents: [{ sha: base }] }],
    [`${root}/git/trees/${baseTree}?recursive=1`, { sha: baseTree, truncated: false, tree: [...before].map(([path, bytes]) => ({ path, mode: "100644", type: "blob", sha: gitBlob(bytes), size: bytes.length })) }],
    [`${root}/git/trees/${candidateTree}?recursive=1`, { sha: candidateTree, truncated: false, tree: [...after].map(([path, bytes]) => ({ path, mode: "100644", type: "blob", sha: gitBlob(bytes), size: bytes.length })) }],
    [`${root}/actions/workflows/100`, { id: 100, path: ".github/workflows/ci.yml", state: "active" }], [`${root}/actions/runs/200`, run],
    [`${root}/actions/runs/200/attempts/1`, run], [`${root}/actions/runs/200/attempts/1/jobs?per_page=100`, { total_count: 1, jobs: [job] }],
    [`${root}/actions/artifacts/400`, artifact], [`${root}/actions/runs/200/artifacts?per_page=100`, { total_count: 1, artifacts: [artifact] }],
  ]);
  for (const bytes of [...before.values(), ...after.values()]) responses.set(`${root}/git/blobs/${gitBlob(bytes)}`, { sha: gitBlob(bytes), size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
  let signCalls = 0; const calls = [];
  const transport = async (path) => {
    calls.push(path); if (path === `${root}/actions/artifacts/400/zip`) return zip(files);
    assert.ok(responses.has(path), `unexpected API request ${path}`);
    const response = responses.get(path); return Buffer.isBuffer(response) ? Buffer.from(response) : Buffer.from(JSON.stringify(response));
  };
  const refresh = () => { const archive = zip(files); artifact.size_in_bytes = archive.length; artifact.digest = `sha256:${hash(archive)}`; };
  refresh();
  responses.set(`${root}/actions/jobs/300/logs`, Buffer.from([
    "2026-11-27T06:54:25.0000000Z ##[group]Run actions/upload-artifact@v4",
    `2026-11-27T06:54:25.0000000Z   name: ${artifact.name}`,
    "2026-11-27T06:54:25.0000000Z ##[endgroup]",
    `2026-11-27T06:54:26.0000000Z SHA256 digest of uploaded artifact zip is ${artifact.digest.slice(7)}`,
    `2026-11-27T06:54:27.0000000Z Artifact ${artifact.name}.zip successfully finalized. Artifact ID 400`,
    `2026-11-27T06:54:27.0000000Z Artifact ${artifact.name} has been successfully uploaded! Final size is ${artifact.size_in_bytes} bytes. Artifact ID is 400`,
    "2026-11-27T06:54:27.0000000Z Artifact download URL: https://github.com/haji84/AI-/actions/runs/200/artifacts/400",
    "2026-11-27T06:54:28.0000000Z ##[group]Run actions/upload-artifact@v4",
    "2026-11-27T06:54:28.0000000Z   name: independent-verifier-resource-observer-200-1",
    "2026-11-27T06:54:28.0000000Z ##[endgroup]",
    `2026-11-27T06:54:29.0000000Z SHA256 digest of uploaded artifact zip is ${"9".repeat(64)}`,
  ].join("\r\n") + "\r\n"));
  return { pins, packet, requestBytes, files, responses, refresh, calls, transport, job, run, artifact, before, after,
    signerTransport: { publicKeyPem: pins.publicKeyPem, sign: bytes => { signCalls++; return sign(null, bytes, key.privateKey).toString("base64"); } },
    signCalls: () => signCalls };
}

async function adapter() {
  try { return await import("../scripts/jarvis-github-verifier-receipt.mjs"); }
  catch (error) { assert.fail(`production GitHub verifier adapter unavailable: ${error.code}`); }
}

test("authenticated raw GitHub evidence maps distinct CI identity to a NEW actual Goal-bound signed FAIL receipt", async () => {
  const api = await adapter(), f = githubFixture();
  const result = await api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
    provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport });
  assert.equal(result.receipt.payload.goalId, "actual-goal");
  assert.equal(result.receipt.payload.sourceRevision, f.pins.request.sourceRevision);
  assert.deepEqual(result.receipt.payload.checks.map(check => check.status), ["failed", "passed", "passed", "passed", "passed", "passed"]);
  assert.equal(f.signCalls(), 1);
  for (const check of result.receipt.payload.checks) {
    const bytes = result.envelopes.get(check.check); assert.equal(hash(bytes), check.outputDigest);
    const envelope = JSON.parse(bytes);
    assert.equal(envelope.requestSha256, f.pins.requestSha256);
    assert.equal(envelope.github.artifactId, 400);
    assert.notEqual(envelope.ci.sourceRevision, f.pins.request.sourceRevision);
    assert.equal(envelope.rawOutputSha256, hash(f.files.get(`checks/${check.check}.json`)));
    assert.equal(envelope.physicalAcceptanceVerified, false);
  }
  assert.ok(f.calls.includes("/repos/haji84/AI-/actions/artifacts/400/zip"));
});

test("request pins, immutable tree, workflow, run, artifact and raw-log mismatches never reach the signer", async () => {
  const api = await adapter();
  for (const mutate of [f => { f.pins.requestSha256 = "0".repeat(64); }, f => { f.pins.request.jobId = "other-job"; },
    f => { f.run.head_sha = "9".repeat(40); }, f => { f.run.run_attempt = 2; },
    f => { f.run.event = "pull_request"; }, f => { f.responses.get("/repos/haji84/AI-/actions/workflows/100").path = "other.yml"; },
    f => { f.job.steps[2].conclusion = "cancelled"; }, f => { f.job.runner_group_name = "candidate-runner"; },
    f => { f.responses.get(`/repos/haji84/AI-/git/trees/${"4".repeat(40)}?recursive=1`).tree.push({ path: "src/extra.ts", mode: "100644", type: "blob", sha: "e".repeat(40) }); },
    f => { f.responses.get(`/repos/haji84/AI-/git/trees/${"4".repeat(40)}?recursive=1`).truncated = true; },
    f => { f.artifact.digest = `sha256:${"0".repeat(64)}`; }, f => { f.files.set("checks/unit.json", Buffer.from("tampered\n")); f.refresh(); },
    f => { f.files.set("../escape.json", Buffer.from("unsafe")); f.refresh(); },
    f => { const image = JSON.parse(f.files.get("image.json")); image.buildContextHashes.Dockerfile = "0".repeat(64); f.files.set("image.json", Buffer.from(JSON.stringify(image))); f.refresh(); },
    f => { f.pins.expiresAt = new Date(Date.now() - 1).toISOString(); }]) {
    const f = githubFixture(); mutate(f);
    await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
      provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport }));
    assert.equal(f.signCalls(), 0, "refused provenance must never reach the actual signer");
  }
});

for (const group of ["nonzero", "missing"]) {
  test(`a ${group} runner group ID refuses signing despite the hosted display name and label`, async () => {
    const api = await adapter(), f = githubFixture();
    if (group === "nonzero") f.job.runner_group_id = 987;
    else delete f.job.runner_group_id;
    await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
      provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport }), /GITHUB_VERIFIER_JOB_MISMATCH/);
    assert.equal(f.signCalls(), 0, "unproved hosted runner must never reach the owner signer");
  });
}

test("caller green JSON cannot replace the code-owned authenticated provider", async () => {
  const api = await adapter(), f = githubFixture();
  await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
    provider: { green: true, checks }, signerTransport: f.signerTransport }), /GITHUB_VERIFIER_PROVIDER/);
  assert.equal(f.signCalls(), 0);
});

test("immutable output bundle replays the same audited receipt without signing again and refuses envelope substitution", async t => {
  const api = await adapter(), f = githubFixture(), root = mkdtempSync(join(tmpdir(), "github-verifier-bundle-")), output = join(root, "accepted");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { requestBytes: f.requestBytes, pins: f.pins, provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport };
  const first = await api.issueGitHubVerifierReceipt(input);
  assert.doesNotThrow(() => api.persistGitHubVerifierReceipt(first, output));
  const receiptPath = join(output, "receipt.json"), before = readFileSync(receiptPath);
  const existing = api.readExistingGitHubVerifierReceipt(output);
  const replay = await api.issueGitHubVerifierReceipt({ ...input, existing });
  assert.equal(replay.reused, true); assert.equal(f.signCalls(), 1);
  api.persistGitHubVerifierReceipt(replay, output); assert.ok(readFileSync(receiptPath).equals(before));
  existing.envelopes.set("lint", Buffer.from("substituted envelope"));
  await assert.rejects(() => api.issueGitHubVerifierReceipt({ ...input, existing }), /REPLAY_MISMATCH/);
  assert.equal(f.signCalls(), 1);
  writeFileSync(join(output, "receipt.json.logs", "lint.json"), "corrupted");
  assert.throws(() => api.persistGitHubVerifierReceipt(first, output), /OUTPUT_MISMATCH/);
  assert.ok(readFileSync(receiptPath).equals(before));
});

test("CI fixture key cannot become the actual Goal verifier key even with host pins", async () => {
  const api = await adapter(), f = githubFixture();
  f.pins.publicKeyPem = f.files.get("public-key.pem").toString("utf8");
  const transport = { publicKeyPem: f.pins.publicKeyPem, sign: () => { throw Error("fixture signer must never be called"); } };
  await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
    provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: transport }), /PRINCIPAL/);
});

test("operator CLI is inert without explicit operator execution before any auth or signing", () => {
  const result = spawnSync(process.execPath, ["scripts/jarvis-github-verifier-receipt.mjs"], { encoding: "utf8", timeout: 5000,
    env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", GORIQ_VERIFIER_OPERATOR_ISOLATED: "" } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /GITHUB_VERIFIER_EXPLICIT_OPERATOR_REQUIRED/);
});

test("authenticated artifact size and a run attempt changed during audit cannot authorize signing", async () => {
  const api = await adapter();
  for (const variant of ["size", "changed-run"]) {
    const f = githubFixture(); let runReads = 0;
    if (variant === "size") f.artifact.size_in_bytes++;
    const transport = path => {
      if (variant === "changed-run" && path === "/repos/haji84/AI-/actions/runs/200" && ++runReads > 1) {
        return Buffer.from(JSON.stringify({ ...f.run, run_attempt: 2 }));
      }
      return f.transport(path);
    };
    await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
      provider: api.createGitHubVerifierProvider({ transport }), signerTransport: f.signerTransport }));
    assert.equal(f.signCalls(), 0);
  }
});

test("archive decoder refuses encrypted entries, links, duplicate names, CRC corruption and oversized declarations", async () => {
  const api = await adapter(), f = githubFixture();
  for (const mutate of [bytes => { bytes.writeUInt16LE(1, 6); }, bytes => {
    const central = bytes.readUInt32LE(bytes.length - 6); bytes.writeUInt32LE(0xa1ff0000, central + 38);
  }, bytes => { const central = bytes.readUInt32LE(bytes.length - 6); bytes.writeUInt32LE(100 * 1024 * 1024, central + 24); },
    bytes => { bytes[30 + bytes.readUInt16LE(26)] ^= 1; }]) {
    const bytes = zip(f.files); mutate(bytes); assert.throws(() => api.readGitHubVerifierArchive(bytes), /GITHUB_VERIFIER_ARCHIVE/);
  }
  const bytes = zip(f.files), central = bytes.readUInt32LE(bytes.length - 6);
  // A name mismatch between the local and central directory is also refused.
  bytes[central + 46] ^= 1;
  assert.throws(() => api.readGitHubVerifierArchive(bytes), /GITHUB_VERIFIER_ARCHIVE/);
  const duplicate = { size: f.files.size + 1, *[Symbol.iterator]() { yield* f.files; yield ["receipt.json", f.files.get("receipt.json")]; } };
  assert.throws(() => api.readGitHubVerifierArchive(zip(duplicate)), /GITHUB_VERIFIER_ARCHIVE_PATH/);
});

test("only the pinned independent job's single matching upload group can link the actual artifact", async () => {
  const api = await adapter(), path = "/repos/haji84/AI-/actions/jobs/300/logs";
  for (const mutate of [text => text.replace("Artifact ID 400", "Artifact ID 401"),
    text => text.replace("/runs/200/artifacts/400", "/runs/999/artifacts/400"),
    text => text.replace("  name: independent-verifier-container-", "  name: unrelated-artifact-"),
    text => {
      const lines = text.split("\r\n"), digest = lines.splice(3, 1)[0]; lines.push(digest); return lines.join("\r\n");
    }, text => text + text]) {
    const f = githubFixture(); f.responses.set(path, Buffer.from(mutate(f.responses.get(path).toString())));
    await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
      provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport }), /UPLOAD/);
    assert.equal(f.signCalls(), 0);
  }
});

function pullRequestFixture() {
  const f = githubFixture(), synthetic = "6".repeat(40), oldName = f.artifact.name;
  f.run.event = "pull_request";
  f.artifact.name = `independent-verifier-container-${synthetic}`;
  const logPath = "/repos/haji84/AI-/actions/jobs/300/logs";
  f.responses.set(logPath, Buffer.from(f.responses.get(logPath).toString().replaceAll(oldName, f.artifact.name)));
  const merge = { sha: synthetic, parents: [{ sha: f.packet.request.baseRevision }, { sha: f.pins.candidateCommit }], tree: { sha: "4".repeat(40) } };
  f.responses.set(`/repos/haji84/AI-/git/commits/${synthetic}`, merge);
  return { ...f, synthetic, merge };
}

test("existing PR CI reuses its exact candidate HEAD through an authenticated equal-tree synthetic merge mapping", async () => {
  const api = await adapter(), f = pullRequestFixture();
  const result = await api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
    provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport });
  assert.equal(f.signCalls(), 1);
  assert.ok(f.calls.includes(`/repos/haji84/AI-/git/commits/${f.synthetic}`));
  assert.equal(result.receipt.payload.baseRevision, f.packet.request.baseRevision);
  assert.equal(result.receipt.payload.sourceRevision, f.packet.request.sourceRevision);
  const envelope = JSON.parse(result.envelopes.get("lint"));
  assert.equal(envelope.github.commit, f.pins.candidateCommit);
  assert.deepEqual(envelope.github.pullRequestMerge, { commit: f.synthetic, parents: [f.packet.request.baseRevision, f.pins.candidateCommit], tree: "4".repeat(40) });
  assert.notEqual(envelope.ci.sourceRevision, f.packet.request.sourceRevision);
  assert.equal(envelope.github.artifactName, `independent-verifier-container-${f.synthetic}`);
});

test("PR synthetic merge mismatches, event disagreement and candidate drift refuse the signer", async () => {
  const api = await adapter();
  for (const mutate of [f => { f.merge.parents.reverse(); }, f => { f.merge.parents[0].sha = "9".repeat(40); },
    f => { f.merge.parents[1].sha = "9".repeat(40); }, f => { f.merge.parents.push({ sha: "9".repeat(40) }); },
    f => { f.merge.tree.sha = "9".repeat(40); }, f => { f.merge.sha = "9".repeat(40); },
    f => { f.responses.delete(`/repos/haji84/AI-/git/commits/${f.synthetic}`); },
    f => { f.responses.set("/repos/haji84/AI-/actions/runs/200", { ...f.run, event: "workflow_dispatch" }); },
    f => { f.run.head_sha = "9".repeat(40); }]) {
    const f = pullRequestFixture(); mutate(f);
    await assert.rejects(() => api.issueGitHubVerifierReceipt({ requestBytes: f.requestBytes, pins: f.pins,
      provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport }));
    assert.equal(f.signCalls(), 0);
  }
});

test("atomic bundle retains exact authenticated archive and job log and rejects corrupted persisted raw evidence", async t => {
  const api = await adapter(), f = githubFixture(), root = mkdtempSync(join(tmpdir(), "github-verifier-raw-")), output = join(root, "accepted");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = { requestBytes: f.requestBytes, pins: f.pins, provider: api.createGitHubVerifierProvider({ transport: f.transport }), signerTransport: f.signerTransport };
  const result = await api.issueGitHubVerifierReceipt(input), originalZip = zip(f.files), originalLog = f.responses.get("/repos/haji84/AI-/actions/jobs/300/logs");
  assert.ok(result.rawEvidence?.get("github-artifact.zip")?.equals(originalZip), "return original authenticated ZIP bytes without rebuilding");
  assert.ok(result.rawEvidence.get("github-upload-job.log").equals(originalLog));
  api.persistGitHubVerifierReceipt(result, output);
  for (const [name, bytes] of result.rawEvidence) {
    assert.ok(readFileSync(join(output, name)).equals(bytes));
    assert.equal(JSON.parse(result.envelopes.get("lint")).retainedEvidenceSha256[name], hash(bytes));
    if (process.platform !== "win32") assert.equal(statSync(join(output, name)).mode & 0o777, 0o600);
  }
  assert.ok(readFileSync(join(output, "github-artifact.zip")).equals(originalZip));
  assert.ok(readFileSync(join(output, "github-upload-job.log")).equals(originalLog));
  const existing = api.readExistingGitHubVerifierReceipt(output);
  existing.rawEvidence.get("github-artifact.zip")[0] ^= 1;
  await assert.rejects(() => api.issueGitHubVerifierReceipt({ ...input, existing }), /REPLAY_MISMATCH/);
  assert.equal(f.signCalls(), 1);
  writeFileSync(join(output, "github-upload-job.log"), "corrupted retained job log");
  assert.throws(() => api.persistGitHubVerifierReceipt(result, output), /OUTPUT_MISMATCH/);
  assert.equal(f.signCalls(), 1);
});
