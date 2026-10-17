#!/usr/bin/env node
/**
 * Restricted, separately executed RED/GREEN check for the first bounded
 * Codex-free Python add() fixture. Does not use 8796, model APIs, or secrets.
 * This is a process boundary, NOT an OS sandbox or general code verifier.
 */
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

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
function git(root, ...args) { return execFileSync("git", args, {cwd:root,encoding:"utf8",timeout:8000,windowsHide:true}).trim(); }
function validateWorkspace(root, revision) {
  if (!isAbsolute(root) || !existsSync(root) || !/^[0-9a-f]{40}$/.test(revision)) throw Error("BAD_SCOPE");
  const real = realpathSync(root);
  if (git(real,"rev-parse","--show-toplevel").replaceAll("\\","/").toLowerCase() !== real.replaceAll("\\","/").toLowerCase()
      || !lstatSync(join(real,".git")).isFile() || git(real,"branch","--show-current") !== ""
      || git(real,"rev-parse","HEAD") !== revision) throw Error("UNTRUSTED_WORKTREE");
  return real;
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
  const targetTest = join(root,test),targetSource=join(root,source);
  const actualTest = readFileSync(targetTest,"utf8");
  if (actualTest !== expectedTest) throw Error("TEST_CONTRACT_CHANGED");
  const status = git(root,"status","--porcelain","-uall").split("\n").filter(Boolean).sort();
  const allowed = req.phase === "red" ? [`?? ${test}`] : [`?? ${source}`, `?? ${test}`];
  if (JSON.stringify(status)!==JSON.stringify(allowed.sort())) throw Error("WORKTREE_MUTATION_UNEXPECTED");
  if (req.phase === "red" && existsSync(targetSource)) throw Error("RED_SOURCE_ALREADY_EXISTS");
  if (req.phase === "green" && readFileSync(targetSource,"utf8") !== expectedSource) throw Error("UNSAFE_UNREVIEWED_GENERATED_PYTHON");
  const runner = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3","-I","-B",targetTest] : ["-I","-B",targetTest];
  const child = spawnSync(runner,args,{cwd:root,timeout:10000,maxBuffer:12000,windowsHide:true,
    env:{PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",PYTHONDONTWRITEBYTECODE:"1"}});
  if (child.error) throw Error("PYTHON_RUNNER_UNAVAILABLE");
  const stderr = String(child.stderr||"");
  const red = req.phase==="red" && child.status!==0 && child.status!==null &&
    stderr.includes("AssertionError: TDD_RED_MISSING_SOURCE");
  const green = req.phase==="green" && child.status===0;
  if (!red && !green) throw Error("PYTHON_TDD_EXPECTATION_NOT_MET");
  const after = git(root,"status","--porcelain","-uall").split("\n").filter(Boolean).sort();
  if (JSON.stringify(after)!==JSON.stringify(allowed.sort())) throw Error("TEST_MUTATED_WORKTREE");
  const actualContent = req.phase==="red" ? actualTest : readFileSync(targetSource,"utf8");
  const actualPath = req.phase==="red" ? test : source;
  const artifactSha256 = digest(actualContent);
  const patchDigest = digest(`create\0${actualPath}\0${actualContent}`);
  const candidateRevision = digest(`candidate\0${req.baseRevision}\0${patchDigest}`);
  const evidence = {phase:req.phase, outcome:red?"RED_FAIL_OBSERVED":"GREEN_PASS_OBSERVED",
    testSha256:digest(actualTest), artifactSha256, patchDigest, candidateRevision, baseRevision:req.baseRevision,
    exitCode:child.status, verifierId:"local-tdd-separate-process", origin:"node-child-plus-python",
    checks:req.phase==="red"?["missing_source_failure"]:["add_positive","add_zero"],
    recordedAt:new Date().toISOString()};
  out({ok:true,evidence,evidenceDigest:digest(JSON.stringify(evidence))});
}
main().catch(error => {
  out({ok:false,blocker:error instanceof Error?error.message:"UNEXPECTED_VERIFIER_ERROR"});
  process.exitCode=1;
});
