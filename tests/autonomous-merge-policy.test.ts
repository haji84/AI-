import test from "node:test";
import assert from "node:assert/strict";
import { decideAutonomousMerge } from "../src/orchestrator/autonomous-merge-policy.ts";

const base = {
  risk: "LOW" as const,
  requiredChecks: [
    { name: "project-checks", status: "success" as const },
    { name: "repository-guard", status: "success" as const },
  ],
  humanGateRequired: false,
  securityGatePassed: true,
  branchUpToDate: true,
  unresolvedReviewThreads: 0,
  mergeable: true,
};

test("low-risk fully verified PR merges autonomously", () => {
  assert.equal(decideAutonomousMerge(base).action, "MERGE_NOW");
});

test("GitHub expected/pending required checks use auto-merge instead of human escalation", () => {
  const input = { ...base, requiredChecks: [{ name: "project-checks", status: "expected" as const }, { name: "repository-guard", status: "success" as const }] };
  assert.equal(decideAutonomousMerge(input).action, "ENABLE_AUTO_MERGE");
});

test("high-risk PR still requires Human Gate", () => {
  assert.equal(decideAutonomousMerge({ ...base, risk: "HIGH" }).action, "HUMAN_GATE");
});

test("failed security gate cannot auto-merge", () => {
  assert.equal(decideAutonomousMerge({ ...base, securityGatePassed: false }).action, "BLOCK");
});
