import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { localCandidateIdentity } from "../src/orchestrator/local-candidate-identity.ts";
import { validateResidentVerifierRequest } from "../src/orchestrator/resident-verifier-request.ts";
import { prepareTransferredVerifierRequest } from "../scripts/jarvis-verifier-request-transfer.mjs";
import { attestLocalCandidate } from "../scripts/jarvis-independent-artifact-attestation.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t, { tracked = false, bookkeeping = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "goriq-request-transfer-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"), candidate = join(root, "candidate"), verifier = join(root, "verifier");
  mkdirSync(repo); mkdirSync(join(repo, "docs")); writeFileSync(join(repo, "docs/.keep"), "base\n");
  const baseline = { "src/a.ts": "export const answer = 0;\n", "src/b.ts": "export const guard = false;\n",
    ...(bookkeeping ? { "docs/jarvis-reverse-traceability.json": JSON.stringify({ evidence: "x".repeat(150000), revision: 1 }) + "\n" } : {}) };
  if (tracked) {
    mkdirSync(join(repo, "src")); mkdirSync(join(repo, "tests")); writeFileSync(join(repo, "tests/.keep"), "base\n");
    for (const [path, content] of Object.entries(baseline)) writeFileSync(join(repo, path), content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  git("add", "."); git("commit", "-qm", "fixture"); const base = git("rev-parse", "HEAD");
  git("worktree", "add", "--detach", candidate, base); git("worktree", "add", "--detach", verifier, base);
  const contents = tracked ? { "src/a.ts": "export const answer = 42;\n", "src/b.ts": "export const guard = true;\n",
    ...(bookkeeping ? { "docs/jarvis-reverse-traceability.json": baseline["docs/jarvis-reverse-traceability.json"].replace('"revision":1', '"revision":2') } : {}),
    "tests/frozen-probe.test.mjs": "import assert from 'node:assert/strict'; assert.equal(42, 42);\n" }
    : { "docs/result.txt": "result\n", "docs/test.txt": "assertion\n" };
  const targetPath = tracked ? "src/a.ts" : "docs/result.txt", identity = localCandidateIdentity(base, targetPath, contents);
  const packet = { version: 1, executionContractDigest: "a".repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    request: { goalId: "goal", jobId: "job", changeSetId: "change", builderId: "builder", baseRevision: base,
      sourceRevision: identity.candidateRevision, artifactDigest: identity.artifactDigest, targetPath, allowedUntracked: Object.keys(contents),
      requiredChecks: ["lint", "typecheck", "unit", "integration", "security", "build"] },
    files: Object.entries(contents).map(([path, content]) => ({ path, sha256: hash(content), contentBase64: Buffer.from(content).toString("base64") })) };
  if (tracked) {
    packet.version = 2; packet.kind = "tracked-repair-verifier-request";
    packet.request.allowedUntracked = ["tests/frozen-probe.test.mjs"];
    packet.request.trackedEdits = { version: 2, files: Object.keys(baseline).map(path => ({ path,
      beforeSha256: hash(baseline[path]), afterSha256: hash(contents[path]) })) };
    bindTrackedPacket(packet);
  }
  const config = { candidateWorkspace: candidate, verifierWorkspace: verifier, privateKeyFile: join(root, "not-provisioned.pem"),
    receiptFile: join(root, "receipt.json"), verifierId: "independent" };
  const prepare = (value = packet) => { const bytes = Buffer.from(JSON.stringify(value)); return prepareTransferredVerifierRequest(bytes, { ...config, expectedRequestSha256: hash(bytes) }); };
  return { root, repo, candidate, verifier, packet, config, prepare, baseline, contents, git };
}
function bindTrackedPacket(packet) {
  const manifest = [...packet.files].sort((a, b) => a.path.localeCompare(b.path)).map(file => [file.path,
    packet.request.trackedEdits.files.find(edit => edit.path === file.path)?.beforeSha256 ?? null, file.sha256]);
  packet.request.sourceRevision = hash(`candidate\0${packet.request.baseRevision}\0${hash(`tracked-edits-v2\0${JSON.stringify(manifest)}`)}`);
}
test("portable request stages exact bytes on a distinct detached checkout and replays without overwrite", t => {
  const f = fixture(t), req = f.prepare();
  assert.equal(req.candidateWorkspace, f.candidate);
  assert.equal(req.verifierWorkspace, f.verifier);
  assert.equal(req.privateKeyFile, f.config.privateKeyFile);
  assert.equal(req.sourceRevision, f.packet.request.sourceRevision);
  assert.equal(req.expiresAt, f.packet.expiresAt, "import must preserve the execution deadline for the runner");
  assert.equal(readFileSync(join(f.candidate, "docs/result.txt"), "utf8"), "result\n");
  assert.deepEqual(f.prepare(), req);
  assert.equal(existsSync(f.config.receiptFile), false, "preparation is not verification or signing");
});
test("reject request tampering, weaker checks, stale scope and injected host authority", t => {
  const f = fixture(t), bytes = Buffer.from(JSON.stringify(f.packet));
  assert.throws(() => prepareTransferredVerifierRequest(bytes, { ...f.config, expectedRequestSha256: "f".repeat(64) }), /PIN/);
  for (const mutation of [
    p => p.files[1].contentBase64 = Buffer.from("different").toString("base64"),
    p => p.request.requiredChecks = ["unit"], p => p.expiresAt = "2000-01-01T00:00:00Z",
    p => p.request.privateKeyFile = "/tmp/injected", p => p.files[1].path = "../escape",
  ]) { const p = globalThis.structuredClone(f.packet); mutation(p); assert.throws(() => validateResidentVerifierRequest(p), /VERIFIER_REQUEST/); }
  assert.equal(existsSync(join(f.candidate, "docs/result.txt")), false);
});
test("refuse primary checkout, dirty baseline and differing existing bytes without overwriting", t => {
  const f = fixture(t), bytes = Buffer.from(JSON.stringify(f.packet));
  assert.throws(() => prepareTransferredVerifierRequest(bytes, { ...f.config, candidateWorkspace: f.repo, expectedRequestSha256: hash(bytes) }), /WORKTREE/);
  writeFileSync(join(f.candidate, "docs/.keep"), "dirty\n");
  assert.throws(f.prepare, /STATUS/);
  assert.equal(existsSync(join(f.candidate, "docs/result.txt")), false);
  writeFileSync(join(f.candidate, "docs/.keep"), "base\n");
  writeFileSync(join(f.candidate, "docs/result.txt"), "preserve\n");
  assert.throws(f.prepare, /EXISTING/);
  assert.equal(readFileSync(join(f.candidate, "docs/result.txt"), "utf8"), "preserve\n");
  assert.equal(existsSync(join(f.candidate, "docs/test.txt")), false);
});

test("tracked v2 transfer stages pinned source edits and probe, preserving base, identity and replay", t => {
  const f = fixture(t, { tracked: true }), req = f.prepare();
  const attested = attestLocalCandidate({ workspace: f.candidate, ...req });
  assert.equal(attested.candidateRevision, f.packet.request.sourceRevision);
  assert.equal(attested.artifactDigest, f.packet.request.artifactDigest);
  assert.deepEqual(req.trackedEdits, f.packet.request.trackedEdits);
  assert.equal(req.expiresAt, f.packet.expiresAt);
  for (const [path, bytes] of Object.entries(f.contents)) assert.equal(readFileSync(join(f.candidate, path), "utf8"), bytes);
  for (const [path, bytes] of Object.entries(f.baseline)) assert.equal(readFileSync(join(f.verifier, path), "utf8"), bytes);
  assert.deepEqual(f.prepare(), req);
  assert.equal(existsSync(f.config.receiptFile), false);
});

test("tracked v2 rejects malformed bindings, weakened checks and injected authority before writing", t => {
  const f = fixture(t, { tracked: true });
  const mutations = [
    p => p.kind = "other-request", p => p.extra = true, p => p.request.privateKeyFile = "/tmp/injected",
    p => p.request.signerTransport = {}, p => p.request.requiredChecks = ["unit"],
    p => p.expiresAt = "2000-01-01T00:00:00.000Z", p => p.executionContractDigest = "invalid",
    p => p.request.sourceRevision = "0".repeat(64), p => p.request.artifactDigest = "0".repeat(64),
    p => p.request.jobId = "../escape", p => p.request.trackedEdits.files[1].afterSha256 = "0".repeat(64),
    p => p.request.trackedEdits.files[1].path = "src/../outside.ts",
    p => p.request.trackedEdits.files[1].command = "write elsewhere",
    p => p.request.trackedEdits.files.push(p.request.trackedEdits.files[0]),
    p => p.request.allowedUntracked.push("src/a.ts"), p => p.files.pop(), p => p.files.push(p.files[0]),
    p => p.files[1].path = "../escape", p => p.files[1].sha256 = "0".repeat(64),
    p => p.files[1].contentBase64 += "\n", p => p.files[1].extra = true,
    p => { const file = p.files[1]; file.contentBase64 = Buffer.from([0xc0, 0x80]).toString("base64"); file.sha256 = hash(Buffer.from([0xc0, 0x80])); },
  ];
  for (const mutate of mutations) {
    const packet = globalThis.structuredClone(f.packet); mutate(packet);
    assert.throws(() => f.prepare(packet), /VERIFIER_|INDEPENDENT_/);
  }
  assert.equal(readFileSync(join(f.candidate, "src/a.ts"), "utf8"), f.baseline["src/a.ts"]);
  assert.equal(existsSync(join(f.candidate, "tests/frozen-probe.test.mjs")), false);
});

test("tracked transfer checks every original blob and existing byte before any source overwrite", t => {
  const f = fixture(t, { tracked: true }), packet = globalThis.structuredClone(f.packet);
  packet.request.trackedEdits.files[1].beforeSha256 = "0".repeat(64); bindTrackedPacket(packet);
  assert.throws(() => f.prepare(packet), /BASELINE/);
  writeFileSync(join(f.candidate, "src/b.ts"), "preserve an unrelated attempted repair\n");
  assert.throws(() => f.prepare(), /EXISTING/);
  assert.equal(readFileSync(join(f.candidate, "src/a.ts"), "utf8"), f.baseline["src/a.ts"]);
  assert.equal(readFileSync(join(f.candidate, "src/b.ts"), "utf8"), "preserve an unrelated attempted repair\n");
  assert.equal(existsSync(join(f.candidate, "tests/frozen-probe.test.mjs")), false);
});

test("tracked transfer resumes only an exact partially staged candidate", t => {
  const f = fixture(t, { tracked: true });
  writeFileSync(join(f.candidate, "src/a.ts"), f.contents["src/a.ts"]);
  assert.equal(f.prepare().sourceRevision, f.packet.request.sourceRevision);
  assert.equal(readFileSync(join(f.candidate, "src/b.ts"), "utf8"), f.contents["src/b.ts"]);
});

test("tracked transfer rejects hard-linked targets and hidden index changes before writing", t => {
  const f = fixture(t, { tracked: true }), linked = join(f.root, "linked-outside.ts");
  linkSync(join(f.candidate, "src/b.ts"), linked);
  assert.throws(() => f.prepare(), /FILE_INVALID|TARGET_UNSAFE/);
  assert.equal(readFileSync(linked, "utf8"), f.baseline["src/b.ts"]);
  assert.equal(readFileSync(join(f.candidate, "src/a.ts"), "utf8"), f.baseline["src/a.ts"]);
  rmSync(linked);
  f.git("-C", f.candidate, "update-index", "--assume-unchanged", "src/b.ts");
  assert.throws(() => f.prepare(), /INDEX_UNSAFE/);
  assert.equal(existsSync(join(f.candidate, "tests/frozen-probe.test.mjs")), false);
});

test("tracked transfer retains declared bookkeeping bytes within existing packet and file bounds", t => {
  const f = fixture(t, { tracked: true, bookkeeping: true }), req = f.prepare();
  assert.equal(readFileSync(join(f.candidate, "docs/jarvis-reverse-traceability.json"), "utf8"), f.contents["docs/jarvis-reverse-traceability.json"]);
  assert.equal(attestLocalCandidate({ workspace: f.candidate, ...req }).candidateRevision, req.sourceRevision);
  assert.deepEqual(f.prepare(), req);
  const bytes = Buffer.alloc(1024 * 1024 + 1, "x");
  assert.throws(() => prepareTransferredVerifierRequest(bytes, { ...f.config, expectedRequestSha256: hash(bytes) }), /PIN_MISMATCH/);
});
