import assert from "node:assert/strict";
import test from "node:test";
import type { GoalRecord } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { cognitiveDigest } from "../src/gai/cognitive-state.ts";
import { validateCognitiveGoalRefinement, prepareCognitiveGoalRefinement, findCognitiveGoalRefinementReplay } from "../src/orchestrator/cognitive-goal-refinement.ts";

const record = (): GoalRecord => ({ id: 1, title: "Local report", description: "Create the requested report", successCriteria: [], constraints: ["LOCAL_ONLY", "Do not modify the source"], createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z" });
const request = (current = record()) => ({ goalId: goalWorkStateId(compassGoalToLoopGoal(current)), goalDigest: cognitiveDigest(compassGoalToLoopGoal(current)), successCriteria: ["The report contains the requested total"], acknowledgement: true as const });
const adopted = (current: GoalRecord, criteria: string[]): GoalRecord => ({ ...current, successCriteria: [...criteria], updatedAt: "2026-09-24T00:01:00.000Z" });

test("explicit criteria form a ready proposal preserving the exact active Goal identity and constraints", () => {
 const current = record(), input = request(current), before = structuredClone(current);
 const proposal = prepareCognitiveGoalRefinement(current, input);
 assert.deepEqual(current, before);
 assert.deepEqual(proposal.goal, { ...compassGoalToLoopGoal(current), successCriteria: input.successCriteria });
 assert.equal(goalWorkStateId(proposal.goal), input.goalId);
 assert.equal(proposal.receipt.sourceGoalDigest, input.goalDigest);
 assert.equal(proposal.receipt.targetGoalDigest, cognitiveDigest(proposal.goal));
 assert.equal(proposal.receipt.requestDigest, proposal.requestDigest);
 assert.deepEqual(proposal.receipt.transition, ["PROPOSED", "ADOPTED"]);
 assert.equal(JSON.stringify(proposal.receipt).includes(input.successCriteria[0]), false);
});

test("intake accepts only explicitly acknowledged bounded nonduplicate criteria", () => {
 const input = request();
 for (const bad of [null, [], {}, { ...input, acknowledgement: false }, { ...input, acknowledgement: "true" }, { ...input, goalId: "other" }, { ...input, goalDigest: "a" }, { ...input, successCriteria: [] }, { ...input, successCriteria: [" "] }, { ...input, successCriteria: [4] }, { ...input, successCriteria: ["a", " a "] }, { ...input, successCriteria: ["x".repeat(501)] }, { ...input, successCriteria: Array.from({ length: 17 }, (_, i) => `criterion ${i}`) }]) assert.throws(() => validateCognitiveGoalRefinement(bad));
 assert.equal(validateCognitiveGoalRefinement({ ...input, successCriteria: ["x".repeat(500)] }).successCriteria[0].length, 500);
 assert.equal(validateCognitiveGoalRefinement({ ...input, successCriteria: Array.from({ length: 16 }, (_, i) => `criterion ${i}`) }).successCriteria.length, 16);
});

test("request cannot inject Goal identity, scope, paths, permissions or verification authority", () => {
 for (const field of ["title", "description", "constraints", "permissions", "root", "path", "verified", "approvalRequired", "receipt", "requestDigest", "confidence"]) assert.throws(() => validateCognitiveGoalRefinement({ ...request(), [field]: "forged" }), /fields/);
});

test("sensitive criteria are rejected before a persistent receipt or Goal is produced", () => {
 for (const secret of ["password=do-not-persist", "api_key=private-value", "Bearer abcdefghijklmnop", ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "), "send to owner@example.com"]) {
  assert.throws(() => prepareCognitiveGoalRefinement(record(), { ...request(), successCriteria: [secret] }));
 }
});

test("normalization is detached from caller arrays and receipt values are immutable", () => {
 const input = { ...request(), successCriteria: ["  Exact outcome  "] };
 const validated = validateCognitiveGoalRefinement(input);
 assert.deepEqual(validated.successCriteria, ["Exact outcome"]);
 const proposal = prepareCognitiveGoalRefinement(record(), input);
 input.successCriteria[0] = "changed after validation";
 assert.deepEqual(proposal.goal.successCriteria, ["Exact outcome"]);
 assert.equal(Object.isFrozen(proposal.receipt), true);
 assert.equal(Object.isFrozen(proposal.receipt.transition), true);
 assert.equal(proposal.requestDigest, prepareCognitiveGoalRefinement(record(), { ...request(), successCriteria: ["Exact outcome"] }).requestDigest);
});

test("stale full Goal digest rejects changes even when its stable Goal ID is unchanged", () => {
 const current = record(), input = request(current);
 const changed = { ...current, constraints: [...current.constraints, "New owner restriction"] };
 assert.equal(goalWorkStateId(compassGoalToLoopGoal(changed)), input.goalId);
 assert.throws(() => prepareCognitiveGoalRefinement(changed, input), /changed|stale/i);
 assert.throws(() => prepareCognitiveGoalRefinement(current, { ...input, goalId: "goal-0000000000000000" }), /changed|stale/i);
});

test("existing criteria are never replaced, even with an identical new proposal", () => {
 const current = adopted(record(), request().successCriteria);
 assert.throws(() => prepareCognitiveGoalRefinement(current, request(current)), /criteria|pristine/i);
 assert.throws(() => prepareCognitiveGoalRefinement(current, { ...request(current), successCriteria: ["different"] }), /criteria|pristine/i);
});

test("exact durable retry returns the prior receipt only for the exact adopted full Goal", () => {
 const current = record(), input = request(current), proposal = prepareCognitiveGoalRefinement(current, input);
 const updated = adopted(current, proposal.goal.successCriteria);
 const decisions = [{ kind: "unrelated", value: "retained" }, proposal.receipt];
 assert.deepEqual(findCognitiveGoalRefinementReplay(updated, decisions, input), proposal.receipt);
 assert.equal(findCognitiveGoalRefinementReplay(current, [], input), null);
 assert.equal(findCognitiveGoalRefinementReplay(current, decisions, input), null, "proposed data alone grants no authority before atomic adoption");
 assert.equal(findCognitiveGoalRefinementReplay(updated, decisions, { ...input, successCriteria: ["different"] }), null);
 assert.equal(findCognitiveGoalRefinementReplay(updated, decisions, { ...input, goalDigest: cognitiveDigest(compassGoalToLoopGoal(updated)) }), null);
});

test("replay cannot ignore later title, description, constraints or criteria drift", () => {
 const current = record(), input = request(), proposal = prepareCognitiveGoalRefinement(current, input), updated = adopted(current, proposal.goal.successCriteria);
 for (const changed of [{ ...updated, title: "other" }, { ...updated, description: "other" }, { ...updated, constraints: ["new restriction"] }, { ...updated, successCriteria: ["other"] }]) assert.equal(findCognitiveGoalRefinementReplay(changed, [proposal.receipt], input), null);
});

test("forged, contradictory and duplicate receipts cannot acknowledge a retry", () => {
 const current = record(), input = request(), proposal = prepareCognitiveGoalRefinement(current, input), updated = adopted(current, proposal.goal.successCriteria);
 for (const receipt of [{ ...proposal.receipt, verified: true }, { ...proposal.receipt, transition: ["ADOPTED"] }, { ...proposal.receipt, criteriaDigest: "f".repeat(64) }, { ...proposal.receipt, sourceGoalDigest: "f".repeat(64) }, { ...proposal.receipt, targetGoalDigest: "f".repeat(64) }, { ...proposal.receipt, requestDigest: "f".repeat(64) }]) assert.equal(findCognitiveGoalRefinementReplay(updated, [receipt], input), null);
 assert.throws(() => findCognitiveGoalRefinementReplay(updated, [proposal.receipt, proposal.receipt], input), /duplicate|ambiguous/i);
});

test("malformed authoritative records fail closed instead of silently filtering constraints", () => {
 for (const current of [{ ...record(), constraints: ["keep", { permission: "all" }] }, { ...record(), successCriteria: [null] }, { ...record(), title: "" }]) assert.throws(() => prepareCognitiveGoalRefinement(current, request()));
});

test("proposal construction preserves whitespace in authoritative identity and constraints", () => {
 const current = { ...record(), title: " Local report ", description: " Keep exact description ", constraints: [" constraint text "] };
 const proposal = prepareCognitiveGoalRefinement(current, request(current));
 assert.equal(proposal.goal.title, current.title);
 assert.equal(proposal.goal.description, current.description);
 assert.deepEqual(proposal.goal.constraints, current.constraints);
 assert.equal(goalWorkStateId(proposal.goal), goalWorkStateId(compassGoalToLoopGoal(current)));
});
