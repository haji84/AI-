import assert from "node:assert/strict";
import test from "node:test";
import { assembleCapabilityTeam } from "../src/orchestrator/dynamic-capability-team.ts";

const baseGoal = {
  title: "調査して報告書を作る",
  description: "最新情報を調べて、検証したうえで報告書にまとめる",
  successCriteria: ["根拠付きの報告書が完成している"],
  constraints: ["未確認情報を断定しない"],
};

const capabilities = [
  {
    name: "research.web",
    roles: ["researcher"],
    matchTerms: ["調べ", "最新情報", "research"],
  },
  {
    name: "document.write",
    roles: ["writer"],
    matchTerms: ["報告書", "document"],
  },
  {
    name: "verification.check",
    roles: ["verifier"],
    alwaysInclude: true,
  },
];

test("simple goal activates only relevant capabilities plus core verification", () => {
  const plan = assembleCapabilityTeam({
    goal: {
      title: "報告書を作る",
      description: "報告書を作成する",
      successCriteria: ["文書が完成している"],
      constraints: [],
    },
    availableCapabilities: capabilities,
  });

  assert.equal(plan.blocked, false);
  assert.deepEqual(
    plan.assignments.map((assignment) => assignment.capability),
    ["document.write", "verification.check"],
  );
});

test("compound goal dynamically assembles multiple roles without duplicate assignments", () => {
  const plan = assembleCapabilityTeam({
    goal: baseGoal,
    availableCapabilities: capabilities,
    requirements: [
      {
        role: "researcher",
        capability: "research.web",
        required: true,
        reason: "fresh evidence is required",
      },
      {
        role: "researcher",
        capability: "research.web",
        required: true,
        reason: "duplicate planner requirement must not duplicate the team",
      },
    ],
  });

  assert.equal(plan.blocked, false);
  assert.deepEqual(
    plan.assignments.map(({ role, capability }) => ({ role, capability })),
    [
      { role: "writer", capability: "document.write" },
      { role: "researcher", capability: "research.web" },
      { role: "verifier", capability: "verification.check" },
    ],
  );
});

test("required unavailable capability blocks instead of being invented", () => {
  const plan = assembleCapabilityTeam({
    goal: baseGoal,
    availableCapabilities: capabilities,
    requirements: [
      {
        role: "spreadsheet-editor",
        capability: "spreadsheet.edit",
        required: true,
        reason: "deliverable requires workbook mutation",
      },
    ],
  });

  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.missingRequiredCapabilities, [
    {
      role: "spreadsheet-editor",
      capability: "spreadsheet.edit",
      required: true,
      reason: "deliverable requires workbook mutation",
    },
  ]);
  assert.equal(plan.assignments.some((assignment) => assignment.capability === "spreadsheet.edit"), false);
});
