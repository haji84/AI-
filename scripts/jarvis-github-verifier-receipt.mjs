#!/usr/bin/env node
/** Read-only GitHub evidence adapter. Never dispatches, checks out, imports or
 * executes a candidate, provisions a key, grants scope, or owns attempt state.
 * Explicit operator use requires existing GitHub auth and a separately approved
 * Mac signer. CI's disposable key/Goal remain CI identities throughout. */
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { auditCompleteLiveVerifierEvidence, boundaryProbe } from "./jarvis-verifier-live-ci.mjs";
import { createTrustedVerifierSigner, verifierCheckTimeoutMs } from "./jarvis-independent-check-runner.mjs";
import { validateTrackedTransferPacket } from "./jarvis-verifier-request-transfer.mjs";
import { canonicalLocalVerifierPayload, validateSignedLocalVerifierReceipt } from "../src/orchestrator/signed-local-verifier-receipt.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "../src/orchestrator/resident-runtime-files.ts";

const CHECKS = ["lint", "typecheck", "unit", "integration", "security", "build"];
const REPOSITORY = "haji84/AI-", WORKFLOW = ".github/workflows/ci.yml", API = `/repos/${REPOSITORY}`;
const PROTECTED = [WORKFLOW, "scripts/jarvis-verifier-live-ci.mjs", "scripts/jarvis-independent-check-runner.mjs",
  "scripts/jarvis-independent-artifact-attestation.mjs", "scripts/jarvis-verifier-safe-git.mjs", "scripts/jarvis-verifier-container.mjs",
  "scripts/jarvis-verifier-offline-workspace.mjs", "scripts/jarvis-verifier-resource-observer.mjs", "src/orchestrator/local-candidate-identity.ts",
  "src/orchestrator/development-verification-plan.ts", "src/orchestrator/signed-local-verifier-receipt.ts", "tests/fixtures/verifier-image/Dockerfile",
  "scripts/jarvis-github-verifier-receipt.mjs", "scripts/jarvis-verifier-request-transfer.mjs", "src/orchestrator/resident-verifier-request.ts",
  "src/orchestrator/resident-runtime-files.ts", "package.json", "pnpm-lock.yaml"];
const GENERATED = ["docs/verifier-live-result.txt", "tests/verifier-ci-boundary-probe.test.mjs"];
const RAW_FILES = ["environment.json", "image.json", "runner-result.json", "public-key.pem", "receipt.json", "result.json", ...CHECKS.map(check => `checks/${check}.json`)];
const ZIP_LIMIT = 64 * 1024 * 1024, LOG_LIMIT = 16 * 1024 * 1024;
const RETAINED = new Map([["github-artifact.zip", ZIP_LIMIT], ["github-upload-job.log", 8 * 1024 * 1024], ["github-provenance.json", 16384]]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const revision = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const data = (bytes, maximum = 1024 * 1024) => {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, "GITHUB_VERIFIER_DATA_BOUND");
  const text = bytes.toString("utf8"); assert.ok(Buffer.from(text).equals(bytes) && !text.includes("\0"), "GITHUB_VERIFIER_UTF8_INVALID");
  return JSON.parse(text);
};
const providers = new WeakMap();

