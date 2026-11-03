import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestLocalCandidate } from "../scripts/jarvis-independent-artifact-attestation.mjs";
import * as runner from "../scripts/jarvis-independent-check-runner.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "verifier-tracked-edits-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"), candidate = join(root, "candidate"), verifier = join(root, "verifier");
  mkdirSync(repo); mkdirSync(join(repo, "src"));
  git(repo, "init"); git(repo, "config", "user.name", "Verifier regression");
  git(repo, "config", "user.email", "verifier@example.invalid"); git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "src/a.ts"), "export const answer = 0;\n");
  writeFileSync(join(repo, "src/b.ts"), "export const guard = false;\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "original source");
  git(repo, "worktree", "add", "--detach", candidate, "HEAD");
  git(repo, "worktree", "add", "--detach", verifier, "HEAD");
  const baseRevision = git(repo, "rev-parse", "HEAD");
  const modify = (path, content) => {
    const before = readFileSync(join(candidate, path)); writeFileSync(join(candidate, path), content);
    return { path, beforeSha256: hash(before), afterSha256: hash(content) };
  };
  const changes = [modify("src/a.ts", "export const answer = 42;\n"), modify("src/b.ts", "export const guard = true;\n")];
  const scope = { workspace: candidate, baseRevision, targetPath: "src/a.ts", allowedUntracked: [], trackedEdits: { version: 2, files: changes } };
  return { root, repo, candidate, verifier, changes, scope };
}

test("v2 attests complete tracked changes against pristine blob bytes and distinct identity", t => {
  const f = fixture(t), out = attestLocalCandidate(f.scope);
  assert.equal(out.baseRevision, f.scope.baseRevision);
  assert.equal(out.artifactDigest, hash("export const answer = 42;\n"));
  assert.equal(out.trackedEdits.version, 2);
  assert.deepEqual(out.trackedEdits.files, f.changes);
  const manifest = f.changes.map(c => [c.path, c.beforeSha256, c.afterSha256]);
  assert.equal(out.patchDigest, hash(`tracked-edits-v2\0${JSON.stringify(manifest)}`));
  assert.equal(out.candidateRevision, hash(`candidate\0${f.scope.baseRevision}\0${out.patchDigest}`));
  assert.equal(attestLocalCandidate({ ...f.scope, trackedEdits: {version:2,files:[...f.changes].reverse()} }).candidateRevision, out.candidateRevision);
  assert.equal(git(f.repo, "status", "--porcelain", "-uall"), "");
});

test("legacy calls still refuse tracked edits and v2 rejects malformed or ambiguous scope", t => {
  const f = fixture(t);
  assert.throws(() => attestLocalCandidate({...f.scope, trackedEdits:undefined}), /SCOPE_INVALID|STATUS_MISMATCH/);
  for (const manifest of [null, {version:1,files:f.changes}, {version:2,files:[]},
    {version:2,files:[f.changes[0],f.changes[0]]}, {version:2,files:[{...f.changes[0],path:"../secret"}]},
    {version:2,files:[{...f.changes[0],extra:true}]}, {version:2,files:f.changes,command:"true"}]) {
    assert.throws(() => attestLocalCandidate({...f.scope,trackedEdits:manifest}), /SCOPE_INVALID/);
  }
  assert.throws(() => attestLocalCandidate({...f.scope,allowedUntracked:["src/a.ts"]}), /SCOPE_INVALID/);
});

test("v2 refuses incorrect original hash, changed output and wrong baseline", t => {
  const f = fixture(t);
  assert.throws(() => attestLocalCandidate({...f.scope,trackedEdits:{version:2,files:[{...f.changes[0],beforeSha256:"0".repeat(64)},f.changes[1]]}}), /BASELINE_MISMATCH/);
  writeFileSync(join(f.candidate,"src/a.ts"), "export const answer = 43;\n");
  assert.throws(() => attestLocalCandidate(f.scope), /CONTENT_MISMATCH/);
  assert.throws(() => attestLocalCandidate({...f.scope,baseRevision:"f".repeat(40)}), /WORKTREE_INVALID/);
});

for (const change of ["unstated", "staged", "deleted", "renamed", "untracked"]) {
  test(`v2 rejects ${change} changes before attesting`, t => {
    const f = fixture(t);
    if (change === "unstated") f.scope.trackedEdits.files = [f.changes[0]];
    if (change === "staged") git(f.candidate,"add","src/a.ts");
    if (change === "deleted") rmSync(join(f.candidate,"src/b.ts"));
    if (change === "renamed") renameSync(join(f.candidate,"src/b.ts"),join(f.candidate,"src/c.ts"));
    if (change === "untracked") writeFileSync(join(f.candidate,"src/extra.ts"),"extra\n");
    assert.throws(() => attestLocalCandidate(f.scope), /STATUS_MISMATCH/);
  });
}

test("v2 refuses hidden index flags rather than treating hidden edits as clean", t => {
  const f=fixture(t); git(f.candidate,"update-index","--assume-unchanged","src/b.ts");
  assert.throws(() => attestLocalCandidate(f.scope), /INDEX_UNSAFE/);
});

