import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test, { type TestContext } from "node:test";
import { createPreparedLocalWriteCheckpoint } from "../src/orchestrator/local-prepared-write.ts";
import { createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import { localOllamaFixtureSourcePath, localOllamaFixtureTest, localOllamaFixtureTestPath } from "../src/orchestrator/local-ollama-tdd.ts";

const content = "def add(a, b):\n    return a + b\n";
function fixture(t: TestContext, phase: "red" | "green") {
  const root = mkdtempSync(join(tmpdir(), "goriq-prepared-write-")), repo = join(root, "repo"), workspace = join(root, "candidate");
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q"); git("config", "core.autocrlf", "false"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "tests", "fixtures"), { recursive: true }); writeFileSync(join(repo, "tests", "fixtures", ".keep"), "fixture\n");
  git("add", "."); git("commit", "-qm", "fixture"); const base = git("rev-parse", "HEAD"); git("worktree", "add", "--detach", workspace, base);
  if (phase === "green") writeFileSync(join(workspace, localOllamaFixtureTestPath), localOllamaFixtureTest);
  const priorPython = process.env.GORIQ_LOCAL_TDD_PYTHON;
  const python = priorPython || (process.platform === "win32" ? join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe") : execFileSync("python3", ["-I", "-B", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim());
  process.env.GORIQ_LOCAL_TDD_PYTHON = python;
  t.after(() => { if (priorPython === undefined) delete process.env.GORIQ_LOCAL_TDD_PYTHON; else process.env.GORIQ_LOCAL_TDD_PYTHON = priorPython; });
  assert.ok(existsSync(python));
  const path = phase === "red" ? localOllamaFixtureTestPath : localOllamaFixtureSourcePath;
  const binding = { executionContractDigest: "a".repeat(64), goalId: "fixture-goal", jobId: "fixture-job", workItemId: `fixture-job:${phase === "red" ? "test" : "implement"}`,
    attemptId: "fixture-job:attempt:1", strategyId: "fixture-job:strategy:1", phase, baseRevision: base, workspace, path, model: "fixture-model" };
  const stateRoot = join(root, "state"), checkpoint = () => createPreparedLocalWriteCheckpoint({ stateRoot, workspaces: [workspace], binding });
  let generations = 0;
  const fetchImpl: typeof fetch = async url => {
    if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "fixture-model" }] });
    assert.equal(String(url), "http://127.0.0.1:11434/api/generate"); generations++;
    return Response.json({ done: true, model: "fixture-model", response: JSON.stringify({ path: localOllamaFixtureSourcePath, content }) });
  };
  const env = { GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1", GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: workspace,
    GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: [localOllamaFixtureSourcePath, localOllamaFixtureTestPath].join(","), GORIQ_LOCAL_OLLAMA_TDD_PROFILE: "python_add_v1", GAI_LOCAL_MODEL_NAME: "fixture-model" };
  const request = { id: "fixture-build", description: "Create add artifact", capability: "code.builder", risk: "low" as const,
    input: { goalId: binding.goalId, attemptId: binding.attemptId, strategyId: binding.strategyId, objective: "Implement add", baseRevision: base, files: [path], localOnly: true, tddPhase: phase } };
  const execute = (preparedWrite = checkpoint()) => createRuntimeBuilderRouter(env, fetchImpl, { preparedWrite }).execute(request, []);
  return { root, workspace, path, binding, checkpoint, execute, target: join(workspace, path), generations: () => generations,
    journal: () => join(stateRoot, "prepared-writes", readdirSync(join(stateRoot, "prepared-writes"))[0]!) };
}