function ghTransport(path, { maxBytes }) {
  const pinnedTool = "/opt/homebrew/bin/gh";
  if (!existsSync(pinnedTool) || !statSync(pinnedTool).isFile()) throw Error("GITHUB_VERIFIER_EXISTING_AUTH_TOOL_UNAVAILABLE");
  const executable = realpathSync(pinnedTool);
  assert.ok(executable.startsWith("/opt/homebrew/") && basename(executable) === "gh", "GITHUB_VERIFIER_AUTH_TOOL_UNTRUSTED");
  try {
    // Existing host authentication only. No login, token output, shell, pager,
    // candidate cwd, caller URL, write API, or credential-bearing arguments.
    return execFileSync(executable, ["api", "--hostname", "github.com", "--method", "GET", path], {
      cwd: homedir(), windowsHide: true, timeout: 30000, maxBuffer: maxBytes,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_DEBUG: "", GH_PAGER: "cat", PAGER: "cat" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw Error("GITHUB_VERIFIER_AUTHENTICATED_READ_FAILED"); }
}

/** Injection is code-only, like the existing trusted signer transport. A
 * serialized status/result object cannot stand in for this provider. */
export function createGitHubVerifierProvider({ transport = ghTransport } = {}) {
  if (typeof transport !== "function") throw Error("GITHUB_VERIFIER_PROVIDER_INVALID");
  const provider = Object.freeze({ kind: "authenticated-github-verifier-evidence" });
  providers.set(provider, async (path, maxBytes = 4 * 1024 * 1024) => {
    assert.ok(path.startsWith(API + "/") && !/[\r\n#]/.test(path), "GITHUB_VERIFIER_API_PATH_INVALID");
    const bytes = await transport(path, { maxBytes });
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxBytes, "GITHUB_VERIFIER_DATA_BOUND");
    return Buffer.from(bytes);
  });
  return provider;
}

/** Bounded in-memory ZIP decode only. All names/types/ranges are checked
 * before decompression; nothing is extracted or executed on the host. */
export function readGitHubVerifierArchive(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= ZIP_LIMIT, "GITHUB_VERIFIER_ARCHIVE_BOUND");
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  assert.ok(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, "GITHUB_VERIFIER_ARCHIVE_INVALID");
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16);
  assert.ok(count > 0 && count <= 24 && count === bytes.readUInt16LE(end + 8)
    && start + bytes.readUInt32LE(end + 12) === end, "GITHUB_VERIFIER_ARCHIVE_INVALID");
  let cursor = start, total = 0; const entries = [], seen = new Set();
  for (let index = 0; index < count; index++) {
    assert.ok(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, "GITHUB_VERIFIER_ARCHIVE_INVALID");
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), length = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    assert.ok(next <= end, "GITHUB_VERIFIER_ARCHIVE_INVALID");
    const encoded = bytes.subarray(cursor + 46, cursor + 46 + length), name = encoded.toString("utf8"), mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    assert.ok(Buffer.from(name).equals(encoded) && !seen.has(name) && (RAW_FILES.includes(name) || name === "setup-error.log" || name === "checks/")
      && (mode & 0xf000) !== 0xa000 && !(flags & ~0x080e) && [0, 8].includes(method), "GITHUB_VERIFIER_ARCHIVE_PATH_INVALID");
    seen.add(name);
    const maximum = name.startsWith("checks/") ? LOG_LIMIT : name === "receipt.json" ? 24576 : name === "public-key.pem" ? 8192 : 1024 * 1024;
    assert.ok(size <= maximum && (name !== "checks/" || size === 0), "GITHUB_VERIFIER_ARCHIVE_BOUND");
    total += size; assert.ok(total <= 104 * 1024 * 1024, "GITHUB_VERIFIER_ARCHIVE_BOUND");
    const local = bytes.readUInt32LE(cursor + 42);
    assert.ok(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50
      && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method, "GITHUB_VERIFIER_ARCHIVE_INVALID");
    const localLength = bytes.readUInt16LE(local + 26), from = local + 30 + localLength + bytes.readUInt16LE(local + 28), to = from + compressed;
    assert.ok(localLength === length && bytes.subarray(local + 30, local + 30 + localLength).equals(encoded) && from <= to && to <= start
      && ((flags & 8) || bytes.readUInt32LE(local + 14) === crc && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === size), "GITHUB_VERIFIER_ARCHIVE_INVALID");
    entries.push({ name, local, from, to, method, crc, size, maximum }); cursor = next;
  }
  assert.equal(cursor, end, "GITHUB_VERIFIER_ARCHIVE_INVALID");
  const ranges = [...entries].sort((a, b) => a.local - b.local);
  assert.ok(ranges.every((entry, index) => !index || entry.local >= ranges[index - 1].to), "GITHUB_VERIFIER_ARCHIVE_INVALID");
  const files = new Map();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.from, entry.to), expanded = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.maximum + 1 });
    assert.ok(expanded.length === entry.size && crc32(expanded) === entry.crc, "GITHUB_VERIFIER_ARCHIVE_CRC_INVALID");
    if (entry.name !== "checks/") files.set(entry.name, Buffer.from(expanded));
  }
  assert.ok(RAW_FILES.every(name => files.has(name)), "GITHUB_VERIFIER_ARCHIVE_INCOMPLETE");
  return files;
}

function validatePins(requestBytes, pins, now) {
  assert.ok(pins && Object.keys(pins).sort().join(",") === "artifactId,candidateCommit,executionContractDigest,expiresAt,jobId,notBefore,publicKeyPem,repository,request,requestSha256,runAttempt,runId,verifierId,version,workflowId"
    && pins.version === 1 && pins.repository === REPOSITORY && digest(pins.requestSha256) && digest(pins.executionContractDigest)
    && revision(pins.candidateCommit) && iso(pins.notBefore) && iso(pins.expiresAt) && Date.parse(pins.notBefore) <= now.getTime()
    && Date.parse(pins.expiresAt) > now.getTime() && Date.parse(pins.expiresAt) > Date.parse(pins.notBefore)
    && [pins.workflowId, pins.runId, pins.runAttempt, pins.jobId, pins.artifactId].every(value => Number.isSafeInteger(value) && value > 0)
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(pins.verifierId ?? ""), "GITHUB_VERIFIER_HOST_PINS_INVALID");
  assert.ok(Buffer.isBuffer(requestBytes) && requestBytes.length <= 1024 * 1024 && hash(requestBytes) === pins.requestSha256, "GITHUB_VERIFIER_REQUEST_PIN_MISMATCH");
  const packet = data(requestBytes); const edits = validateTrackedTransferPacket(packet);
  assert.ok(packet.executionContractDigest === pins.executionContractDigest && stable(packet.request) === stable(pins.request)
    && packet.request.builderId !== pins.verifierId && JSON.stringify(packet.request.requiredChecks) === JSON.stringify(CHECKS), "GITHUB_VERIFIER_SCOPE_MISMATCH");
  assert.ok([...packet.files.map(file => file.path)].every(path => !PROTECTED.includes(path) && !GENERATED.includes(path)), "GITHUB_VERIFIER_TOOL_EDIT_REJECTED");
  const plan = createDevelopmentVerificationPlan({ builderId: packet.request.builderId, sourceRevision: packet.request.sourceRevision,
    artifactDigest: packet.request.artifactDigest, changedPaths: packet.files.map(file => file.path) });
  assert.deepEqual(plan.requiredChecks, CHECKS, "GITHUB_VERIFIER_UNSUPPORTED_CHECKS");
  return { packet, edits, plan };
}

