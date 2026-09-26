import assert from "node:assert/strict";
import test from "node:test";

import { runSelfDevelopmentAcceptance } from "../scripts/goriq-self-development-acceptance.mjs";

test("deterministic acceptance covers online, local-only, offline, conflict, restart, and rollback modes", async () => {
  const result = await runSelfDevelopmentAcceptance({
    mode: "deterministic",
    sourceRevision: "a".repeat(40),
    recordedAt: "2026-09-26T12:00:00.000Z",
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.mode, "deterministic");
  assert.equal(result.sourceRevision, "a".repeat(40));
  assert.deepEqual(result.scenarios.map((scenario: { id: string; status: string }) => [scenario.id, scenario.status]), [
    ["online-external-assisted", "PASS"],
    ["online-local-only", "PASS"],
    ["offline-ready-to-publish", "PASS"],
    ["reconnect-semantic-integration", "PASS"],
    ["restart-canary-rollback", "PASS"],
  ]);
  assert.equal(result.deviceTopology.iphoneCount, 1);
  assert.equal(result.deviceTopology.secondIphoneRejected, true);
  assert.equal(result.secretScan.passed, true);
  assert.equal(result.evidenceClasses.deterministicSimulation, "PASS");
  assert.equal(result.evidenceClasses.realLocalModel, "NOT_RUN");
  assert.equal(result.evidenceClasses.realGitHub, "NOT_RUN");
  assert.equal(result.evidenceClasses.physicalIphone, "NOT_RUN");
  for (const scenario of result.scenarios) {
    assert.match(scenario.artifactDigest, /^[a-f0-9]{64}$/);
    assert.ok(scenario.checks.length > 0);
  }
});

test("simulated iPhone evidence is never labeled physical", async () => {
  const result = await runSelfDevelopmentAcceptance({
    mode: "deterministic",
    sourceRevision: "b".repeat(40),
    recordedAt: "2026-09-26T12:00:00.000Z",
  });
  assert.ok(result.scenarios.every((scenario: { environment: string }) => scenario.environment === "deterministic-simulation"));
  assert.equal(result.deviceTopology.physicalEvidence, null);
});
