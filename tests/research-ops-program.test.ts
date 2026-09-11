import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_STAGES,
  assessResearchProgram,
  assessResearchStage,
  evaluateAgiClaimGate,
  nextExecutableResearchStages,
  type ResearchEvidence,
  type ResearchStageId,
} from "../src/gai/research-ops-program.ts";

const evidence = (
  stage: ResearchStageId,
  kind: ResearchEvidence["kind"],
  verified = true,
): ResearchEvidence => ({
  id: `${stage}-${kind}`,
  stage,
  kind,
  verified,
  source: "test-fixture",
  collectedAt: "2026-09-11T00:00:00.000Z",
});

const completeR1Evidence = (): ResearchEvidence[] => [
  evidence("R1", "internal-baseline"),
  evidence("R1", "heldout-evaluation"),
  evidence("R1", "failure-taxonomy"),
  evidence("R1", "agi-gap-review"),
  evidence("R1", "safety-regression"),
  evidence("R1", "cost-regression"),
];

test("defines exactly R1 through R20 in order", () => {
  assert.equal(RESEARCH_STAGES.length, 20);
  assert.deepEqual(RESEARCH_STAGES.map((item) => item.id), Array.from({ length: 20 }, (_, index) => `R${index + 1}`));
});

test("R1 is ready without dependencies but cannot complete without all verified evidence", () => {
  const empty = assessResearchStage("R1", new Set(), []);
  assert.equal(empty.status, "ready");
  assert.ok(empty.missingEvidence.includes("internal-baseline"));
  assert.ok(empty.missingEvidence.includes("failure-taxonomy"));
  assert.ok(empty.missingEvidence.includes("agi-gap-review"));

  const complete = assessResearchStage("R1", new Set(), completeR1Evidence());
  assert.equal(complete.status, "complete");
});

test("unverified evidence never satisfies a gate", () => {
  const result = assessResearchStage("R1", new Set(), [
    ...completeR1Evidence().filter((item) => item.kind !== "internal-baseline"),
    evidence("R1", "internal-baseline", false),
  ]);
  assert.equal(result.status, "ready");
  assert.ok(result.missingEvidence.includes("internal-baseline"));
});

test("dependencies block later stages even when their local evidence exists", () => {
  const result = assessResearchStage("R20", new Set(), [
    evidence("R20", "agi-gap-review"),
    evidence("R20", "independent-replication"),
    evidence("R20", "safety-regression"),
    evidence("R20", "cost-regression"),
    evidence("R20", "reproducibility"),
  ]);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingDependencies, ["R19"]);
});

test("program exposes currently executable stages instead of pretending later stages are done", () => {
  assert.deepEqual(nextExecutableResearchStages([]), ["R1"]);
  const assessments = assessResearchProgram([]);
  assert.equal(assessments.find((item) => item.stage === "R20")?.status, "blocked");
});

test("AGI claim remains disallowed until R20 and independent validation both pass", () => {
  const blocked = evaluateAgiClaimGate({
    assessments: assessResearchProgram([]),
    independentExternalValidation: false,
    unresolvedSafetyRegression: false,
    additionalPaygApiCost: 0,
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.length >= 2);

  const fakeCompleteAssessments = RESEARCH_STAGES.map((item) => ({
    stage: item.id,
    status: "complete" as const,
    missingDependencies: [],
    missingEvidence: [],
    verifiedEvidenceIds: [],
  }));
  const allowed = evaluateAgiClaimGate({
    assessments: fakeCompleteAssessments,
    independentExternalValidation: true,
    unresolvedSafetyRegression: false,
    additionalPaygApiCost: 0,
  });
  assert.equal(allowed.allowed, true);
});
