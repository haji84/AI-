import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { localOllamaFixtureTest, localOllamaFixtureTestPath, runLocalTddVerification } from "../src/orchestrator/local-ollama-tdd.ts";

const verifier = fileURLToPath(new URL("../scripts/jarvis-local-ollama-tdd-verifier.mjs", import.meta.url));

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "goriq-python-policy-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const repository = join(parent, "repository"), workspace = join(parent, "candidate");
  mkdirSync(repository);
  const git = (...args) => childProcess.execFileSync("git", args, { cwd: repository,
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("config", "user.name", "CI");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  mkdirSync(join(repository, "tests", "fixtures"), { recursive: true });
  writeFileSync(join(repository, "tests", "fixtures", ".gitkeep"), "fixture\n");
  git("add", ".");
  git("commit", "-m", "baseline");
  git("worktree", "add", "--detach", workspace, "HEAD");
  const baseRevision = git("rev-parse", "HEAD");
  writeFileSync(join(workspace, localOllamaFixtureTestPath), localOllamaFixtureTest);
  const capture = join(parent, "python-call.json"), preload = join(parent, "capture-python.mjs");
  // Intercept the process boundary before the verifier is loaded. No Python or
  // launcher can execute, even while this regression runs against unfixed code.
  writeFileSync(preload, `
import childProcess from "node:child_process";
import fs from "node:fs";
import { writeFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalRead=fs.readFileSync;
fs.readFileSync=(path,...args)=>{
  if(path===${JSON.stringify(join(workspace,localOllamaFixtureTestPath))}&&fs.statSync(path).size>131072)throw Error("UNBOUNDED_CANDIDATE_READ");
  return originalRead(path,...args);
};
childProcess.spawnSync = (command, args, options) => {
  if (process.env.GORIQ_TEST_SWAP_ORIGINAL === "1") writeFileSync(${JSON.stringify(join(workspace, localOllamaFixtureTestPath))}, "changed before Python read");
  writeFileSync(${JSON.stringify(capture)}, JSON.stringify({command, args, env: options.env, executedBytes: readFileSync(args.at(-1), "utf8")}));
  return {status: 1, signal: null, stdout: Buffer.alloc(0),
    stderr: Buffer.from("AssertionError: TDD_RED_MISSING_SOURCE")};
};
syncBuiltinESMExports();
`);
  return {
    parent, workspace,
    run(configured, swapOriginal = false) {
      const env = { ...process.env, NODE_OPTIONS: "", PYTHON_MANAGER_AUTOMATIC_INSTALL: "true" };
      if (configured === undefined) delete env.GORIQ_LOCAL_TDD_PYTHON;
      else env.GORIQ_LOCAL_TDD_PYTHON = configured;
      env.GORIQ_TEST_SWAP_ORIGINAL = swapOriginal ? "1" : "0";
      const child = childProcess.spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, verifier], {
        input: JSON.stringify({ workspace, baseRevision, phase: "red" }), encoding: "utf8",
        windowsHide: true, timeout: 15000, env,
      });
      assert.equal(child.error, undefined);
      return { result: JSON.parse(child.stdout.trim()),
        invocation: existsSync(capture) ? JSON.parse(readFileSync(capture, "utf8")) : null };
    },
  };
}

test("Python verification explicitly disables launcher automatic installation", t => {
  const f = fixture(t), { result, invocation } = f.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(invocation.env.PYTHON_MANAGER_AUTOMATIC_INSTALL, "false");
  assert.equal(invocation.env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(existsSync(join(f.workspace, "Python")), false);
});

test("an owner-configured existing interpreter bypasses the Python launcher with isolated flags", t => {
  const f = fixture(t), { result, invocation } = f.run(process.execPath);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(invocation.command, realpathSync(process.execPath));
  assert.deepEqual(invocation.args.slice(0, -1), ["-I", "-B"]);
  assert.equal(basename(invocation.args.at(-1)), "goriq_goal_add_test.py");
  assert.equal(invocation.env.PYTHON_MANAGER_AUTOMATIC_INSTALL, "false");
});

test("Python reads fixed verifier snapshot bytes even when the candidate changes at execution", t => {
  const f = fixture(t), { result, invocation } = f.run(process.execPath, true);
  assert.equal(result.ok, false);
  assert.equal(invocation.executedBytes, localOllamaFixtureTest);
  assert.notEqual(invocation.args.at(-1), join(f.workspace, localOllamaFixtureTestPath));
  assert.equal(existsSync(invocation.args.at(-1)), false);
});

test("oversized fixture fails the bounded attestor before any raw read or execution", t => {
  const f=fixture(t);
  truncateSync(join(f.workspace,localOllamaFixtureTestPath),131073);
  const {result,invocation}=f.run(process.execPath);
  assert.equal(result.ok,false);
  assert.equal(result.blocker,"INDEPENDENT_ARTIFACT_FILE_UNSAFE");
  assert.equal(invocation,null);
});

for (const name of ["relative", "missing", "directory", "candidate"] ) {
  test(`invalid ${name} Python configuration fails closed without launching a fallback`, t => {
    const f = fixture(t);
    const paths = { relative: "python.exe", missing: join(f.parent, "missing-python.exe"),
      directory: f.parent, candidate: join(f.workspace, "tests", "fixtures", ".gitkeep") };
    const { result, invocation } = f.run(paths[name]);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, "PYTHON_RUNNER_CONFIGURATION_INVALID");
    assert.equal(invocation, null);
  });
}

test("resident TDD verification forwards the owner interpreter into the separate verifier process", t => {
  const previous = process.env.GORIQ_LOCAL_TDD_PYTHON;
  process.env.GORIQ_LOCAL_TDD_PYTHON = process.execPath;
  let invocation;
  const intercepted = t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    invocation = { command, args, options };
    return { status: 1, stdout: JSON.stringify({ ok: false, blocker: "PYTHON_RUNNER_UNAVAILABLE" }) };
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(runLocalTddVerification(tmpdir(), "a".repeat(40), "red"),
      { ok: false, blocker: "PYTHON_RUNNER_UNAVAILABLE" });
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.options.env.GORIQ_LOCAL_TDD_PYTHON, process.execPath);
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.GORIQ_LOCAL_TDD_PYTHON;
    else process.env.GORIQ_LOCAL_TDD_PYTHON = previous;
  }
});
