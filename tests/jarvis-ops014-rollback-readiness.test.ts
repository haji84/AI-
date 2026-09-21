import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { planProductRollback, type ProductRollbackCandidate } from "../src/jarvis/product-rollback-readiness.ts";

function candidate(overrides: Partial<ProductRollbackCandidate> = {}): ProductRollbackCandidate {
  return {
    component: "broker", deployedVersion: "v2", rollbackFromVersion: "v2", targetVersion: "v1",
    artifactSha256: "b".repeat(64), artifactEvidence: ["artifact:verified"], knownGoodEvidence: ["known-good:v1"],
    compatibilityEvidence: ["compatibility:v1"], rollbackTestEvidence: ["rollback-test:pass"], securityEvidence: ["security:pass"],
    verificationEvidence: ["post-rollback-verifier:defined"], dependsOn: [], physicalEvidenceRequired: false, physicalEvidence: [], ...overrides,
  };
}

test("OPS-014 produces a non-mutating rollback plan only after required evidence", () => {
  const plan = planProductRollback([candidate()]);
  assert.equal(plan.state, "ready-for-human-gate");
  assert.equal(plan.applyAuthorized, false);
  assert.deepEqual(plan.executionOrder, ["broker"]);
  assert.deepEqual(plan.assessments[0]?.reasons, ["separate_human_gate_required_before_mutation"]);
});

test("OPS-014 binds rollback to exact source and known-good target", () => {
  const mismatch = planProductRollback([candidate({ rollbackFromVersion: "v3" })]);
  assert.equal(mismatch.state, "blocked");
  assert.ok(mismatch.assessments[0]?.reasons.includes("source_version_mismatch"));
  const noKnownGood = planProductRollback([candidate({ knownGoodEvidence: [] })]);
  assert.equal(noKnownGood.state, "blocked");
  assert.ok(noKnownGood.assessments[0]?.reasons.includes("known_good_evidence_required"));
});

test("OPS-014 fails closed on evidence gaps", () => {
  const plan = planProductRollback([candidate({ artifactSha256: "bad", artifactEvidence: [], compatibilityEvidence: [], rollbackTestEvidence: [], securityEvidence: [], verificationEvidence: [] })]);
  assert.equal(plan.state, "blocked");
  for (const reason of ["verified_rollback_artifact_digest_required", "artifact_evidence_required", "compatibility_evidence_required", "rollback_test_evidence_required", "security_evidence_required", "post_rollback_verification_evidence_required"]) {
    assert.ok(plan.assessments[0]?.reasons.includes(reason));
  }
});

test("OPS-014 orders dependents before dependencies and rejects invalid graphs", () => {
  const ordered = planProductRollback([candidate({ component: "dashboard", dependsOn: ["broker"] }), candidate({ component: "broker" })]);
  assert.deepEqual(ordered.executionOrder, ["dashboard", "broker"]);
  const missing = planProductRollback([candidate({ dependsOn: ["database"] })]);
  assert.equal(missing.state, "blocked");
  assert.ok(missing.assessments[0]?.reasons.includes("missing_dependency:database"));
  const cycle = planProductRollback([candidate({ component: "dashboard", dependsOn: ["broker"] }), candidate({ component: "broker", dependsOn: ["dashboard"] })]);
  assert.equal(cycle.state, "blocked");
  assert.equal(cycle.assessments.every((entry) => entry.reasons.includes("dependency_cycle")), true);
});

test("OPS-014 rejects duplicate metadata", () => {
  const duplicate = planProductRollback([candidate(), candidate({ targetVersion: "v0" })]);
  assert.equal(duplicate.state, "blocked");
  assert.equal(duplicate.assessments.every((entry) => entry.reasons.includes("duplicate_component")), true);
  const deps = planProductRollback([candidate({ component: "dashboard", dependsOn: ["broker", "broker"] }), candidate({ component: "broker" })]);
  assert.equal(deps.state, "blocked");
  assert.ok(deps.assessments[0]?.reasons.includes("duplicate_dependency"));
});

test("OPS-014 never substitutes software evidence for physical evidence", () => {
  const waiting = planProductRollback([candidate({ component: "android-worker", physicalEvidenceRequired: true, physicalEvidence: [] })]);
  assert.equal(waiting.state, "awaiting-physical");
  assert.equal(waiting.applyAuthorized, false);
  const evidenced = planProductRollback([candidate({ component: "android-worker", physicalEvidenceRequired: true, physicalEvidence: ["physical:evidence-reference"] })]);
  assert.equal(evidenced.state, "ready-for-human-gate");
});

test("OPS-014 treats an already-restored target as not needing rollback", () => {
  const plan = planProductRollback([candidate({ deployedVersion: "v1", rollbackFromVersion: "v2", targetVersion: "v1", artifactSha256: "", artifactEvidence: [], knownGoodEvidence: [], compatibilityEvidence: [], rollbackTestEvidence: [], securityEvidence: [], verificationEvidence: [] })]);
  assert.equal(plan.state, "not-needed");
  assert.equal(plan.applyAuthorized, false);
});

test("OPS-014 module contains no mutation executor", async () => {
  const source = await readFile(new URL("../src/jarvis/product-rollback-readiness.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /child_process|execFile|spawn|fetch\(|PackageInstaller|\.install\(|rmSync|unlink|rename\(/);
  assert.match(source, /applyAuthorized:\s*false/);
});
