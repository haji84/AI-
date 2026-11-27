import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeDevelopmentVerifier } from "../src/orchestrator/runtime-development-verifier.ts";

async function verifyFailedCandidate(options: { wrongDigest?: boolean; missingCheck?: boolean; invalidStatus?: boolean; noFailedCheck?: boolean; unboundFailure?: boolean; duplicateCheck?: boolean } = {}) {
  const checks = ["lint", "typecheck"];
  const evidence = {
    verifierId: "verifier:independent",
    sourceRevision: "a".repeat(64),
    artifactDigest: options.wrongDigest ? "c".repeat(64) : "b".repeat(64),
    verificationEvidence: checks.filter((_, index) => !options.missingCheck || index === 0).map((check, index) => ({
      check, verifierId: "verifier:independent", sourceRevision: "a".repeat(64), artifactDigest: "b".repeat(64),
      status: options.invalidStatus ? "skipped" : index === 0 && !options.noFailedCheck ? "failed" : "passed",
      recordedAt: new Date().toISOString(),
    })),
  };
  if (options.unboundFailure) evidence.verificationEvidence.push({ ...evidence.verificationEvidence[0], artifactDigest: "c".repeat(64), status: "failed" });
  if (options.duplicateCheck) evidence.verificationEvidence.push({ ...evidence.verificationEvidence[0] });
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ ok: false, summary: "candidate failed deterministic verification", evidence }), { status: 200 });
  const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796", CODE_BUILDER_LOCAL_TOKEN: "fixture-only" }, fetchImpl);
  return verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: { id: "failed-candidate", description: "verify candidate", capability: "code.builder", risk: "low", input: {
      verificationContract: { kind: "repository_checks", profile: "standard", requiredChecks: checks },
      candidate: { artifactRef: "sha256:" + "b".repeat(64), changedPaths: ["src/repair.ts"] },
      releaseBinding: { builderId: "builder:separate", sourceRevision: "a".repeat(64), artifactDigest: "b".repeat(64) },
    } },
    result: { actionId: "failed-candidate", ok: true, summary: "built" }, context: [],
  });
}

test("complete independent candidate-bound FAIL evidence remains available to recovery", async () => {
  const result = await verifyFailedCandidate();
  assert.equal(result.ok, false);
  const evidence = result.evidence as { verificationEvidence: Array<{ status: string }>; blocker?: string };
  assert.equal(evidence.blocker, undefined);
  assert.deepEqual(evidence.verificationEvidence.map(item => item.status), ["failed", "passed"]);
});

for (const [name, options] of [
  ["wrong candidate digest", { wrongDigest: true }],
  ["incomplete check set", { missingCheck: true }],
  ["unexecuted check status", { invalidStatus: true }],
  ["no failed check in a claimed failure", { noFailedCheck: true }],
  ["an extra unbound failed row beside passing checks", { noFailedCheck: true, unboundFailure: true }],
  ["duplicate check rows", { duplicateCheck: true }],
] as const) {
  test(`failed candidate verification rejects ${name} before exposing recovery evidence`, async () => {
    const result = await verifyFailedCandidate(options);
    assert.equal(result.ok, false);
    const evidence = result.evidence as { blocker?: string; verificationEvidence?: unknown };
    assert.equal(evidence.blocker, "development_verification_evidence_invalid");
    assert.equal(evidence.verificationEvidence, undefined);
  });
}

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

test("development verifier sends an addressable candidate and accepts per-check bound evidence", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const checks = ["lint", "typecheck"] as const;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      summary: "verified exact candidate",
      evidence: {
        verifierId: "verifier:mac",
        sourceRevision: "a".repeat(64),
        artifactDigest: "b".repeat(64),
        verificationEvidence: checks.map((check) => ({ check, verifierId: "verifier:mac", sourceRevision: "a".repeat(64), artifactDigest: "b".repeat(64), status: "passed", recordedAt: "2026-09-26T12:00:00.000Z" })),
      },
    }), { status: 200 });
  };
  const verifier = createRuntimeDevelopmentVerifier({ CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796", CODE_BUILDER_LOCAL_TOKEN: "token" }, fetchImpl);
  const result = await verifier.verify({
    goal: { title: "g", successCriteria: [], constraints: [] },
    action: { id: "a", description: "verify", capability: "code.builder", risk: "low", input: {
      verificationContract: { kind: "repository_checks", profile: "standard", requiredChecks: checks },
      candidate: { artifactRef: "sha256:b", changedPaths: ["src/a.ts"] },
      releaseBinding: { builderId: "builder:zbook", sourceRevision: "a".repeat(64), artifactDigest: "b".repeat(64) },
    } },
    result: { actionId: "a", ok: true, summary: "built" }, context: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual((requestBody?.candidate as { changedPaths: string[] }).changedPaths, ["src/a.ts"]);
  assert.equal((requestBody?.binding as { sourceRevision: string }).sourceRevision, "a".repeat(64));
  assert.equal(((result.evidence as { verificationEvidence: unknown[] }).verificationEvidence).length, 2);
});

test("Codex-free Ollama runtime never treats 8796 Builder verification as independent", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw Error("Original Builder/paid capability must never be called");
  };
  const verifier = createRuntimeDevelopmentVerifier({
    GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1",
    CODE_BUILDER_LOCAL_URL: "http://127.0.0.1:8796",
    CODE_BUILDER_LOCAL_TOKEN: "existing-builder-token-must-not-be-used",
  }, fetchImpl);
  const response = await verifier.verify({
    goal: { title: "local-test", successCriteria: [], constraints: [] },
    action: {
      id: "test-local-verifier",
      description: "verify a generated file",
      capability: "code.builder",
      risk: "low",
      input: {
        verificationContract: { kind: "repository_checks", profile: "standard", requiredChecks: ["lint"] },
        candidate: { changedPaths: ["tests/fixtures/local-goal.py"], artifactRef: "sha256:" + "a".repeat(64) },
        releaseBinding: { builderId: "local-ollama-builder", sourceRevision: "b".repeat(64), artifactDigest: "a".repeat(64) },
      },
    },
    result: { actionId: "test-local-verifier", ok: true, summary: "Builder wrote file" },
    context: [],
  });
  assert.equal(response.ok, false);
  assert.equal((response.evidence as { blocker: string }).blocker, "independent_local_ollama_verifier_required");
  assert.equal(networkCalls, 0);
});