function treeEntries(value, expectedSha) {
  assert.ok(value?.sha === expectedSha && value.truncated === false && Array.isArray(value.tree) && value.tree.length <= 15000, "GITHUB_VERIFIER_TREE_INCOMPLETE");
  const files = new Map();
  for (const entry of value.tree) {
    assert.ok(typeof entry.path === "string" && !/[\\\0\r\n]/.test(entry.path) && !entry.path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
      && revision(entry.sha), "GITHUB_VERIFIER_TREE_INVALID");
    if (entry.type === "tree") continue;
    assert.ok(entry.type === "blob" && ["100644", "100755", "120000"].includes(entry.mode) && !files.has(entry.path), "GITHUB_VERIFIER_TREE_INVALID");
    files.set(entry.path, entry);
  }
  return files;
}

function auditUploadLog(bytes, pins, artifact) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, "GITHUB_VERIFIER_UPLOAD_LOG_BOUND");
  const text = bytes.toString("utf8"); assert.ok(Buffer.from(text).equals(bytes) && !text.includes("\0"), "GITHUB_VERIFIER_UPLOAD_LOG_INVALID");
  const lines = text.split(/\r?\n/).map(line => line.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z /, ""));
  const groups = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] !== "##[group]Run actions/upload-artifact@v4") continue;
    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith("##[group]")) end++;
    groups.push(lines.slice(index, end).map(line => line.trim())); index = end - 1;
  }
  const matching = groups.filter(group => group.includes(`name: ${artifact.name}`));
  assert.equal(matching.length, 1, "GITHUB_VERIFIER_UPLOAD_GROUP_INVALID");
  const group = matching[0], expected = [
    [`SHA256 digest of uploaded artifact zip is ${artifact.digest.slice(7)}`, /^SHA256 digest of uploaded artifact zip is /],
    [`Artifact ${artifact.name}.zip successfully finalized. Artifact ID ${pins.artifactId}`, /^Artifact .*\.zip successfully finalized\. Artifact ID /],
    [`Artifact ${artifact.name} has been successfully uploaded! Final size is ${artifact.size_in_bytes} bytes. Artifact ID is ${pins.artifactId}`, /^Artifact .* has been successfully uploaded! Final size is /],
    [`Artifact download URL: https://github.com/${REPOSITORY}/actions/runs/${pins.runId}/artifacts/${pins.artifactId}`, /^Artifact download URL: /],
  ];
  for (const [line, pattern] of expected) assert.ok(group.filter(item => pattern.test(item)).length === 1 && group.includes(line), "GITHUB_VERIFIER_UPLOAD_BINDING_INVALID");
}

/** The caller supplies host pins and code-owned transports, never a caller's
 * CI verdict. All remote reads and audits finish before the signer is called.
 * The canonical caller must check current stop/approval state and consumed
 * attempt budget before activation; these static pins do not resume/reset it. */
