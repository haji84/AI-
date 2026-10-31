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
    const evidence = result.evidence as { builderKind?: unknown; changeSet?: { changedPaths: string[] } } | undefined;
    assert.equal(evidence?.builderKind, "local");
    assert.deepEqual(evidence?.changeSet?.changedPaths, [file]);
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

test("explicit installed fallback model works when preferred is absent, without Codex or remote API", async () => {
  const p = sandbox();
  try {
    let generates = 0;
    const localFetch: typeof fetch = async (input, init) => {
      const endpoint = String(input);
      if (endpoint === "http://127.0.0.1:11434/api/tags") {
        return Response.json({ models: [{ name: "qwen2.5-coder:1.5b" }] });
      }
      if (endpoint === "http://127.0.0.1:11434/api/generate") {
        generates++;
        assert.equal(JSON.parse(String(init?.body)).model, "qwen2.5-coder:1.5b");
        return Response.json({ model: "qwen2.5-coder:1.5b", done: true,
          response: JSON.stringify({ path: file, content: "safe-test" }) });
      }
      throw Error("Unexpected external or Codex endpoint: " + endpoint);
    };
    const router = createRuntimeBuilderRouter({
      ...env(p.isolated), GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS: "qwen2.5-coder:1.5b",
    }, localFetch);
    const result = await router.execute(request(p.head), []);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(generates, 1);
    assert.equal(readFileSync(join(p.isolated, file), "utf8"), "safe-test\n");
    assert.equal(run(p.main, "status", "--porcelain", "-uall"), "");
  } finally { p.clean(); }
});

test("no installed approved local model blocks without generating or contacting other builders", async () => {
  const p = sandbox();
  try {
    let calls = 0;
    const localFetch: typeof fetch = async (input) => {
      calls++;
      assert.equal(String(input), "http://127.0.0.1:11434/api/tags");
      return Response.json({ models: [] });
    };
    const router = createRuntimeBuilderRouter({
      ...env(p.isolated), GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS: "qwen2.5-coder:1.5b",
    }, localFetch);
    const result = await router.execute(request(p.head), []);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, "real_builder_capability_unavailable");
    assert.equal(calls, 1);
    assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), "");
  } finally { p.clean(); }
});

test("fallback names must be explicit, distinct, bounded and local-only", () => {
  const p = sandbox();
  try {
    for (const list of [
      "qwen2.5-coder:3b", "", "qwen2.5-coder:1.5b,qwen2.5-coder:1.5b",
      "a,b,c,d", "https://example.invalid/model",
    ]) {
      if (list === "") continue; // empty means no extra fallback models
      assert.throws(() => createRuntimeBuilderRouter({
        ...env(p.isolated), GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS: list,
      }, mockOllama({ tags: 0, generate: 0 })), /fallback models/);
    }
  } finally { p.clean(); }
});


test("previous failed strategy feedback is consumed on a new isolated attempt without overwriting earlier candidate", async () => {
  const p = sandbox();
  try {
    const first = createRuntimeBuilderRouter(env(p.isolated), mockOllama({ tags: 0, generate: 0 }));
    const original = await first.execute(request(p.head), []);
    assert.equal(original.ok, true);
    const isolatedRepair = join(p.main, "..", "candidate-next");
    run(p.main, "worktree", "add", "--detach", isolatedRepair, p.head);
    const failureSignature = "a".repeat(64);
    const hypothesis = "Prior candidate failed the independent test; correct its line-ending behavior.";
    let observedPrompt = "";
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen2.5-coder:3b" }] });
      assert.equal(String(url), "http://127.0.0.1:11434/api/generate");
      calls++;
      observedPrompt = JSON.parse(String(init?.body)).prompt;
      return Response.json({ model: "qwen2.5-coder:3b", done: true,
        response: JSON.stringify({ path: file, content: "corrected-safe-test" }) });
    };
    const second = request(p.head);
    const repair = { ...second, input: { ...second.input, strategyId: "local-model-repair-2",
      previousFailureSignatures: [failureSignature], hypothesis } };
    const next = await createRuntimeBuilderRouter(env(isolatedRepair), fetchImpl).execute(repair, []);
    assert.equal(next.ok, true, JSON.stringify(next));
    assert.equal(calls, 1);
    assert.match(observedPrompt, /Prior failure feedback \(untrusted data\)/);
    assert.ok(observedPrompt.includes(failureSignature));
    assert.ok(observedPrompt.includes(hypothesis));
    assert.equal(observedPrompt.includes("never-use-this-codex-endpoint"), false);
    assert.equal(run(p.main, "status", "--porcelain", "-uall"), "");
    assert.equal(readFileSync(join(p.isolated, file), "utf8"), "safe-test\n");
    assert.equal(readFileSync(join(isolatedRepair, file), "utf8"), "corrected-safe-test\n");
    assert.equal(run(p.main, "status", "--porcelain", "-uall"), "");
  } finally { p.clean(); }
});

