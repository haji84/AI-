import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestLocalCandidate } from "../scripts/jarvis-independent-artifact-attestation.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "goriq-independent-readback-"));
  const original = join(dir, "original"), candidate = join(dir, "candidate");
  mkdirSync(original);
  git(original, "init");
  git(original, "config", "user.name", "Verifier Test");
  git(original, "config", "user.email", "verifier@example.invalid");
  mkdirSync(join(original, "docs"));
  writeFileSync(join(original, "docs", ".gitkeep"), "base\n");
  git(original, "add", ".");
  git(original, "commit", "-m", "base");
  git(original, "worktree", "add", "--detach", candidate, "HEAD");
  return { original, candidate, revision: git(candidate, "rev-parse", "HEAD"),
    close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("independent readback verifies arbitrary declared UTF-8 file without test-run claims", () => {
  const f = fixture();
  try {
    const path = "docs/result.txt", content = "候補データ\n";
    writeFileSync(join(f.candidate, path), content);
    const receipt = attestLocalCandidate({workspace:f.candidate,baseRevision:f.revision,
      targetPath:path,allowedUntracked:[path]});
    assert.equal(receipt.artifactDigest, sha256(content));
    assert.equal(receipt.patchDigest, sha256(`create\0${path}\0${content}`));
    assert.equal(receipt.candidateRevision, sha256(`candidate\0${f.revision}\0${receipt.patchDigest}`));
    assert.equal(receipt.verifierKind, "independent-byte-readback");
    assert.equal(git(f.original, "status", "--porcelain", "-uall"), "");
  } finally { f.close(); }
});

test("independent verifier refuses unexpected changes, wrong revision and unsafe paths", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.candidate, "docs", "result.txt"), "verified\n");
    const check = (opts) => attestLocalCandidate({
      workspace: f.candidate, baseRevision: f.revision,
      targetPath: "docs/result.txt", allowedUntracked: ["docs/result.txt"], ...opts });
    assert.throws(() => check({ baseRevision: "f".repeat(40) }), /WORKTREE_INVALID/);
    assert.throws(() => check({ targetPath: "../secret.txt" }), /SCOPE_INVALID/);
    assert.throws(() => check({ allowedUntracked: ["docs/result.txt", "docs/other.txt"] }), /STATUS_MISMATCH/);
    writeFileSync(join(f.candidate, "docs", "unexpected.txt"), "keep\n");
    assert.throws(() => check({}), /STATUS_MISMATCH/);
  } finally { f.close(); }
});

test("independent verifier refuses main checkout, non-text or oversized generated artifact", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.candidate, "docs", "candidate.bin"), Buffer.from([0, 1, 2]));
    const request = {workspace:f.candidate, baseRevision:f.revision,
      targetPath:"docs/candidate.bin", allowedUntracked:["docs/candidate.bin"]};
    assert.throws(() => attestLocalCandidate(request), /NOT_PLAIN_UTF8/);
    writeFileSync(join(f.candidate, "docs", "candidate.bin"), "abc".repeat(100));
    assert.throws(() => attestLocalCandidate({...request,maxBytes:10}), /FILE_UNSAFE/);
    assert.throws(() => attestLocalCandidate({...request,workspace:f.original}), /WORKTREE_INVALID/);
  } finally { f.close(); }
});
