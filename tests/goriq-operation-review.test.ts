import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CognitiveCore, cognitiveActionFingerprint, createCognitiveGoalLoop, type CognitiveCandidate, type CognitiveExperience, type CognitiveLearningBridge } from "../src/gai/cognitive-core.ts";
import { CognitiveStateStore, type CognitiveState } from "../src/gai/cognitive-state.ts";
import { OllamaPrimaryBrainAdapter } from "../src/gai/primary-brain.ts";
import type { StateStore, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";

const partition = { tenantId: "operation-review", principalId: "owner" };
const goal = { title: "Preserve current authorized text", successCriteria: ["Current result matches source"], constraints: ["Local only"] };
const operation = "material:v1:copy:text" as const;
const emptyRecall = () => ({ memories: [], strategies: [], corrections: [], avoidActionIds: [] });
const candidate = (withOperation = true): CognitiveCandidate => ({ id: "exact-current-action", kind: "experiment", ...(withOperation ? { learningOperation: operation } : {}), action: { id: "exact-current-action", capability: "current-host-copy", description: "Copy current source", risk: "low", irreversible: false, externalSideEffect: false, input: { source: "current.txt", output: "current-result.txt" } }, expectedOutcome: "Current result matches source", evidenceRequired: ["current-exact-verifier"] });
const sink = (): StateStore & { records: WriteBackRecord[] } => ({ records: [], async getState() { return { completed: [], blockers: [] }; }, async writeBack(record) { this.records.push(record); } });
const result = { actionId: "exact-current-action", ok: true, summary: "Current persisted output verified" };
const verification = { ok: true, summary: "Current exact bytes match", evidence: { refs: ["current-exact-verifier"] } };
const propose = (core: CognitiveCore) => core.proposeNextAction({ goal, context: [], intent: { summary: goal.title, confidence: 1, evidence: [] } });

async function fixture(run: (root: string, state: CognitiveStateStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "goriq-operation-review-"));
  try { await run(root, new CognitiveStateStore(root, partition)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function pending(state: CognitiveStateStore, learningOperation?: typeof operation) {
  const initial = await state.initialize("goal", goal);
  const action = { ...candidate().action, completesBoundedCommand: false };
  const value = { actionId: candidate().id, fingerprint: cognitiveActionFingerprint(action), startedAt: new Date().toISOString(), ...(learningOperation ? { learningOperation } : {}) };
  return state.save({ ...initial, pending_action: value }, initial.revision);
}

test("operation provenance is persisted before a crashing execution can lose its selection", async () => fixture(async (_root, state) => {
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", candidates: async () => [candidate()] });
  const action = await propose(core); assert.ok(action);
  await assert.rejects(core.decorateExecutor({ async execute() { throw Error("injected crash after effect"); } }).execute(action, []), /injected crash/);
  const saved = await state.get("goal"); assert.ok(saved?.pending_action);
  assert.equal((saved.pending_action as { learningOperation?: string }).learningOperation, operation);
  assert.equal(saved.attempts.length, 0);
}));

test("recovery rejects changed operation provenance before authority write-back", async () => fixture(async (_root, state) => {
  const before = await pending(state, operation);
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", candidates: async () => [] });
  const authority = sink(); core.decorateStore(authority);
  await assert.rejects(core.reconcileVerifiedAction({ ...candidate(), learningOperation: "material:v1:create:docx" }, goal, result, verification), /operation|contract/i);
  assert.equal(authority.records.length, 0);
  assert.deepEqual(await state.get("goal"), before);
}));

test("legacy pending exact action reconciles without inferring new operation metadata", async () => fixture(async (_root, state) => {
  await pending(state);
  const experiences: CognitiveExperience[] = [];
  const learning: CognitiveLearningBridge = { async recall() { return emptyRecall(); }, async observe(value) { experiences.push(value); } };
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", learning, candidates: async () => [candidate()] });
  const authority = sink(); core.decorateStore(authority);
  await core.reconcileVerifiedAction(candidate(), goal, result, verification);
  assert.equal(authority.records.length, 1);
  const saved = await state.get("goal"); assert.equal(saved?.pending_action, null); assert.equal(saved?.attempts.length, 1);
  assert.equal(saved?.attempts[0].learningOperation, undefined);
  assert.equal(experiences.length, 1); assert.equal(experiences[0].learningOperation, undefined);
}));

test("model-supplied operation cannot attach learning authority to an unannotated host action", async () => fixture(async (_root, state) => {
  const experiences: CognitiveExperience[] = [];
  const learning: CognitiveLearningBridge = { async recall() { return emptyRecall(); }, async observe(value) { experiences.push(value); } };
  const brain = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "test-fixture", fetchImpl: async () => new Response(JSON.stringify({ response: JSON.stringify({ candidateId: candidate().id, assessment: "Use current candidate", hypotheses: [], expectedOutcome: "Output preserved", confidence: 0.8, learningOperation: operation, operation, catalogOperation: operation }) })) });
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", brain, learning, candidates: async () => [candidate(false)] });
  const loop = createCognitiveGoalLoop({ core, contextSources: [], executor: { async execute() { return result; } }, verifier: { async verify() { return verification; } }, stateStore: sink() });
  await loop.runCycle({ goal });
  assert.equal(experiences.length, 1); assert.equal(experiences[0].source, "local-model");
  assert.equal(experiences[0].learningOperation, undefined);
  assert.equal((await state.get("goal"))?.attempts[0].learningOperation, undefined);
}));

test("outbox retry preserves operation and mismatched attempt metadata cannot be persisted", async () => fixture(async (root, state) => {
  const failing: CognitiveLearningBridge = { async recall() { return emptyRecall(); }, async observe() { throw Error("learning unavailable"); } };
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", learning: failing, candidates: async () => [candidate()] });
  const loop = createCognitiveGoalLoop({ core, contextSources: [], executor: { async execute() { return result; } }, verifier: { async verify() { return verification; } }, stateStore: sink() });
  await loop.runCycle({ goal });
  const saved = await state.get("goal"); assert.ok(saved?.learning_outbox);
  assert.equal(saved.learning_outbox.learningOperation, operation);
  assert.equal(saved.attempts[0].learningOperation, operation);
  await assert.rejects(state.save({ ...saved, learning_outbox: { ...saved.learning_outbox, learningOperation: "material:v1:create:docx" } }, saved.revision), /outbox/);
  const experiences: CognitiveExperience[] = [];
  const resumed = new CognitiveCore({ goalId: "goal", partition, state: new CognitiveStateStore(root, partition), environment: "local", learning: { async recall() { return emptyRecall(); }, async observe(value) { experiences.push(value); } }, candidates: async () => [candidate()] });
  const selected = await propose(resumed);
  assert.equal(selected?.id, "cognitive:inspect");
  assert.equal(experiences.length, 1); assert.equal(experiences[0].id, saved.learning_outbox.id);
  assert.equal(experiences[0].learningOperation, operation);
  assert.equal((await state.get("goal"))?.learning_outbox, null);
}));

test("eligible explicit correction wins over a broader certified operation family", async () => fixture(async (_root, state) => {
  const other = { ...candidate(), id: "unrelated-current-copy", action: { ...candidate().action, id: "unrelated-current-copy" } };
  const learning: CognitiveLearningBridge = {
    async observe() {},
    async recall() { return { ...emptyRecall(), corrections: [{ originalActionId: "known-wrong", replacementActionId: candidate().id, evidenceRefs: ["verified-replacement"] }], skills: [{ id: "portable-copy", actionId: "historical-copy", operation, environment: "local", confidence: 0.95, evidenceRefs: ["independent-certification"], maxRisk: "low" }] }; },
  };
  const core = new CognitiveCore({ goalId: "goal", partition, state, environment: "local", learning, candidates: async () => [other, candidate()] });
  const selected = await propose(core);
  assert.equal(selected?.id, candidate().id);
  assert.deepEqual(selected?.input, candidate().action.input);
}));

test("unknown pending operation revision rejects without modifying existing checkpoint", async () => fixture(async (_root, state) => {
  const before = await pending(state);
  const unknown = { ...before.pending_action!, learningOperation: "material:v2:copy:text" as NonNullable<CognitiveState["pending_action"]>["learningOperation"] };
  await assert.rejects(state.save({ ...before, pending_action: unknown }, before.revision), /operation/i);
  assert.deepEqual(await state.get("goal"), before);
}));

test("portable certification cannot bypass current host risk or Skill eligibility", async () => fixture(async (root) => {
  const rejected: CognitiveCandidate[] = [
    { ...candidate(), action: { ...candidate().action, risk: "high" } },
    { ...candidate(), action: { ...candidate().action, irreversible: true } },
    { ...candidate(), action: { ...candidate().action, externalSideEffect: true } },
    { ...candidate(), requiresExternalAI: true },
    { ...candidate(), kind: "skill", verifiedSkill: false },
  ];
  for (const [index, unsafe] of rejected.entries()) {
    const allowed = { ...candidate(), id: "allowed-current", action: { ...candidate().action, id: "allowed-current" } };
    const learning: CognitiveLearningBridge = {
      async observe() {},
      async recall() { return { ...emptyRecall(), skills: [{ id: "certified", actionId: "prior", operation, environment: "local", confidence: 0.9, evidenceRefs: ["independent"], maxRisk: "high" }] }; },
    };
    const core = new CognitiveCore({ goalId: `risk-${index}`, partition, state: new CognitiveStateStore(join(root, String(index)), partition), environment: "local", learning, candidates: async () => [unsafe, allowed] });
    assert.equal((await propose(core))?.id, allowed.id);
  }
}));
