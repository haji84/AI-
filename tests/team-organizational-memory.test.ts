import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityTeamPlan } from "../src/orchestrator/dynamic-capability-team.ts";
import {
  createTeamBlueprint,
  deriveTeamBlueprint,
  rankTeamBlueprints,
  recordTeamOutcome,
  TeamMemory,
} from "../src/orchestrator/team-organizational-memory.ts";

const goal = { title: "CSVを集計して報告書を作る", successCriteria: ["集計", "報告書"], constraints: [] };
const team: CapabilityTeamPlan = {
  goalTitle: goal.title,
  assignments: [
    { role: "分析", capability: "data.analyze", reason: "集計", source: "requirement" },
    { role: "文書", capability: "document.write", reason: "報告書", source: "requirement" },
  ],
  missingRequiredCapabilities: [],
  blocked: false,
};

test("completed team can be stored and recalled for a similar goal", () => {
  const memory = new TeamMemory();
  let blueprint = createTeamBlueprint({ id: "team-1", name: "集計報告チーム", goal, team });
  blueprint = recordTeamOutcome(blueprint, { ok: true, verified: true, score: 0.95 });
  memory.save(blueprint);
  const recalled = memory.recall(
    { title: "CSVを集計して報告書を作る", successCriteria: ["集計"], constraints: [] },
    ["data.analyze", "document.write"],
  );
  assert.equal(recalled?.id, "team-1");
  assert.equal(recalled?.lifecycle, "reusable");
});

test("blueprint with unavailable capability is not recalled", () => {
  const memory = new TeamMemory();
  const blueprint = recordTeamOutcome(
    createTeamBlueprint({ id: "team-1", name: "集計報告チーム", goal, team }),
    { ok: true, verified: true },
  );
  memory.save(blueprint);
  assert.equal(memory.recall(goal, ["data.analyze"]), null);
});

test("repeated verified success promotes team to standing candidate", () => {
  let blueprint = createTeamBlueprint({ id: "team-1", name: "集計報告チーム", goal, team });
  for (let i = 0; i < 3; i += 1) blueprint = recordTeamOutcome(blueprint, { ok: true, verified: true, score: 1 });
  assert.equal(blueprint.lifecycle, "standing_candidate");
});

test("repeated failure demotes a team and prevents recall", () => {
  let blueprint = createTeamBlueprint({ id: "bad", name: "失敗チーム", goal, team });
  for (let i = 0; i < 3; i += 1) blueprint = recordTeamOutcome(blueprint, { ok: false, verified: false });
  assert.equal(blueprint.lifecycle, "demoted");
  const ranked = rankTeamBlueprints({ goal, blueprints: [blueprint], availableCapabilities: ["data.analyze", "document.write"] });
  assert.equal(ranked[0]?.recallable, false);
});

test("derived team preserves parent but resets its own performance", () => {
  let parent = createTeamBlueprint({ id: "parent", name: "元チーム", goal, team });
  parent = recordTeamOutcome(parent, { ok: true, verified: true });
  const derived = deriveTeamBlueprint({
    parent,
    id: "child",
    name: "監査追加チーム",
    goal: { title: "CSVを集計して監査付き報告書を作る", successCriteria: ["監査"], constraints: [] },
    replaceAssignments: [...parent.assignments, { role: "監査", capability: "verify.audit", reason: "品質改善", source: "requirement" }],
  });
  assert.equal(parent.assignments.length, 2);
  assert.equal(derived.assignments.length, 3);
  assert.equal(derived.parentId, "parent");
  assert.equal(derived.generation, 2);
  assert.equal(derived.uses, 0);
  assert.equal(derived.lifecycle, "experimental");
});

test("ranking is deterministic when candidates tie", () => {
  const a = createTeamBlueprint({ id: "a", name: "A", goal, team });
  const b = createTeamBlueprint({ id: "b", name: "B", goal, team });
  const ranked = rankTeamBlueprints({ goal, blueprints: [b, a], availableCapabilities: ["data.analyze", "document.write"] });
  assert.deepEqual(ranked.map((candidate) => candidate.blueprint.id), ["a", "b"]);
});

test("blocked team cannot be promoted into organizational memory", () => {
  assert.throws(() => createTeamBlueprint({
    id: "blocked",
    name: "blocked",
    goal,
    team: { ...team, blocked: true },
  }), /blocked team/);
});