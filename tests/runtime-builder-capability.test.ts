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