export async function issueGitHubVerifierReceipt({ requestBytes, pins, provider, signerTransport, existing }) {
  const api = providers.get(provider);
  assert.ok(api, "GITHUB_VERIFIER_PROVIDER_REQUIRED");
  const { packet, edits, plan } = validatePins(requestBytes, pins, new Date());
  assert.equal(signerTransport?.publicKeyPem, pins.publicKeyPem, "GITHUB_VERIFIER_SIGNER_PIN_MISMATCH");
  const signPayload = createTrustedVerifierSigner(signerTransport);
  const json = async path => data(await api(API + path), 4 * 1024 * 1024);
  const [base, commit, workflow, latestRun, run, jobs, artifact, artifacts] = await Promise.all([
    json(`/git/commits/${packet.request.baseRevision}`), json(`/git/commits/${pins.candidateCommit}`), json(`/actions/workflows/${pins.workflowId}`),
    json(`/actions/runs/${pins.runId}`), json(`/actions/runs/${pins.runId}/attempts/${pins.runAttempt}`),
    json(`/actions/runs/${pins.runId}/attempts/${pins.runAttempt}/jobs?per_page=100`), json(`/actions/artifacts/${pins.artifactId}`),
    json(`/actions/runs/${pins.runId}/artifacts?per_page=100`),
  ]);
  assert.ok(base.sha === packet.request.baseRevision && revision(base.tree?.sha) && commit.sha === pins.candidateCommit
    && revision(commit.tree?.sha) && commit.parents?.length === 1 && commit.parents[0].sha === base.sha, "GITHUB_VERIFIER_COMMIT_MISMATCH");
  assert.ok(workflow.id === pins.workflowId && workflow.path === WORKFLOW && workflow.state === "active", "GITHUB_VERIFIER_WORKFLOW_MISMATCH");
  for (const record of [run, latestRun]) assert.ok(record.id === pins.runId && record.run_attempt === pins.runAttempt
    && record.workflow_id === pins.workflowId && record.path === WORKFLOW && ["workflow_dispatch", "pull_request"].includes(record.event)
    && record.event === run.event && record.head_sha === pins.candidateCommit
    && record.status === "completed" && ["success", "failure"].includes(record.conclusion)
    && record.repository?.full_name === REPOSITORY && record.head_repository?.full_name === REPOSITORY, "GITHUB_VERIFIER_RUN_MISMATCH");
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length && jobs.jobs.length <= 100, "GITHUB_VERIFIER_JOB_INCOMPLETE");
  const matching = jobs.jobs.filter(job => job.name === "independent-verifier-container"), job = matching[0];
  assert.ok(matching.length === 1 && job.id === pins.jobId && job.run_id === pins.runId && job.run_attempt === pins.runAttempt && job.head_sha === pins.candidateCommit
    && job.status === "completed" && ["success", "failure"].includes(job.conclusion) && job.runner_group_name === "GitHub Actions" && job.runner_group_id === 0
    && stable(job.labels) === stable(["ubuntu-24.04"]), "GITHUB_VERIFIER_JOB_MISMATCH");
  const started = Date.parse(job.started_at), completed = Date.parse(job.completed_at), created = Date.parse(artifact.created_at), now = Date.now();
  assert.ok([started, completed, created, Date.parse(run.created_at), Date.parse(artifact.expires_at)].every(Number.isFinite)
    && started >= Date.parse(pins.notBefore) && Date.parse(run.created_at) >= Date.parse(pins.notBefore)
    && started <= completed && completed <= now + 60000 && created >= started && created <= completed + 60000
    && Date.parse(artifact.expires_at) > now, "GITHUB_VERIFIER_TIME_MISMATCH");
  const artifactCommit = /^independent-verifier-container-([a-f0-9]{40})$/.exec(artifact.name ?? "")?.[1];
  assert.ok(Array.isArray(artifacts.artifacts) && artifacts.total_count === artifacts.artifacts.length && artifacts.artifacts.length <= 100
    && artifacts.artifacts.filter(item => item.id === pins.artifactId).length === 1
    && stable(artifacts.artifacts.find(item => item.id === pins.artifactId)) === stable(artifact)
    && artifact.id === pins.artifactId && artifactCommit && (run.event === "pull_request" || artifactCommit === pins.candidateCommit) && artifact.expired === false
    && artifact.workflow_run?.id === pins.runId && artifact.workflow_run.head_sha === pins.candidateCommit
    && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") && Number.isSafeInteger(artifact.size_in_bytes)
    && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= ZIP_LIMIT, "GITHUB_VERIFIER_ARTIFACT_MISMATCH");
  let pullRequestMerge;
  if (run.event === "pull_request") {
    const merge = await json(`/git/commits/${artifactCommit}`);
    assert.ok(merge.sha === artifactCommit && merge.parents?.length === 2 && merge.parents[0].sha === packet.request.baseRevision
      && merge.parents[1].sha === pins.candidateCommit && merge.tree?.sha === commit.tree.sha, "GITHUB_VERIFIER_PR_MERGE_MISMATCH");
    pullRequestMerge = { commit: merge.sha, parents: merge.parents.map(parent => parent.sha), tree: merge.tree.sha };
  }
  const jobLog = await api(`${API}/actions/jobs/${pins.jobId}/logs`, 8 * 1024 * 1024);
  auditUploadLog(jobLog, pins, artifact);
  const [baseTree, publishedTree] = await Promise.all([json(`/git/trees/${base.tree.sha}?recursive=1`), json(`/git/trees/${commit.tree.sha}?recursive=1`)]);
  const original = treeEntries(baseTree, base.tree.sha), published = treeEntries(publishedTree, commit.tree.sha), requested = new Map(packet.files.map(file => [file.path, file]));
  const changed = [...new Set([...original.keys(), ...published.keys()])].filter(path => {
    const a = original.get(path), b = published.get(path); return a?.sha !== b?.sha || a?.mode !== b?.mode;
  }).sort();
  assert.deepEqual(changed, [...requested.keys()].sort(), "GITHUB_VERIFIER_TREE_SCOPE_MISMATCH");
  const blobs = new Map(), blob = async entry => {
    assert.ok(entry?.type === "blob" && ["100644", "100755"].includes(entry.mode), "GITHUB_VERIFIER_BLOB_UNSAFE");
    if (!blobs.has(entry.sha)) blobs.set(entry.sha, (async () => {
      const value = await json(`/git/blobs/${entry.sha}`);
      assert.ok(value.sha === entry.sha && value.encoding === "base64" && typeof value.content === "string"
        && value.content.length <= 1500000 && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 1048576, "GITHUB_VERIFIER_BLOB_BOUND");
      const encoded = value.content.replace(/\n/g, ""), bytes = Buffer.from(encoded, "base64");
      assert.ok(bytes.length === value.size && bytes.toString("base64") === encoded
        && createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === entry.sha, "GITHUB_VERIFIER_BLOB_MISMATCH");
      return bytes;
    })());
    return blobs.get(entry.sha);
  };
  for (const [path, file] of requested) {
    const before = original.get(path), after = published.get(path), edit = edits.find(item => item.path === path);
    assert.ok(after?.mode === (edit ? before?.mode : "100644") && (edit ? !!before : !before)
      && (!edit || hash(await blob(before)) === edit.beforeSha256)
      && hash(await blob(after)) === file.sha256 && (await blob(after)).equals(Buffer.from(file.contentBase64, "base64")), "GITHUB_VERIFIER_PUBLISHED_BYTES_MISMATCH");
  }
  const protectedHashes = {};
  for (const path of PROTECTED) {
    assert.ok(original.get(path)?.sha === published.get(path)?.sha && original.get(path)?.mode === published.get(path)?.mode, "GITHUB_VERIFIER_TOOL_MISMATCH");
    protectedHashes[path] = hash(await blob(original.get(path)));
  }
  const archive = await api(`${API}/actions/artifacts/${pins.artifactId}/zip`, ZIP_LIMIT);
  assert.equal(archive.length, artifact.size_in_bytes, "GITHUB_VERIFIER_ARCHIVE_SIZE_MISMATCH");
  assert.equal(`sha256:${hash(archive)}`, artifact.digest, "GITHUB_VERIFIER_ARCHIVE_DIGEST_MISMATCH");
  const files = readGitHubVerifierArchive(archive), receipt = data(files.get("receipt.json"), 24576), ci = receipt.payload;
  const image = data(files.get("image.json")), environment = data(files.get("environment.json")), runner = data(files.get("runner-result.json")), result = data(files.get("result.json"));
  const id = /^ci-goal-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(ci?.goalId ?? "")?.[1];
  assert.ok(id && ci.jobId === `ci-job-${id}` && ci.changeSetId === `ci-change-${id}` && ci.builderId === "ci-untrusted-container"
    && ci.verifierId === "ci-host-signer" && ci.baseRevision === pins.candidateCommit
    && typeof runner.receiptPath === "string" && /^\/[A-Za-z0-9_./-]+\/goriq-verifier-live-[A-Za-z0-9]{6}\/receipt\.json$/.test(runner.receiptPath)
    && !runner.receiptPath.split("/").includes(".."), "GITHUB_VERIFIER_CI_IDENTITY_INVALID");
  const marker = `GORIQ_REAL_BOUNDARY_PROBE_PASS:${id}`, fileHashes = {
    [GENERATED[0]]: hash("Full repository real-container CI candidate\n"),
    [GENERATED[1]]: hash(boundaryProbe(posix.join(posix.dirname(runner.receiptPath), "ephemeral-ci-signer.pem"), marker)),
  };
  const ciSourceRevision = hash(`candidate\0${pins.candidateCommit}\0${hash(`create-set-v1\0${JSON.stringify(Object.entries(fileHashes))}`)}`);
  assert.ok(ci.sourceRevision === ciSourceRevision && ci.artifactDigest === fileHashes[GENERATED[0]]
    && runner.sourceRevision === ciSourceRevision && runner.artifactDigest === ci.artifactDigest
    && typeof image.image === "string" && /^127\.0\.0\.1:[0-9]+\/verifier@sha256:[a-f0-9]{64}$/.test(image.image)
    && image.buildProfile === "next-webpack-v1" && stable(image.buildContextHashes) === stable({
      "package.json": protectedHashes["package.json"], "pnpm-lock.yaml": protectedHashes["pnpm-lock.yaml"],
      Dockerfile: protectedHashes["tests/fixtures/verifier-image/Dockerfile"], "jarvis-verifier-offline-workspace.mjs": protectedHashes["scripts/jarvis-verifier-offline-workspace.mjs"],
    }), "GITHUB_VERIFIER_CI_MAPPING_INVALID");
  assert.ok(environment.evidenceClass === "HOSTED_CONTAINER_CI" && environment.physicalAcceptanceVerified === false
    && environment.baseRevision === pins.candidateCommit && environment.githubRunId === String(pins.runId) && environment.node === "v24.19.0"
    && stable(environment.limits) === stable({ timeoutMs: 180000, timeoutMsByCheck: Object.fromEntries(CHECKS.map(check => [check, verifierCheckTimeoutMs(check)])),
      memoryBytes: 2147483648, pids: 128, tmpfsMiB: 1536, network: "none", uid: 65534 }), "GITHUB_VERIFIER_ENVIRONMENT_INVALID");
  const ciRequest = { ...ci, allowedUntracked: GENERATED }, publicKeyPem = files.get("public-key.pem").toString("utf8");
  assert.ok(hash(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })) !== hash(createPublicKey(pins.publicKeyPem).export({ type: "spki", format: "der" }))
    && ["goalId", "jobId", "changeSetId", "builderId"].every(field => packet.request[field] !== ci[field])
    && pins.verifierId !== ci.verifierId, "GITHUB_VERIFIER_PRINCIPAL_REUSE");
  const audited = auditCompleteLiveVerifierEvidence({ request: ciRequest, publicKeyPem, expectedImage: image.image, expectedFileHashes: fileHashes,
    boundaryMarker: marker, receiptBytes: files.get("receipt.json"), logs: new Map(CHECKS.map(check => [check, files.get(`checks/${check}.json`)])) });
  const conclusion = audited.passed ? "success" : "failure";
  assert.ok(result.status === (audited.passed ? "PASSED" : "FAILED") && result.baseRevision === pins.candidateCommit && result.image === image.image
    && result.physicalAcceptanceVerified === false && result.fixtureCleanupConfirmed === true && !result.cleanupErrors
    && (audited.passed ? result.receiptSha256 === hash(files.get("receipt.json")) : result.error === "LIVE_CHECK_NOT_PASSED")
    && job.conclusion === conclusion && runner.verified === audited.passed
    && stable(runner.checks) === stable(ci.checks.map(({ check, status, outputDigest }) => ({ check, status, outputDigest }))), "GITHUB_VERIFIER_CI_OUTCOME_INVALID");
  const step = name => job.steps?.filter(item => item.name === name);
  for (const [name, expected] of [["Real restricted-container six-check verification", conclusion], ["Retain hosted-container evidence", "success"],
    ["Run actions/checkout@v4", "success"], ["Run actions/setup-node@v4", "success"]]) {
    const found = step(name); assert.ok(found?.length === 1 && found[0].status === "completed" && found[0].conclusion === expected, "GITHUB_VERIFIER_STEP_INVALID");
  }
  assert.ok(Date.parse(ci.issuedAt) >= started - 1000 && ci.checks.every(check => Date.parse(check.recordedAt) >= started && Date.parse(check.recordedAt) <= completed + 60000)
    && Date.parse(ci.expiresAt) - Math.max(...ci.checks.map(check => Date.parse(check.recordedAt))) <= 21 * 60000, "GITHUB_VERIFIER_CI_TIME_INVALID");
  // Re-read mutable run/artifact metadata before signing; exact IDs/digests and
  // run attempt must still match the authenticated observations above.
  assert.equal(stable(await json(`/actions/runs/${pins.runId}`)), stable(latestRun), "GITHUB_VERIFIER_RUN_CHANGED");
  assert.equal(stable(await json(`/actions/artifacts/${pins.artifactId}`)), stable(artifact), "GITHUB_VERIFIER_ARTIFACT_CHANGED");
  validatePins(requestBytes, pins, new Date());
  const expiry = new Date(Math.min(Date.parse(packet.expiresAt), Date.parse(pins.expiresAt), Date.parse(ci.expiresAt), Date.parse(artifact.expires_at))).toISOString();
  const prior = existing ? data(existing.receiptBytes, 24576) : null;
  if (prior) validateSignedLocalVerifierReceipt({ receipt: prior, publicKeyPem: pins.publicKeyPem, plan, goalId: packet.request.goalId,
    changeSet: packet.request });
  const issuedAt = prior?.payload.issuedAt ?? new Date().toISOString();
  assert.ok(Date.parse(issuedAt) >= completed && Date.parse(issuedAt) <= Date.now() && Date.parse(expiry) > Date.now(), "GITHUB_VERIFIER_RECEIPT_TIME_INVALID");
  const rawHashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)]));
  const github = { repository: REPOSITORY, workflowId: pins.workflowId, workflowPath: WORKFLOW, runId: pins.runId, runAttempt: pins.runAttempt,
    jobId: pins.jobId, artifactId: pins.artifactId, artifactName: artifact.name, artifactZipSha256: hash(archive), commit: pins.candidateCommit,
    tree: commit.tree.sha, jobStartedAt: job.started_at, jobCompletedAt: job.completed_at, artifactCreatedAt: artifact.created_at, jobLogSha256: hash(jobLog),
    ...(pullRequestMerge ? { pullRequestMerge } : {}) };
  const rawEvidence = new Map([["github-artifact.zip", archive], ["github-upload-job.log", jobLog],
    ["github-provenance.json", Buffer.from(JSON.stringify({ version: 1, event: run.event, github }) + "\n")]]);
  const retainedEvidenceSha256 = Object.fromEntries([...rawEvidence].map(([name, bytes]) => [name, hash(bytes)]));
  const envelopes = new Map(audited.checks.map(check => [check.check, Buffer.from(JSON.stringify({ version: 1,
    kind: "github-restricted-check-provenance", check: check.check, status: check.status, auditedAt: issuedAt,
    requestSha256: pins.requestSha256, executionContractDigest: packet.executionContractDigest, requestBinding: packet.request, github,
    ci: { goalId: ci.goalId, jobId: ci.jobId, changeSetId: ci.changeSetId, baseRevision: ci.baseRevision, sourceRevision: ci.sourceRevision,
      artifactDigest: ci.artifactDigest, receiptSha256: hash(files.get("receipt.json")), publicKeySha256: hash(files.get("public-key.pem")), fileHashes },
    reviewedBase: { revision: base.sha, protectedFileSha256: protectedHashes }, rawEvidenceSha256: rawHashes, retainedEvidenceSha256,
    rawOutputSha256: check.outputDigest, rawRecordedAt: check.recordedAt, physicalAcceptanceVerified: false }) + "\n")]));
  const payload = { version: 1, verifierId: pins.verifierId, goalId: packet.request.goalId, jobId: packet.request.jobId,
    changeSetId: packet.request.changeSetId, builderId: packet.request.builderId, baseRevision: packet.request.baseRevision,
    sourceRevision: packet.request.sourceRevision, artifactDigest: packet.request.artifactDigest, issuedAt, expiresAt: expiry,
    checks: audited.checks.map(check => ({ check: check.check, status: check.status, outputDigest: hash(envelopes.get(check.check)), recordedAt: issuedAt })) };
  if (prior) {
    assert.equal(canonicalLocalVerifierPayload(prior.payload), canonicalLocalVerifierPayload(payload), "GITHUB_VERIFIER_REPLAY_MISMATCH");
    for (const check of CHECKS) assert.ok(existing.envelopes?.get(check)?.equals(envelopes.get(check)), "GITHUB_VERIFIER_REPLAY_MISMATCH");
    for (const [name, bytes] of rawEvidence) assert.ok(existing.rawEvidence?.get(name)?.equals(bytes), "GITHUB_VERIFIER_REPLAY_MISMATCH");
    return { receipt: prior, envelopes, rawEvidence, reused: true, physicalAcceptanceVerified: false };
  }
  const signatureBase64 = await signPayload(Buffer.from(canonicalLocalVerifierPayload(payload)));
  validatePins(requestBytes, pins, new Date());
  const actualReceipt = { payload, signatureBase64 };
  validateSignedLocalVerifierReceipt({ receipt: actualReceipt, publicKeyPem: pins.publicKeyPem, plan, goalId: packet.request.goalId, changeSet: packet.request });
  return { receipt: actualReceipt, envelopes, rawEvidence, reused: false, physicalAcceptanceVerified: false };
}

