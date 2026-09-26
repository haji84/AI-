import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";

test("development verifier fails closed without a verification contract", async () => {
  const verifier = createRuntimeDevelopmentVerifier({});
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: { id: "a", description: "build", capability: "code.builder", risk: "low" },
    result: { actionId: "a", ok: true, summary: "built" },
    context: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.summary, /contract is missing/);
});

test("development verifier returns exact expected/actual evidence from Builder", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    ok: false,
    summary: "file_exact verification failed",
    evidence: { kind: "file_exact", path: "tests/x.txt", expected: "beta", actual: "alpha" },
  }), { status: 200 });
  const verifier = createRuntimeDevelopmentVerifier({
    CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
    CODE_BUILDER_LOCAL_TOKEN: "token",
  }, fetchImpl);
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: {
      id: "a",
      description: "build",
      capability: "code.builder",
      risk: "low",
      input: { verificationContract: { kind: "file_exact", path: "tests/x.txt", expected: "beta" } },
    },
    result: { actionId: "a", ok: true, summary: "built" },
    context: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.summary, /expected="beta" actual="alpha"/);
});

test("development verifier rejects Builder-issued or stale release evidence", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    ok: true,
    summary: "verified",
    evidence: {
      verifierId: "builder:zbook",
      sourceRevision: "c".repeat(40),
      artifactDigest: "b".repeat(64),
    },
  }), { status: 200 });
  const verifier = createRuntimeDevelopmentVerifier({
    CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
    CODE_BUILDER_LOCAL_TOKEN: "token",
  }, fetchImpl);
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: {
      id: "a",
      description: "build",
      capability: "code.builder",
      risk: "low",
      input: {
        verificationContract: { kind: "file_exact", path: "tests/x.txt", expected: "beta" },
        releaseBinding: {
          builderId: "builder:zbook",
          sourceRevision: "a".repeat(40),
          artifactDigest: "b".repeat(64),
        },
      },
    },
    result: { actionId: "a", ok: true, summary: "built" },
    context: [],
  });
  assert.equal(result.ok, false);
  assert.equal((result.evidence as { blocker?: string }).blocker, "development_verification_evidence_invalid");
});
