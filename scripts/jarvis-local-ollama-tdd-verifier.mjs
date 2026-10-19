#!/usr/bin/env node
/**
 * Restricted, separately executed RED/GREEN check for the first bounded
 * Codex-free Python add() fixture. Does not use 8796, model APIs, or secrets.
 * This is a process boundary, NOT an OS sandbox or general code verifier.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { attestLocalCandidate } from "./jarvis-independent-artifact-attestation.mjs";
import { safeGit } from "./jarvis-verifier-safe-git.mjs";

const source = "tests/fixtures/goriq_goal_add.py";
const test = "tests/fixtures/goriq_goal_add_test.py";
const expectedTest = [
  "from pathlib import Path",
  "import runpy",
  "source = Path(__file__).with_name('goriq_goal_add.py')",
  "assert source.is_file(), 'TDD_RED_MISSING_SOURCE'",
  "namespace = runpy.run_path(str(source))",
  "assert namespace['add'](2, 3) == 5, 'ADD_POSITIVE'",
  "assert namespace['add'](-2, 2) == 0, 'ADD_ZERO'",
  "",
].join("\n");
const expectedSource = "def add(a, b):\n    return a + b\n";
const digest = s => createHash("sha256").update(s).digest("hex");
const out = record => { process.stdout.write(JSON.stringify(record) + "\n"); };
function git(root, ...args) { return safeGit(root, args); }
function validateWorkspace(root, revision) {
  if (!isAbsolute(root) || !existsSync(root) || !/^[0-9a-f]{40}$/.test(revision)) throw Error("BAD_SCOPE");
  const real = realpathSync(root);
  if (git(real,"rev-parse","--show-toplevel").replaceAll("\\","/").toLowerCase() !== real.replaceAll("\\","/").toLowerCase()
      || !lstatSync(join(real,".git")).isFile() || git(real,"branch","--show-current") !== ""
      || git(real,"rev-parse","HEAD") !== revision) throw Error("UNTRUSTED_WORKTREE");
  return real;
}
function removeOwnedSnapshot(snapshot,tempRoot) {
  if(dirname(snapshot)!==tempRoot||!basename(snapshot).startsWith("goriq-tdd-proof-")||lstatSync(snapshot).isSymbolicLink())
    throw Error("PYTHON_SNAPSHOT_CLEANUP_UNSAFE");
  rmSync(snapshot,{recursive:true,force:true});
}
async function main() {
  let data = "";
  for await (const part of process.stdin) {
    data += String(part);
    if (Buffer.byteLength(data) > 8192) throw Error("INPUT_TOO_LARGE");
  }
  const req = JSON.parse(data);
  if (!req || !["red","green"].includes(req.phase) || typeof req.workspace !== "string") throw Error("BAD_INPUT");
  const root = validateWorkspace(req.workspace, req.baseRevision);
  const targetSource=join(root,source);
  const status = git(root,"status","--porcelain","-uall").split("\n").filter(Boolean).sort();
  const allowed = req.phase === "red" ? [`?? ${test}`] : [`?? ${source}`, `?? ${test}`];
  if (JSON.stringify(status)!==JSON.stringify(allowed.sort())) throw Error("WORKTREE_MUTATION_UNEXPECTED");
  if (req.phase === "red" && existsSync(targetSource)) throw Error("RED_SOURCE_ALREADY_EXISTS");
  const actualPath = req.phase === "red" ? test : source;
  const scopedPaths = req.phase === "red" ? [test] : [source, test];
  // Read independently from disk and reject symlinks, unexpected Git changes,
  // bytes outside the owner-declared scope, and incorrect HEAD before execution.
  const before = attestLocalCandidate({ workspace: root, baseRevision: req.baseRevision,
    targetPath: actualPath, allowedUntracked: scopedPaths });
  if(before.fileHashes[test]!==digest(expectedTest))throw Error("TEST_CONTRACT_CHANGED");
  if(req.phase==="green"&&before.fileHashes[source]!==digest(expectedSource))throw Error("UNSAFE_UNREVIEWED_GENERATED_PYTHON");
  const configuredPython = process.env.GORIQ_LOCAL_TDD_PYTHON;
  let runner = process.platform === "win32" ? "py" : "python3";
  if (configuredPython !== undefined) {
    try {
      if (!isAbsolute(configuredPython)) throw Error();
      runner = realpathSync(configuredPython);
      for (const path of [configuredPython, runner]) {
        const rel = relative(root, path);
        if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) throw Error();
      }
      if (!lstatSync(runner).isFile()) throw Error();
      accessSync(runner, constants.X_OK);
    } catch { throw Error("PYTHON_RUNNER_CONFIGURATION_INVALID"); }
  }
  // Execute only the code-owned fixed fixture, never a live Builder pathname.
  // This remains a bounded fixture check, not general untrusted-code isolation.
  const tempRoot=realpathSync(tmpdir());
  const snapshot=mkdtempSync(join(tempRoot,"goriq-tdd-proof-"));
  let child;
  try{
    const rel=relative(root,snapshot);
    if(!rel||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep)))throw Error("PYTHON_SNAPSHOT_IN_CANDIDATE");
    const script=join(snapshot,basename(test));
    writeFileSync(script,expectedTest,{flag:"wx",mode:0o600});
    if(req.phase==="green")writeFileSync(join(snapshot,basename(source)),expectedSource,{flag:"wx",mode:0o600});
    const args = process.platform === "win32" && configuredPython === undefined
      ? ["-3","-I","-B",script] : ["-I","-B",script];
    child = spawnSync(runner,args,{cwd:snapshot,timeout:10000,killSignal:"SIGKILL",maxBuffer:12000,windowsHide:true,
      env:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",PYTHONDONTWRITEBYTECODE:"1",
        PYTHON_MANAGER_AUTOMATIC_INSTALL:"false"}});
  }finally{
    removeOwnedSnapshot(snapshot,tempRoot);
  }
  if (child.error) throw Error("PYTHON_RUNNER_UNAVAILABLE");
  const stderr = String(child.stderr||"");
  const red = req.phase==="red" && child.status!==0 && child.status!==null &&
    stderr.includes("AssertionError: TDD_RED_MISSING_SOURCE");
  const green = req.phase==="green" && child.status===0;
  if (!red && !green) throw Error("PYTHON_TDD_EXPECTATION_NOT_MET");
  const after = git(root,"status","--porcelain","-uall").split("\n").filter(Boolean).sort();
  if (JSON.stringify(after)!==JSON.stringify(allowed.sort())) throw Error("TEST_MUTATED_WORKTREE");
  const afterReadback = attestLocalCandidate({ workspace: root, baseRevision: req.baseRevision,
    targetPath: actualPath, allowedUntracked: scopedPaths });
  const artifactSha256 = before.artifactDigest;
  const { patchDigest, candidateRevision } = afterReadback;
  if (before.artifactDigest !== afterReadback.artifactDigest ||
      artifactSha256 !== afterReadback.artifactDigest ||
      before.candidateRevision !== candidateRevision) throw Error("INDEPENDENT_ARTIFACT_CHANGED");
  const evidence = {phase:req.phase, outcome:red?"RED_FAIL_OBSERVED":"GREEN_PASS_OBSERVED",
    testSha256:before.fileHashes[test], artifactSha256, patchDigest, candidateRevision, baseRevision:req.baseRevision,
    exitCode:child.status, verifierId:"local-tdd-separate-process", origin:"node-child-plus-python",
    checks:req.phase==="red"?["missing_source_failure"]:["add_positive","add_zero"],
    recordedAt:new Date().toISOString()};
  out({ok:true,evidence,evidenceDigest:digest(JSON.stringify(evidence))});
}
main().catch(error => {
  out({ok:false,blocker:error instanceof Error?error.message:"UNEXPECTED_VERIFIER_ERROR"});
  process.exitCode=1;
});