export function readExistingGitHubVerifierReceipt(outputDirectory, workspaces = []) {
  const output = assertExternalRuntimePath(outputDirectory, workspaces);
  if (!existsSync(output)) return undefined;
  assert.ok(lstatSync(output).isDirectory(), "GITHUB_VERIFIER_OUTPUT_UNSAFE");
  return { receiptBytes: readBoundedRuntimeFile(join(output, "receipt.json"), 24576, workspaces),
    envelopes: new Map(CHECKS.map(check => [check, readBoundedRuntimeFile(join(output, "receipt.json.logs", check + ".json"), 32768, workspaces)])),
    rawEvidence: new Map([...RETAINED].map(([name, maximum]) => [name, readBoundedRuntimeFile(join(output, name), maximum, workspaces)])) };
}

/** One atomic directory publication; no half-written receipt or overwrites.
 * Replays must independently re-audit GitHub provenance and signature first. */
export function persistGitHubVerifierReceipt(result, outputDirectory, workspaces = []) {
  const output = assertExternalRuntimePath(outputDirectory, workspaces), bytes = Buffer.from(JSON.stringify(result.receipt) + "\n");
  const retainedHashes = data(result.envelopes.get("lint"), 32768).retainedEvidenceSha256;
  for (const [name, maximum] of RETAINED) {
    const raw = result.rawEvidence?.get(name);
    assert.ok(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum && hash(raw) === retainedHashes?.[name], "GITHUB_VERIFIER_OUTPUT_MISMATCH");
  }
  const existing = readExistingGitHubVerifierReceipt(output, workspaces);
  if (existing) {
    assert.ok(existing.receiptBytes.equals(bytes) && CHECKS.every(check => existing.envelopes.get(check).equals(result.envelopes.get(check)))
      && [...RETAINED.keys()].every(name => existing.rawEvidence.get(name).equals(result.rawEvidence.get(name))), "GITHUB_VERIFIER_OUTPUT_MISMATCH");
    return;
  }
  assert.ok(lstatSync(dirname(output)).isDirectory(), "GITHUB_VERIFIER_OUTPUT_PARENT_REQUIRED");
  const staging = assertExternalRuntimePath(join(dirname(output), `${basename(output)}.pending-${randomUUID()}`), workspaces);
  mkdirSync(staging, { mode: 0o700 }); mkdirSync(join(staging, "receipt.json.logs"), { mode: 0o700 });
  for (const name of RETAINED.keys()) writeFileSync(join(staging, name), result.rawEvidence.get(name), { flag: "wx", mode: 0o600 });
  for (const check of CHECKS) writeFileSync(join(staging, "receipt.json.logs", check + ".json"), result.envelopes.get(check), { flag: "wx", mode: 0o600 });
  writeFileSync(join(staging, "receipt.json"), bytes, { flag: "wx", mode: 0o600 });
  renameSync(staging, output);
}

