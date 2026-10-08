import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { evaluateBuilderTestContractEvolution } from "../src/orchestrator/test-contract-evolution.ts";

const evidence = {
  failureKind: "assertion_mismatch" as const,
  canonicalRequirementChanged: true,
  implementationVerificationPassed: true,
  verifierId: "independent-verifier",
  sourceRevision: "a".repeat(40),
  artifactDigest: "b".repeat(64),
};

test("existing test edits require independent verified contract-evolution evidence", () => {
  assert.equal(evaluateBuilderTestContractEvolution({
    builderId: "local-code-builder",
    proposedTestPatch: "- assert.match(old)\n+ assert.match(new)",
  }).allowed, false);
  assert.equal(evaluateBuilderTestContractEvolution({
    builderId: "local-code-builder",
    proposedTestPatch: "- assert.match(old)\n+ assert.match(new)",
    evidence: { ...evidence, verifierId: "local-code-builder" },
  }).allowed, false);
  assert.equal(evaluateBuilderTestContractEvolution({
    builderId: "local-code-builder",
    proposedTestPatch: "- assert.match(old)\n+ assert.match(new)",
    evidence,
  }).allowed, true);
});

test("live code Builder strips unverified edits to existing tests before snapshot", async () => {
  const source = await readFile(new URL("../scripts/code-builder-worker-service.ts", import.meta.url), "utf8");
  assert.equal(source.includes("evaluateBuilderTestContractEvolution"), true);
  assert.equal(source.includes("--diff-filter=M"), true);
  assert.equal(source.includes("git restore"), true);
  assert.equal(source.includes("TEST_CONTRACT_EVOLUTION_STRIPPED"), true);
});