test("v2 rejects symlink substitutions and undeclared executable mode changes", {skip:process.platform==="win32"}, t => {
  const f=fixture(t), outside=join(f.root,"outside.ts"); writeFileSync(outside,"export const answer = 42;\n");
  rmSync(join(f.candidate,"src/a.ts")); symlinkSync(outside,join(f.candidate,"src/a.ts"));
  assert.throws(() => attestLocalCandidate(f.scope), /FILE_UNSAFE/);
  rmSync(join(f.candidate,"src/a.ts")); writeFileSync(join(f.candidate,"src/a.ts"),"export const answer = 42;\n");
  chmodSync(join(f.candidate,"src/a.ts"),0o755);
  assert.throws(() => attestLocalCandidate(f.scope), /MODE_MISMATCH/);
});

test("runner accepts explicit v2 only with all six fixed checks and preserves every other gate", async t => {
  const f=fixture(t), out=attestLocalCandidate(f.scope);
  const req={goalId:"g",jobId:"j",changeSetId:"c",builderId:"builder",verifierId:"verifier",baseRevision:f.scope.baseRevision,
    sourceRevision:out.candidateRevision,artifactDigest:out.artifactDigest,targetPath:f.scope.targetPath,allowedUntracked:[],
    trackedEdits:f.scope.trackedEdits,requiredChecks:["lint","typecheck","unit","integration","security","build"],
    candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,privateKeyFile:join(f.root,"unconfigured.key"),receiptFile:join(f.root,"receipt.json")};
  assert.equal(runner.validateVerifierRunRequest(req),req);
  assert.throws(()=>runner.validateVerifierRunRequest({...req,requiredChecks:["unit"]}),/NOT_BOUNDED/);
  const prior=process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED; delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED;
  try {await assert.rejects(()=>runner.runIndependentVerifier(req),/SEPARATE_PRINCIPAL_NOT_ACKNOWLEDGED/);}
  finally {if(prior===undefined) delete process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED; else process.env.GORIQ_VERIFIER_OPERATOR_ISOLATED=prior;}
});

test("staging transfers only the manifest-bound replacements into a pristine separate worktree without keys", t => {
  const f=fixture(t), original=readFileSync(join(f.verifier,"src/a.ts"),"utf8"), identity=attestLocalCandidate(f.scope);
  const result=runner.stageIndependentCandidate({candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,baseRevision:f.scope.baseRevision,
    targetPath:f.scope.targetPath,allowedUntracked:[],trackedEdits:f.scope.trackedEdits,
    sourceRevision:identity.candidateRevision,artifactDigest:identity.artifactDigest});
  assert.equal(original,"export const answer = 0;\n");
  assert.equal(readFileSync(join(f.verifier,"src/a.ts"),"utf8"),"export const answer = 42;\n");
  assert.equal(result.candidateRevision,identity.candidateRevision);
  assert.equal(git(f.repo,"status","--porcelain","-uall"),"");
  assert.throws(()=>runner.stageIndependentCandidate({candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,baseRevision:f.scope.baseRevision,
    targetPath:f.scope.targetPath,allowedUntracked:[],trackedEdits:f.scope.trackedEdits,
    sourceRevision:identity.candidateRevision,artifactDigest:identity.artifactDigest}),/RUNNER_NOT_CLEAN/);
});

test("v2 mixed create and modify scope binds every file and stages both forms", t => {
  const f=fixture(t), path="src/new.ts", content="export const added = true;\n";
  writeFileSync(join(f.candidate,path),content);
  const scope={...f.scope,allowedUntracked:[path]}, out=attestLocalCandidate(scope);
  const manifest=[...f.changes.map(c=>[c.path,c.beforeSha256,c.afterSha256]),[path,null,hash(content)]];
  assert.equal(out.patchDigest,hash(`tracked-edits-v2\0${JSON.stringify(manifest)}`));
  assert.equal(out.fileHashes[path],hash(content));
  runner.stageIndependentCandidate({candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,...scope,
    sourceRevision:out.candidateRevision,artifactDigest:out.artifactDigest});
  assert.equal(readFileSync(join(f.verifier,path),"utf8"),content);
});

test("staging rejects hidden verifier index flags before any source overwrite", t => {
  const f=fixture(t), identity=attestLocalCandidate(f.scope);
  git(f.verifier,"update-index","--skip-worktree","src/b.ts");
  assert.throws(()=>runner.stageIndependentCandidate({candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,...f.scope,
    sourceRevision:identity.candidateRevision,artifactDigest:identity.artifactDigest}),/RUNNER_INDEX_UNSAFE/);
  assert.equal(readFileSync(join(f.verifier,"src/a.ts"),"utf8"),"export const answer = 0;\n");
});

test("staging rejects wrong candidate identity without overwriting the pristine source", t => {
  const f=fixture(t), identity=attestLocalCandidate(f.scope);
  assert.throws(()=>runner.stageIndependentCandidate({candidateWorkspace:f.candidate,verifierWorkspace:f.verifier,...f.scope,
    sourceRevision:"0".repeat(64),artifactDigest:identity.artifactDigest}),/CANDIDATE_BINDING_MISMATCH/);
  assert.equal(readFileSync(join(f.verifier,"src/a.ts"),"utf8"),"export const answer = 0;\n");
});

test("v2 refuses undeclared chmod even when repository filemode detection is disabled", {skip:process.platform==="win32"}, t => {
  const f=fixture(t); writeFileSync(join(f.candidate,"src/b.ts"),"export const guard = false;\n");
  f.scope.trackedEdits.files=[f.changes[0]];
  git(f.candidate,"config","core.filemode","false"); chmodSync(join(f.candidate,"src/b.ts"),0o755);
  assert.throws(()=>attestLocalCandidate(f.scope),/STATUS_MISMATCH/);
});