async function operatorCLI() {
  if (process.argv.length !== 4 || process.argv[2] !== "--execute-operator" || !isAbsolute(process.argv[3])) throw Error("GITHUB_VERIFIER_EXPLICIT_OPERATOR_REQUIRED");
  if (process.platform !== "darwin" || process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED !== "1") throw Error("GITHUB_VERIFIER_MAC_OPERATOR_REQUIRED");
  // The acknowledgement and filesystem checks do not provision a principal or
  // grant signing authority. The owner must approve/provision it separately.
  const configFile = assertExternalRuntimePath(process.argv[3], [process.cwd()]);
  const config = data(readBoundedRuntimeFile(configFile, 65536));
  assert.ok(Object.keys(config).sort().join(",") === "outputDirectory,pins,privateKeyFile,requestFile,workspaces"
    && Array.isArray(config.workspaces) && config.workspaces.length <= 8 && config.workspaces.every(isAbsolute), "GITHUB_VERIFIER_OPERATOR_CONFIG_INVALID");
  const workspaces = [process.cwd(), ...config.workspaces];
  for (const file of [configFile, config.requestFile, config.privateKeyFile, config.outputDirectory]) assertExternalRuntimePath(file, workspaces);
  for (const directory of [dirname(configFile), dirname(config.outputDirectory)]) {
    const info = lstatSync(directory); assert.ok(info.isDirectory() && info.uid === process.getuid() && !(info.mode & 0o022), "GITHUB_VERIFIER_OPERATOR_DIRECTORY_UNSAFE");
  }
  const info = lstatSync(configFile); assert.ok(info.uid === process.getuid() && !(info.mode & 0o022), "GITHUB_VERIFIER_OPERATOR_CONFIG_UNSAFE");
  const requestBytes = readBoundedRuntimeFile(config.requestFile, 1024 * 1024, workspaces);
  const result = await issueGitHubVerifierReceipt({ requestBytes, pins: config.pins, provider: createGitHubVerifierProvider(),
    existing: readExistingGitHubVerifierReceipt(config.outputDirectory, workspaces), signerTransport: {
      publicKeyPem: config.pins.publicKeyPem,
      sign: bytes => {
        const info = lstatSync(config.privateKeyFile);
        assert.ok(info.uid === process.getuid() && !(info.mode & 0o077), "GITHUB_VERIFIER_PRIVATE_KEY_UNSAFE");
        const keyBytes = readBoundedRuntimeFile(config.privateKeyFile, 8192, workspaces);
        try {
          const key = createPrivateKey(keyBytes);
          assert.ok(key.asymmetricKeyType === "ed25519" && createPublicKey(key).export({ type: "spki", format: "pem" }).toString() === config.pins.publicKeyPem, "GITHUB_VERIFIER_SIGNER_PIN_MISMATCH");
          return sign(null, bytes, key).toString("base64");
        } finally { keyBytes.fill(0); }
      },
    } });
  persistGitHubVerifierReceipt(result, config.outputDirectory, workspaces);
  process.stdout.write(JSON.stringify({ receiptFile: join(config.outputDirectory, "receipt.json"),
    receiptSha256: hash(Buffer.from(JSON.stringify(result.receipt) + "\n")), reused: result.reused,
    checks: result.receipt.payload.checks.map(({ check, status }) => ({ check, status })), physicalAcceptanceVerified: false }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await operatorCLI(); }
  catch (error) {
    const code = /^(?:GITHUB_VERIFIER_|LIVE_|SIGNED_VERIFIER_|VERIFIER_)[A-Z0-9_]+/.exec(String(error.message))?.[0] ?? "GITHUB_VERIFIER_REFUSED";
    process.stderr.write(code + "\n"); process.exitCode = 1;
  }
}
