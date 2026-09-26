import assert from "node:assert/strict";
import test from "node:test";
import {
  developmentStrategyFingerprint,
  normalizeDevelopmentBuilderResult,
} from "../src/orchestrator/development-builder.ts";
import { BuilderRouter, type BuilderCapability, type BuilderRequest } from "../src/orchestrator/builder-router.ts";

function request(overrides: Partial<BuilderRequest> = {}): BuilderRequest {
  return {
    goalId: "goal-681",
    attemptId: "attempt-1",
    strategyId: "strategy-1",
    objective: "change src/example.ts safely",
    files: ["src/example.ts"],
    context: [],
    baseRevision: "a".repeat(40),
    ...overrides,
  };
}

test("normalized Builder result is a bounded Change Set without release authority", () => {
  const result = normalizeDevelopmentBuilderResult(request(), {
    ok: true,
    summary: "implemented",
    changedPaths: ["src/example.ts"],
    patchDigest: "b".repeat(64),
  }, { builderId: "local", kind: "local" });
  assert.equal(result.ok, true);
  assert.equal(result.changeSet?.builderKind, "local");
  assert.deepEqual(result.changeSet?.changedPaths, ["src/example.ts"]);
  assert.equal(result.changeSet?.releaseAuthority, false);
});

test("Builder output cannot request commit, push, merge, deploy, credential, or permission authority", () => {
  for (const authority of ["commit", "push", "merge", "deploy", "credential", "permission"] as const) {
    assert.throws(() => normalizeDevelopmentBuilderResult(request(), {
      ok: true,
      summary: "attempted escalation",
      changedPaths: ["src/example.ts"],
      patchDigest: "c".repeat(64),
      requestedAuthority: [authority],
    }, { builderId: "untrusted", kind: "external" }), /authority/i);
  }
});

test("Builder result rejects paths outside declared scope", () => {
  assert.throws(() => normalizeDevelopmentBuilderResult(request(), {
    ok: true,
    summary: "scope escape",
    changedPaths: [".github/workflows/unsafe.yml"],
    patchDigest: "d".repeat(64),
  }, { builderId: "builder", kind: "local" }), /declared scope/i);
});

test("local-only routing excludes external Builders", async () => {
  const calls: string[] = [];
  const builder = (id: string, kind: "local" | "external"): BuilderCapability => ({
    id,
    kind,
    async available() { return true; },
    async build(input) {
      calls.push(`${id}:${input.attemptId}`);
      return { actionId: input.attemptId, ok: true, summary: id };
    },
  });
  const router = new BuilderRouter([builder("external", "external"), builder("local", "local")]);
  const result = await router.execute({
    id: "action",
    description: "change",
    capability: "code.builder",
    risk: "low",
    input: request({ localOnly: true }),
  }, []);
  assert.equal(result.ok, true);
  assert.equal(result.summary, "local");
  assert.deepEqual(calls, ["local:attempt-1"]);
});

test("unavailable external Builder falls back to local with the same attempt identity", async () => {
  const attempts: string[] = [];
  const external: BuilderCapability = {
    id: "external",
    kind: "external",
    async available() { return true; },
    async build(input) {
      attempts.push(`external:${input.attemptId}`);
      return { actionId: input.attemptId, ok: false, summary: "offline", blocker: "http_code_builder_unreachable" };
    },
  };
  const local: BuilderCapability = {
    id: "local",
    kind: "local",
    async available() { return true; },
    async build(input) {
      attempts.push(`local:${input.attemptId}`);
      return { actionId: input.attemptId, ok: true, summary: "local complete" };
    },
  };
  const result = await new BuilderRouter([external, local]).execute({
    id: "action",
    description: "change",
    capability: "code.builder",
    risk: "low",
    input: request(),
  }, []);
  assert.equal(result.ok, true);
  assert.deepEqual(attempts, ["external:attempt-1", "local:attempt-1"]);
});

test("materially equivalent failed strategy is rejected before Builder execution", async () => {
  const value = request({ hypothesis: "change parser branch" });
  const fingerprint = developmentStrategyFingerprint(value);
  let called = false;
  const builder: BuilderCapability = {
    id: "local",
    kind: "local",
    async available() { return true; },
    async build(input) {
      called = true;
      return { actionId: input.attemptId, ok: true, summary: "unexpected" };
    },
  };
  const result = await new BuilderRouter([builder]).execute({
    id: "action",
    description: "change",
    capability: "code.builder",
    risk: "low",
    input: { ...value, previousStrategyFingerprints: [fingerprint] },
  }, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, "equivalent_failed_strategy");
  assert.equal(called, false);
});

