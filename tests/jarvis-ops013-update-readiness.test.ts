import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  planProductUpdate,
  type ProductUpdateCandidate,
} from "../src/jarvis/product-update-readiness.ts";

function candidate(overrides: Partial<ProductUpdateCandidate> = {}): ProductUpdateCandidate {
  return {
    component: "broker",
    currentVersion: "v1",
    candidateVersion: "v2",
    rollbackVersion: "v1",
    artifactSha256: "a".repeat(64),
    artifactEvidence: ["artifact:verified"],
    compatibilityEvidence: ["compatibility:verified"],
    testEvidence: ["tests:pass"],
    securityEvidence: ["security:pass"],
    rollbackEvidence: ["rollback-plan:verified"],
    physicalEvidenceRequired: false,
    physicalEvidence: [],
    ...overrides,
  };
}

test("OPS-013 produces readiness only after artifact, compatibility, test, security, and rollback evidence", () => {
  const plan = planProductUpdate([candidate()]);

  assert.equal(plan.state, "ready-for-human-gate");
  assert.equal(plan.applyAuthorized, false);
  assert.deepEqual(plan.assessments[0]?.reasons, ["separate_human_gate_required_before_mutation"]);
});

test("OPS-013 never lets CI-style software evidence stand in for required physical evidence", () => {
  const waiting = planProductUpdate([candidate({
    component: "android-worker",
    physicalEvidenceRequired: true,
    physicalEvidence: [],
  })]);

  assert.equal(waiting.state, "awaiting-physical");
  assert.equal(waiting.applyAuthorized, false);
  assert.deepEqual(waiting.assessments[0]?.reasons, ["physical_evidence_required"]);

  const evidenced = planProductUpdate([candidate({
    component: "android-worker",
    physicalEvidenceRequired: true,
    physicalEvidence: ["physical:evidence-reference"],
  })]);
  assert.equal(evidenced.state, "ready-for-human-gate");
  assert.equal(evidenced.applyAuthorized, false);
});

test("OPS-013 fails closed on incomplete provenance, compatibility, rollback, or duplicate component metadata", () => {
  const incomplete = planProductUpdate([candidate({
    artifactSha256: "not-a-sha256",
    compatibilityEvidence: [],
    rollbackEvidence: [],
  })]);
  assert.equal(incomplete.state, "blocked");
  assert.deepEqual(incomplete.assessments[0]?.reasons, [
    "verified_artifact_digest_required",
    "compatibility_evidence_required",
    "rollback_evidence_required",
  ]);

  const duplicate = planProductUpdate([candidate(), candidate({ candidateVersion: "v3" })]);
  assert.equal(duplicate.state, "blocked");
  assert.equal(duplicate.assessments.every((entry) => entry.reasons.includes("duplicate_component")), true);
});

test("OPS-013 treats identical current/candidate versions as no update and does not invent an apply action", () => {
  const plan = planProductUpdate([candidate({
    currentVersion: "v1",
    candidateVersion: "v1",
    rollbackVersion: "",
    artifactSha256: "",
    artifactEvidence: [],
    compatibilityEvidence: [],
    testEvidence: [],
    securityEvidence: [],
    rollbackEvidence: [],
  })]);

  assert.equal(plan.state, "up-to-date");
  assert.equal(plan.applyAuthorized, false);
});

test("OPS-013 preserves the existing Android update transport safety contract without changing a device version", async () => {
  const source = await readFile(new URL("../android/jarvis-worker/app/src/main/java/ai/jarvis/worker/UpdateManager.kt", import.meta.url), "utf8");

  assert.match(source, /require\(brokerUrl\.startsWith\("https:\/\/"\)\)/);
  assert.match(source, /require\(archive\.packageName == context\.packageName\)/);
  assert.match(source, /archiveVersion <= currentVersionCode\(\)/);
  assert.match(source, /require\(signingDigest\(archive\) == signingDigestCurrent\(\)\)/);
  assert.match(source, /if \(!isDeviceOwner\(\)\) return false/);
});

test("OPS-013 preserves governed device-E2E, canary, and rollback ordering for self-improvement updates", async () => {
  const source = await readFile(new URL("../src/gai/self-improvement-runtime.ts", import.meta.url), "utf8");
  const deviceIndex = source.indexOf("this.adapters.deviceE2E(candidate)");
  const canaryIndex = source.indexOf("this.adapters.canary(candidate)");
  const promoteIndex = source.indexOf("this.adapters.promote(candidate)");

  assert.ok(deviceIndex >= 0);
  assert.ok(canaryIndex > deviceIndex);
  assert.ok(promoteIndex > canaryIndex);
  assert.match(source, /if \(!canary\.ok\)[\s\S]*this\.adapters\.rollback\(candidate\)/);
  assert.match(source, /if \(!promotion\.ok\)[\s\S]*this\.adapters\.rollback\(candidate\)/);
});

test("OPS-013 readiness module has no mutation executor", async () => {
  const source = await readFile(new URL("../src/jarvis/product-update-readiness.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /child_process|execFile|spawn|fetch\(|PackageInstaller|\.install\(/);
  assert.match(source, /applyAuthorized:\s*false/);
});