for (const phase of ["red", "green"] as const) {
  for (const interrupted of ["before-file-write", "after-file-write"] as const) {
    test(`${phase} recovers ${interrupted} from a durable prepared intent without new inference`, async t => {
      const f = fixture(t, phase), checkpoint = f.checkpoint();
      if (interrupted === "before-file-write") {
        const result = await f.execute({ ...checkpoint, prepare(bytes) { checkpoint.prepare(bytes); throw Error("fixture_process_interrupted_after_intent"); } });
        assert.equal(result.ok, false); assert.equal(existsSync(f.target), false);
      } else assert.equal((await f.execute(checkpoint)).ok, true);
      const beforeGenerations = f.generations(), journal = readFileSync(f.journal());
      assert.equal(JSON.parse(journal.toString()).verified, false, "intent cannot certify criterion acceptance");
      const result = await f.execute();
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(f.generations(), beforeGenerations);
      assert.equal(readFileSync(f.target, "utf8"), phase === "red" ? localOllamaFixtureTest : content);
      assert.deepEqual(readFileSync(f.journal()), journal, "resume does not rewrite immutable intent");
      const before = statSync(f.target);
      assert.equal((await f.execute()).ok, true); assert.equal(statSync(f.target).mtimeMs, before.mtimeMs);
      assert.equal(f.generations(), beforeGenerations);
    });
  }
  test(`${phase} refuses an identical pre-existing file without its own prepared intent`, async t => {
    const f = fixture(t, phase); writeFileSync(f.target, phase === "red" ? localOllamaFixtureTest : content);
    const result = await f.execute(); assert.equal(result.ok, false); assert.equal(result.blocker, "local_model_target_unsafe"); assert.equal(f.generations(), 0);
  });
  test(`${phase} refuses changed artifacts and extra changes rather than adopting or overwriting`, async t => {
    const f = fixture(t, phase); assert.equal((await f.execute()).ok, true); const generations = f.generations();
    writeFileSync(f.target, "different\n"); assert.equal((await f.execute()).ok, false); assert.equal(readFileSync(f.target, "utf8"), "different\n");
    writeFileSync(f.target, phase === "red" ? localOllamaFixtureTest : content); writeFileSync(join(f.workspace, "tests", "fixtures", "unrelated.txt"), "preserve\n");
    assert.equal((await f.execute()).ok, false); assert.equal(f.generations(), generations);
  });
}

test("prepared records reject changed binding/content and are never overwritten", async t => {
  const f = fixture(t, "red"); assert.equal((await f.execute()).ok, true);
  const record = JSON.parse(readFileSync(f.journal(), "utf8")); record.binding.attemptId = "another-attempt";
  writeFileSync(f.journal(), JSON.stringify(record));
  await assert.rejects(() => f.execute(), /PREPARED_WRITE/);
  assert.throws(() => f.checkpoint().prepare(localOllamaFixtureTest), /PREPARED_WRITE|EEXIST/);
  assert.equal(JSON.parse(readFileSync(f.journal(), "utf8")).binding.attemptId, "another-attempt");
  const digest = createHash("sha256").update(readFileSync(f.journal())).digest("hex");
  assert.equal((await f.execute(createPreparedLocalWriteCheckpoint({ stateRoot: join(f.root, "state"), workspaces: [f.workspace], binding: { ...f.binding, attemptId: "new-attempt" } }))).ok, false);
  assert.equal(createHash("sha256").update(readFileSync(f.journal())).digest("hex"), digest);
});

test("a modified journal cannot authorize different Python bytes", async t => {
  const f = fixture(t, "green"); assert.equal((await f.execute()).ok, true);
  const record = JSON.parse(readFileSync(f.journal(), "utf8")); record.content = "raise RuntimeError('never execute')\n";
  record.contentSha256 = createHash("sha256").update(record.content).digest("hex"); writeFileSync(f.journal(), JSON.stringify(record));
  const generations = f.generations(); assert.equal((await f.execute()).ok, false);
  assert.equal(f.generations(), generations); assert.equal(readFileSync(f.target, "utf8"), content);
});

test("recovery refuses hardlinked candidate and journal files", async t => {
  const f = fixture(t, "red"); assert.equal((await f.execute()).ok, true);
  linkSync(f.target, join(f.root, "candidate-alias")); assert.equal((await f.execute()).ok, false);
  const g = fixture(t, "red"); assert.equal((await g.execute()).ok, true);
  linkSync(g.journal(), join(g.root, "journal-alias")); await assert.rejects(() => g.execute(), /RESIDENT_AUTHORITY_FILE_INVALID/);
});

test("checkpoint refuses an aliased state root before creating any journal", t => {
  const f = fixture(t, "red"), outside = join(f.root, "other-state"), alias = join(f.root, "alias-state"); mkdirSync(outside);
  symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createPreparedLocalWriteCheckpoint({ stateRoot: alias, workspaces: [f.workspace], binding: f.binding }), /AUTHORITY_PATH_ALIAS/);
  assert.deepEqual(readdirSync(outside), []);
});
