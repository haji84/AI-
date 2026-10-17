import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";
import {
  localOllamaFixtureSourcePath, localOllamaFixtureTestPath,
  localOllamaFixtureTest, runLocalTddVerification,
} from "../src/orchestrator/local-ollama-tdd.ts";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function sandbox() {
  const parent = mkdtempSync(join(tmpdir(), "goriq-local-tdd-"));
  const root = join(parent, "repo");
  const isolated = join(parent, "candidate");
  mkdirSync(root);
  git(root, "init");
  git(root, "config", "user.name", "CI");
  git(root, "config", "user.email", "tdd@example.invalid");
  mkdirSync(join(root, "tests", "fixtures"), { recursive: true });
  writeFileSync(join(root, "tests", "fixtures", ".gitkeep"), "test\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  git(root, "worktree", "add", "--detach", isolated, "HEAD");
  return { root, isolated, head: git(isolated, "rev-parse", "HEAD"),
    cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}
const allowed = [localOllamaFixtureSourcePath, localOllamaFixtureTestPath];
const env = (workspace: string) => ({
  GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1",
  GORIQ_LOCAL_OLLAMA_TDD_PROFILE: "python_add_v1",
  GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: workspace,
  GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: allowed.join(","),
  GAI_LOCAL_MODEL_NAME: "qwen2.5-coder:3b",
  CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
  CODE_BUILDER_LOCAL_TOKEN: "must-not-be-used",
});
function request(head: string, phase: "red" | "green") {
  return { id: "tdd-"+phase, description: "bounded add test", capability: "code.builder", risk: "low" as const,
    input: { goalId: "fixture-goal", attemptId: phase, strategyId: "fixture-"+phase,
      objective: "Implement Python add(a, b) returning a + b",
      baseRevision: head, localOnly: true, tddPhase: phase,
      files: [phase === "red" ? localOllamaFixtureTestPath : localOllamaFixtureSourcePath] } };
}
test("real separate process observes RED test failure then GREEN success without Codex", async () => {
  const p = sandbox();
  try {
    const calls: string[] = [];
    const mock: typeof fetch = async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen2.5-coder:3b" }] });
      if (url.endsWith("/api/generate")) return Response.json({ model: "qwen2.5-coder:3b", done: true,
        response: JSON.stringify({ path: localOllamaFixtureSourcePath,
          content: "def add(a, b):\n    return a + b" }) });
      throw Error("Forbidden network destination: " + url);
    };
    const router = createRuntimeBuilderRouter(env(p.isolated), mock);
    const redBuild = await router.execute(request(p.head, "red"), []);
    assert.equal(redBuild.ok, true, JSON.stringify(redBuild));
    assert.equal(readFileSync(join(p.isolated, localOllamaFixtureTestPath), "utf8"), localOllamaFixtureTest);
    const redProof = runLocalTddVerification(p.isolated, p.head, "red");
    assert.equal(redProof.ok, true, JSON.stringify(redProof));
    assert.equal(redProof.evidence?.outcome, "RED_FAIL_OBSERVED");
    assert.notEqual(redProof.evidence?.exitCode, 0);
    const greenBuild = await router.execute(request(p.head, "green"), []);
    assert.equal(greenBuild.ok, true, JSON.stringify(greenBuild));
    const greenProof = runLocalTddVerification(p.isolated, p.head, "green");
    assert.equal(greenProof.ok, true, JSON.stringify(greenProof));
    assert.equal(greenProof.evidence?.outcome, "GREEN_PASS_OBSERVED");
    assert.equal(greenProof.evidence?.exitCode, 0);
    assert.deepEqual(calls, [
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/generate",
    ]);
    assert.equal(git(p.root, "status", "--porcelain", "-uall"), "");
  } finally { p.cleanup(); }
});
test("unexpected failure, tampered test and dirty worktree cannot counterfeit RED", () => {
  const p = sandbox();
  try {
    const target = join(p.isolated, localOllamaFixtureTestPath);
    writeFileSync(target, "raise RuntimeError('fake failure')\n");
    const forged = runLocalTddVerification(p.isolated, p.head, "red");
    assert.equal(forged.ok, false);
    assert.notEqual(forged.blocker, undefined);
    writeFileSync(target, localOllamaFixtureTest);
    writeFileSync(join(p.isolated, "tests", "fixtures", "unexpected.txt"), "preserve");
    assert.equal(runLocalTddVerification(p.isolated, p.head, "red").ok, false);
  } finally { p.cleanup(); }
});
test("nonfixture and invalid TDD policy still fail closed", () => {
  const p = sandbox();
  try {
    assert.throws(() => createRuntimeBuilderRouter({ ...env(p.isolated), GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: localOllamaFixtureSourcePath }),
      /two-file allowlist/);
    assert.throws(() => createRuntimeBuilderRouter({ ...env(p.isolated), GORIQ_LOCAL_OLLAMA_TDD_PROFILE: "arbitrary-shell" }),
      /Unknown local Ollama TDD profile/);
  } finally { p.cleanup(); }
});
