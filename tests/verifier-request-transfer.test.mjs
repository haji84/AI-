import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { localCandidateIdentity } from "../src/orchestrator/local-candidate-identity.ts";
import { validateResidentVerifierRequest } from "../src/orchestrator/resident-verifier-request.ts";
import { prepareTransferredVerifierRequest } from "../scripts/jarvis-verifier-request-transfer.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "goriq-request-transfer-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, "repo"), candidate = join(root, "candidate"), verifier = join(root, "verifier");
  mkdirSync(repo); mkdirSync(join(repo, "docs")); writeFileSync(join(repo, "docs/.keep"), "base\n");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  git("add", "."); git("commit", "-qm", "fixture"); const base = git("rev-parse", "HEAD");
  git("worktree", "add", "--detach", candidate, base); git("worktree", "add", "--detach", verifier, base);
  const contents = { "docs/result.txt": "result\n", "docs/test.txt": "assertion\n" }, identity = localCandidateIdentity(base, "docs/result.txt", contents);
  const packet = { version: 1, executionContractDigest: "a".repeat(64), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    request: { goalId: "goal", jobId: "job", changeSetId: "change", builderId: "builder", baseRevision: base,
      sourceRevision: identity.candidateRevision, artifactDigest: identity.artifactDigest, targetPath: "docs/result.txt", allowedUntracked: Object.keys(contents),
      requiredChecks: ["lint", "typecheck", "unit", "integration", "security", "build"] },
    files: Object.entries(contents).map(([path, content]) => ({ path, sha256: hash(content), contentBase64: Buffer.from(content).toString("base64") })) };
  const config = { candidateWorkspace: candidate, verifierWorkspace: verifier, privateKeyFile: join(root, "not-provisioned.pem"),
    receiptFile: join(root, "receipt.json"), verifierId: "independent" };
  const prepare = () => { const bytes = Buffer.from(JSON.stringify(packet)); return prepareTransferredVerifierRequest(bytes, { ...config, expectedRequestSha256: hash(bytes) }); };
  return { root, repo, candidate, verifier, packet, config, prepare };
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
