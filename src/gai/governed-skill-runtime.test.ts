import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GovernedSkillRuntime, evaluateSkillEligibility, type GovernedSkillRecord } from "./governed-skill-runtime.ts";
import { PersistentSkillLibrary } from "./skill-library.ts";

const base: GovernedSkillRecord = {
  id: "s1", name: "local research", description: "research locally", procedure: "inspect and verify", provenance: ["verified-run"], applicability: ["research"], confidence: 0.9, successes: 3, failures: 0, status: "active", updatedAt: new Date().toISOString(), constraints: { capabilities: ["local-model"], connectivity: "offline-capable" }, executionRequirements: { platforms: ["windows", "macos"], tools: ["filesystem"], verifierIds: ["artifact-verifier"] },
};

test("eligible only when capability platform tool verifier and gate requirements hold", () => {
  assert.equal(evaluateSkillEligibility(base, { capabilities: ["local-model"], online: false, platform: "windows", tools: ["filesystem"], verifierIds: ["artifact-verifier"] }).eligible, true);
  const rejected = evaluateSkillEligibility(base, { capabilities: [], online: false, platform: "ios", tools: [], verifierIds: [], humanGateRequired: true, humanGateApproved: false });
  assert.equal(rejected.eligible, false);
  assert.deepEqual(rejected.reasons, ["capability:local-model", "human-gate:approval-required", "platform:ios", "tool:filesystem", "verifier:artifact-verifier"]);
});

test("unresolved regression evidence blocks reuse", () => {
  assert.deepEqual(evaluateSkillEligibility({ ...base, executionRequirements: { regressionEvidence: ["held-out regression"] } }, {}).reasons, ["regression:unresolved"]);
});

test("verified candidate requires certification before governed selection and regression quarantines it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gai-skills-"));
  const library = new PersistentSkillLibrary(join(dir, "skills.json"));
  await library.createCandidate({ id: "s1", name: "local research", description: "research locally", procedure: "inspect and verify", applicability: ["research"], evidence: ["verifier-pass"], verificationPassed: true, success: true, confidence: 0.9, source: "task-1", constraints: { capabilities: ["local-model"], connectivity: "offline-capable" } });
  const runtime = new GovernedSkillRuntime(library);
  assert.equal((await runtime.select("local research", { capabilities: ["local-model"], online: false })).length, 0);
  await library.certify("s1", ["held-out-pass"]);
  assert.equal((await runtime.select("local research", { capabilities: ["local-model"], online: false })).length, 1);
  await runtime.recordRegression("s1", "held-out-failed");
  assert.equal((await library.get("s1"))?.status, "quarantined");
  assert.equal((await runtime.select("local research", { capabilities: ["local-model"], online: false })).length, 0);
});