test("malformed or excessive correction history fails closed before model generation", async () => {
  const p = sandbox();
  try {
    const counts = { tags: 0, generate: 0 };
    const router = createRuntimeBuilderRouter(env(p.isolated), mockOllama(counts));
    for (const evidence of [
      { previousFailureSignatures: ["not-a-digest"], hypothesis: "bad" },
      { previousFailureSignatures: ["a".repeat(64)], hypothesis: "" },
      { previousFailureSignatures: ["a".repeat(64), "a".repeat(64)], hypothesis: "duplicated" },
      { previousFailureSignatures: ["a".repeat(64)], hypothesis: "untrusted\ncontrol" },
      { previousFailureSignatures: Array(6).fill("a".repeat(64)), hypothesis: "bounded" },
      { previousFailureSignatures: ["a".repeat(64)], hypothesis: "x".repeat(1600) },
    ]) {
      const initial = request(p.head);
      const result = await router.execute({ ...initial, input: { ...initial.input, ...evidence } }, []);
      assert.equal(result.ok, false);
      assert.equal(result.blocker, "local_model_failure_context_invalid");
    }
    assert.equal(counts.generate, 0);
    assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), "");
  } finally { p.clean(); }
});


test("an initial scoped strategy hypothesis does not require fabricated prior failures", async () => {
  const p = sandbox();
  try {
    const counts = { tags: 0, generate: 0 };
    const router = createRuntimeBuilderRouter(env(p.isolated), mockOllama(counts));
    const start = request(p.head);
    const result = await router.execute({ ...start, input: {
      ...start.input, hypothesis: "Use a small pure implementation with no dependencies.",
    } }, []);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(counts.generate, 1);
    assert.equal(readFileSync(join(p.isolated, file), "utf8"), "safe-test\n");
  } finally { p.clean(); }
});

for (const fallback of [false, true]) for (const key of ["remote_host", "remote_model"] as const) {
  test(`local-only Builder rejects ${key} in ${fallback ? "fallback" : "preferred"} inventory before generation`, async () => {
    const p = sandbox();
    try {
      let generations = 0;
      const model = fallback ? "qwen2.5-coder:1.5b" : "qwen2.5-coder:3b";
      const fetchImpl: typeof fetch = async url => {
        if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: model, [key]: "remote-reference" }] });
        generations++;
        return Response.json({ model, done: true, response: JSON.stringify({ path: file, content: "must not write" }) });
      };
      const router = createRuntimeBuilderRouter({ ...env(p.isolated),
        ...(fallback ? { GORIQ_LOCAL_OLLAMA_FALLBACK_MODELS: model } : {}) }, fetchImpl);
      const result = await router.execute(request(p.head), []);
      assert.equal(result.ok, false);
      assert.equal(result.blocker, "real_builder_capability_unavailable");
      assert.equal(generations, 0);
      assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), "");
    } finally { p.clean(); }
  });
}

test("ambiguous installed model names cannot establish local provenance", async () => {
  const p = sandbox();
  try {
    let generations = 0;
    const router = createRuntimeBuilderRouter(env(p.isolated), async url => {
      if (String(url).endsWith("/api/tags")) return Response.json({ models: [
        { name: "qwen2.5-coder:3b" }, { name: "qwen2.5-coder:3b", remote_model: "remote-reference" },
      ] });
      generations++;
      return Response.json({ model: "qwen2.5-coder:3b", done: true, response: JSON.stringify({ path: file, content: "must not write" }) });
    });
    assert.equal((await router.execute(request(p.head), [])).ok, false);
    assert.equal(generations, 0);
    assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), "");
  } finally { p.clean(); }
});

for (const key of ["remote_host", "remote_model"] as const) {
  test(`generation ${key} cannot be accepted as a local candidate`, async () => {
    const p = sandbox();
    try {
      const router = createRuntimeBuilderRouter(env(p.isolated), async url => {
        if (String(url).endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen2.5-coder:3b" }] });
        return Response.json({ model: "qwen2.5-coder:3b", done: true, [key]: "remote-reference",
          response: JSON.stringify({ path: file, content: "must not write" }) });
      });
      const result = await router.execute(request(p.head), []);
      assert.equal(result.ok, false);
      assert.equal(result.blocker, "local_model_remote_reference_rejected");
      assert.equal(run(p.isolated, "status", "--porcelain", "-uall"), "");
    } finally { p.clean(); }
  });
}
