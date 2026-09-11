import assert from "node:assert/strict";
import test from "node:test";
import { planResearchCampaign, summarizeResearchProgram } from "../src/gai/research-campaign-orchestrator.ts";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

const evidence = (kind: ResearchEvidence["kind"]): ResearchEvidence => ({
  id: `R1-${kind}`,
  stage: "R1",
  kind,
  verified: true,
  source: "test",
  collectedAt: "2026-09-11T00:00:00.000Z",
});

const r1Complete = [
  evidence("internal-baseline"),
  evidence("heldout-evaluation"),
  evidence("failure-taxonomy"),
  evidence("agi-gap-review"),
  evidence("safety-regression"),
  evidence("cost-regression"),
];

test("empty program queues R1 as automatic local-model work", () => {
  const plan = planResearchCampaign([]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].stage, "R1");
  assert.equal(plan[0].mode, "local-model");
  assert.equal(plan[0].runnableAutomatically, true);
});

test("after R1, local and external branches separate cleanly", () => {
  const snapshot = summarizeResearchProgram(r1Complete);
  assert.ok(snapshot.completed.includes("R1"));
  assert.ok(snapshot.automaticQueue.some((item) => item.stage === "R2"));
  assert.ok(snapshot.automaticQueue.some((item) => item.stage === "R4"));
  assert.ok(snapshot.automaticQueue.some((item) => item.stage === "R6"));
  assert.ok(snapshot.externalQueue.some((item) => item.stage === "R3"));
  assert.equal(snapshot.externalQueue.find((item) => item.stage === "R3")?.runnableAutomatically, false);
});
