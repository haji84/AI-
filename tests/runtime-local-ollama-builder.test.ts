import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";

const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function sandbox() {
  const parent = mkdtempSync(join(tmpdir(), "goriq-ollama-isolated-"));
  const main = join(parent, "main");
  const isolated = join(parent, "candidate");
  mkdirSync(main);
  run(main, "init");
  run(main, "config", "user.name", "Test");
  run(main, "config", "user.email", "test@example.invalid");
  mkdirSync(join(main, "tests"));
  mkdirSync(join(main, "tests", "fixtures"));
  writeFileSync(join(main, "tests", "fixtures", ".gitkeep"), "\n");
  run(main, "add", ".");
  run(main, "commit", "-m", "baseline");
  run(main, "worktree", "add", "--detach", isolated, "HEAD");
  return { main, isolated, head: run(isolated, "rev-parse", "HEAD"), clean: () => rmSync(parent, { recursive: true, force: true }) };
}
const file = "tests/fixtures/generated.txt";
const request = (revision: string) => ({
  id: "local-goal-test", description: "Create bounded fixture", capability: "code.builder", risk: "low" as const,
  input: { goalId: "goriq-test", attemptId: "test-attempt", strategyId: "local-model-1", objective: "Write one line containing safe-test",
    baseRevision: revision, files: [file], localOnly: true, tddPhase: "green" as const },
});
function mockOllama(counts: { tags: number; generate: number }): typeof fetch {
  return async (input) => {
    const endpoint = String(input);
    if (endpoint === "http://127.0.0.1:11434/api/tags") {
      counts.tags++;
      return Response.json({ models: [{ name: "qwen2.5-coder:3b" }] });
    }
    if (endpoint === "http://127.0.0.1:11434/api/generate") {
      counts.generate++;
      return Response.json({ model: "qwen2.5-coder:3b", done: true,
        response: JSON.stringify({ path: file, content: "safe-test" }) });
    }
    throw Error("Unexpected external/Builder HTTP request: " + endpoint);
  };
}
function env(workspace: string) { return {
  GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1",
  GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: workspace,
  GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: file,
  GAI_LOCAL_MODEL_NAME: "qwen2.5-coder:3b",
  GAI_LOCAL_MODEL_ENDPOINT: "http://127.0.0.1:11434",
  CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
  CODE_BUILDER_LOCAL_TOKEN: "never-use-this-codex-endpoint",
  CODE_BUILDER_ENDPOINTS_JSON: JSON.stringify({ paid: { url: "https://billing.invalid", token: "token" } }),
}; }

test("scoped local Ollama Builder produces one file and no Codex/paid fallback", async () => {
  const p = sandbox();
  try {
    const counts = { tags: 0, generate: 0 };
    const router = createRuntimeBuilderRouter(env(p.isolated), mockOllama(counts));
    const result = await router.execute(request(p.head), []);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.evidence?.builderKind, "local");
    assert.deepEqual((result.evidence?.changeSet as { changedPaths: string[] })?.changedPaths, [file]);
    assert.equal(readFileSync(join(p.isolated, file), "utf8"), "safe-test\n");
    assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), `?? ${file}`);
    assert.equal(run(p.main, "status", "--porcelain", "-uall"), "");
    assert.equal(counts.generate, 1);
  } finally { p.clean(); }
});

test("builder refuses main checkout and missing allowlist", () => {
  const p = sandbox();
  try {
    assert.throws(() => createRuntimeBuilderRouter(env(p.main), mockOllama({ tags: 0, generate: 0 })), /detached linked worktree/);
    assert.throws(() => createRuntimeBuilderRouter({ ...env(p.isolated), GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: "" }), /allowlist/);
  } finally { p.clean(); }
});

test("dirty worktree fails closed without invoking generation", async () => {
  const p = sandbox();
  try {
    writeFileSync(join(p.isolated, "tests", "fixtures", "existing.txt"), "keep me");
    const counts = { tags: 0, generate: 0 };
    const router = createRuntimeBuilderRouter(env(p.isolated), mockOllama(counts));
    const result = await router.execute(request(p.head), []);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, "local_model_workspace_not_clean");
    assert.equal(counts.generate, 0);
  } finally { p.clean(); }
});

test("unverified TDD red and nonlocal task never modify files", async () => {
  const p = sandbox();
  try {
    const counts = { tags: 0, generate: 0 };
    const router = createRuntimeBuilderRouter(env(p.isolated), mockOllama(counts));
    const tdd = request(p.head);
    const red = { ...tdd, input: { ...tdd.input, tddPhase: "red" as const } };
    assert.equal((await router.execute(red, [])).ok, false);
    const nonLocal = request(p.head);
    nonLocal.input.localOnly = false;
    assert.equal((await router.execute(nonLocal, [])).ok, false);
    assert.equal(counts.generate, 0);
  } finally { p.clean(); }
});
