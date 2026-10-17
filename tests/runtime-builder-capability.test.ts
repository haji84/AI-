import test from "node:test";
import assert from "node:assert/strict";
import { createCodeBuilderCapability, createRuntimeBuilderRouter } from "../src/orchestrator/runtime-builder-capability.ts";

test("runtime Builder accepts explicit loopback endpoint and executes through registry handler", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, capabilities: ["code-builder"], engine: "llama.cpp", inference: { locality: "device", networkAccess: false } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, summary: "runtime build complete", evidence: { engine: "codex" } }), { status: 200 });
  };
  const router = createRuntimeBuilderRouter({
    CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
    CODE_BUILDER_LOCAL_TOKEN: "token",
  }, fetchImpl);
  const capability = createCodeBuilderCapability(router);
  const result = await capability.execute({
    id: "runtime-build",
    description: "change fixture",
    capability: "code.builder",
    risk: "low",
    input: {
      goalId: "g",
      attemptId: "a1",
      strategyId: "s1",
      objective: "change fixture",
      files: ["tests/fixture.txt"],
    },
  }, []);
  assert.equal(result.ok, true);
  assert.equal(result.summary, "runtime build complete");
});

test("runtime Builder rejects non-loopback local endpoint", () => {
  assert.throws(() => createRuntimeBuilderRouter({
    CODE_BUILDER_LOCAL_URL: "http://192.168.0.169:8796",
    CODE_BUILDER_LOCAL_TOKEN: "token",
  }), /loopback HTTP only/);
});

test("runtime Builder fails closed when local configuration is incomplete", () => {
  assert.throws(() => createRuntimeBuilderRouter({
    CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
  }), /must be configured together/);
});

test("owner-approved plan Codex routes through exact isolated loopback workspace", async () => {
  const calls: string[] = [];
  const env = {
    CODE_BUILDER_PLAN_CODEX_APPROVED: "1",
    CODE_BUILDER_PLAN_CODEX_URL: "http://127.0.0.1:8797",
    CODE_BUILDER_PLAN_CODEX_TOKEN: "owner-scoped-test-token",
    CODE_BUILDER_PLAN_CODEX_WORKSPACE: "C:\\isolated\\goal-one",
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer owner-scoped-test-token");
    if (String(input).endsWith("/health")) {
      return new Response(JSON.stringify({
        ok: true, service: "code-builder-worker", engine: "codex",
        capabilities: ["code-builder", "filesystem"], workspace: "C:\\isolated\\goal-one",
        inference: { locality: "unknown", networkAccess: true },
      }), { status: 200 });
    }
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({
      ok: true, summary: "bounded edit", changedPaths: ["docs/evidence/goal.txt"],
      patchDigest: "a".repeat(64), artifactDigest: "b".repeat(64),
      candidateRevision: "c".repeat(64), artifactRef: `sha256:${"b".repeat(64)}`,
      requestedAuthority: [],
    }), { status: 200 });
  };
  const action = {
    id: "plan-codex-one", description: "write fixture", capability: "code.builder" as const,
    risk: "low" as const,
    input: {
      goalId: "g", attemptId: "a", strategyId: "s", objective: "write fixture",
      baseRevision: "d".repeat(40), files: ["docs/evidence/goal.txt"],
    },
  };
  const capability = createCodeBuilderCapability(createRuntimeBuilderRouter(env, fetchImpl));
  const result = await capability.execute(action, []);
  assert.equal(result.ok, true);
  assert.equal((result.evidence as { changeSet: { builderKind: string } }).changeSet.builderKind, "external");
  assert.deepEqual(calls, ["http://127.0.0.1:8797/health", "http://127.0.0.1:8797/build"]);

  const localOnly = createCodeBuilderCapability(createRuntimeBuilderRouter(env, fetchImpl));
  const rejected = await localOnly.execute({ ...action, input: { ...action.input, localOnly: true } }, []);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.blocker, "real_builder_capability_unavailable");
  assert.equal(calls.length, 2, "local-only route must not call remote-reasoning engine");
});

test("plan Codex requires explicit complete opt-in, never auto-enables with available token", () => {
  const base = {
    CODE_BUILDER_PLAN_CODEX_URL: "http://127.0.0.1:8797",
    CODE_BUILDER_PLAN_CODEX_TOKEN: "token",
    CODE_BUILDER_PLAN_CODEX_WORKSPACE: "C:\\isolated\\goal-one",
  };
  assert.throws(() => createRuntimeBuilderRouter(base), /explicit owner approval/);
  assert.throws(() => createRuntimeBuilderRouter({ ...base, CODE_BUILDER_PLAN_CODEX_APPROVED: "false" }), /explicit owner approval/);
  assert.throws(() => createRuntimeBuilderRouter({ ...base, CODE_BUILDER_PLAN_CODEX_APPROVED: "1", CODE_BUILDER_PLAN_CODEX_TOKEN: "" }), /explicit owner approval/);
});

test("plan Codex rejects non-loopback or ambiguous control URLs", () => {
  const base = {
    CODE_BUILDER_PLAN_CODEX_APPROVED: "1",
    CODE_BUILDER_PLAN_CODEX_TOKEN: "token",
    CODE_BUILDER_PLAN_CODEX_WORKSPACE: "C:\\isolated\\goal-one",
  };
  for (const url of [
    "https://127.0.0.1:8797", "http://localhost:8797",
    "http://192.168.1.10:8797", "http://127.0.0.1:8797/health",
    "http://127.0.0.1:8797/?a=1", "http://user:password@127.0.0.1:8797",
  ]) {
    assert.throws(() => createRuntimeBuilderRouter({ ...base, CODE_BUILDER_PLAN_CODEX_URL: url }), /exact loopback HTTP/);
  }
});

test("plan Codex will not route when live engine, identity or workspace differs", async () => {
  const env = {
    CODE_BUILDER_PLAN_CODEX_APPROVED: "1",
    CODE_BUILDER_PLAN_CODEX_URL: "http://127.0.0.1:8797",
    CODE_BUILDER_PLAN_CODEX_TOKEN: "token",
    CODE_BUILDER_PLAN_CODEX_WORKSPACE: "C:\\isolated\\goal-one",
  };
  for (const health of [
    { ok: true, service: "other", engine: "codex", capabilities: ["code-builder"], workspace: "C:\\isolated\\goal-one" },
    { ok: true, service: "code-builder-worker", engine: "aider", capabilities: ["code-builder"], workspace: "C:\\isolated\\goal-one" },
    { ok: true, service: "code-builder-worker", engine: "codex", capabilities: ["code-builder"], workspace: "C:\\other" },
    { ok: true, service: "code-builder-worker", engine: "codex", capabilities: ["filesystem"], workspace: "C:\\isolated\\goal-one" },
  ]) {
    let posts = 0;
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).endsWith("/build")) posts++;
      return new Response(JSON.stringify(health), { status: 200 });
    };
    const router = createCodeBuilderCapability(createRuntimeBuilderRouter(env, fetchImpl));
    const result = await router.execute({
      id: "a", description: "change fixture", capability: "code.builder", risk: "low",
      input: { goalId: "g", attemptId: "a", strategyId: "s", objective: "change fixture" },
    }, []);
    assert.equal(result.ok, false);
    assert.equal(posts, 0, "unverified Builder must not receive source");
  }
});
