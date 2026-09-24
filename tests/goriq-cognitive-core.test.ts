import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { CognitiveCore, cognitiveActionFingerprint, createCognitiveGoalLoop, type CognitiveCandidate } from "../src/gai/cognitive-core.ts";
import { OllamaPrimaryBrainAdapter } from "../src/gai/primary-brain.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import type { StateStore, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";

const partition = { tenantId: "test", principalId: "owner" };
const goal = { title: "Find a working local transform", successCriteria: ["The output is 42"], constraints: ["No external AI"] };
const candidate = (id: string, kind: CognitiveCandidate["kind"] = "experiment"): CognitiveCandidate => ({ id, kind, action: { id, capability: id, description: id, risk: "low" }, expectedOutcome: "The output is 42", evidenceRequired: ["output-verifier"] });
const stateStore = (): StateStore & { records: WriteBackRecord[] } => ({ records: [], async getState() { return { completed: [], blockers: [] }; }, async writeBack(record) { this.records.push(record); } });

test("unknown local task learns failure and selects a different real registered experiment", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-core-"));
  try {
    const store = new CognitiveStateStore(root, partition);
    const registry = new CapabilityRegistry().register({ name: "double", async execute(a) { return { actionId: a.id, ok: true, summary: "20", evidence: { value: 20 } }; } }).register({ name: "add", async execute(a) { return { actionId: a.id, ok: true, summary: String(20 + 22), evidence: { value: 20 + 22 } }; } });
    const core = new CognitiveCore({ goalId: "g1", partition, state: store, environment: "local-test", candidates: async () => [candidate("double"), candidate("add")], completion: async (s) => s.attempts.some(a => a.verified && a.actionId === "add") });
    const sink = stateStore();
    const loop = createCognitiveGoalLoop({ core, contextSources: [], executor: registry, verifier: { async verify({ result }) { return { ok: (result.evidence as { value: number }).value === 42, summary: "independent exact output", evidence: { refs: ["output-verifier"] } }; } }, stateStore: sink });
    assert.equal((await loop.runCycle({ goal })).verification?.ok, false);
    assert.equal((await loop.runCycle({ goal })).verification?.ok, true);
    assert.equal((await loop.runCycle({ goal })).stopReason, "goal_complete");
    const restored = await new CognitiveStateStore(root, partition).get("g1");
    assert.equal(restored?.attempts.length, 2);
    assert.equal(restored?.attempts[0].actionId, "double");
    assert.equal(restored?.attempts[1].actionId, "add");
    assert.equal(restored?.external_ai_calls, 0);
    assert.equal(restored?.prediction_error, 0.5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unavailable model degrades without null completion; host gate cannot be weakened by model", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-gate-"));
  try {
    const store = new CognitiveStateStore(root, partition);
    let calls = 0;
    const high = candidate("sensitive"); high.action.risk = "high";
    const core = new CognitiveCore({ goalId: "g", partition, state: store, environment: "local", candidates: async () => [high] });
    const loop = createCognitiveGoalLoop({ core, contextSources: [], executor: { async execute(a) { calls++; return { actionId: a.id, ok: true, summary: "bad" }; } }, verifier: { async verify() { return { ok: true, summary: "bad" }; } }, stateStore: stateStore() });
    assert.equal((await loop.runCycle({ goal })).stopReason, "approval_required");
    assert.equal(calls, 0);
    assert.equal((await store.get("g"))?.mode, "DEGRADED");
    const empty = new CognitiveCore({ goalId: "empty", partition, state: store, environment: "local", candidates: async () => [] });
    const action = await empty.proposeNextAction({ goal, context: [], intent: { summary: "test", confidence: 0.5, evidence: [] } });
    assert.notEqual(action, null);
    assert.equal(action?.capability, "context.inspect");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("durable state prevents stale overwrite and partition leakage", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-state-"));
  try {
    const a = new CognitiveStateStore(root, partition);
    const state = await a.initialize("g", goal);
    const b = new CognitiveStateStore(root, partition);
    const stale = await b.get("g");
    await a.save({ ...state, current_hypothesis: "first" }, state.revision);
    await assert.rejects(b.save({ ...stale!, current_hypothesis: "stale" }, stale!.revision), /revision conflict/);
    assert.equal(await new CognitiveStateStore(root, { ...partition, principalId: "tester" }).get("g"), null);
    await assert.rejects(a.save({ ...(await a.get("g"))!, known_facts: ["password=private-value"] }, 1), /sensitive/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Ollama adapter is bounded local-only and untrusted output cannot invent actions", async () => {
  assert.throws(() => new OllamaPrimaryBrainAdapter({ endpoint: "https://example.com", model: "configured" }), /loopback/);
  const adapter = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "configured", fetchImpl: async () => new Response(JSON.stringify({ response: JSON.stringify({ candidateId: "invented", assessment: "propose", hypotheses: [], expectedOutcome: "42", confidence: 0.9 }) })) });
  await assert.rejects(adapter.plan({ goal, candidates: [{ id: "known", description: "known", risk: "low" }], memories: [], world: [], previousAttempts: [], environment: "test", connectivity: "offline", budget: { remainingActions: 1 }, currentState: "", constraints: [] }), /candidate/);
});

test("Core sends verified failures and successful Goal completion to partitioned learning", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-learning-bridge-"));
  try {
    const learning = new CognitiveLearningEngine(join(root, "learning"));
    const store = new CognitiveStateStore(join(root, "state"), partition);
    const core = new CognitiveCore({ goalId: "learning-goal", partition, state: store, environment: "local-test", learning,
      candidates: async () => [candidate("wrong"), candidate("correct")],
      completion: async s => s.attempts.some(a => a.actionId === "correct" && a.verified),
    });
    const loop = createCognitiveGoalLoop({ core, contextSources: [], stateStore: stateStore(), executor: { async execute(action) { return { actionId: action.id, ok: true, summary: action.id === "correct" ? "42" : "wrong" }; } }, verifier: { async verify({ result }) { return { ok: result.summary === "42", summary: `Observed ${result.summary}`, evidence: { refs: ["independent-output-check"] } }; } } });
    await loop.runCycle({ goal }); await loop.runCycle({ goal }); await loop.runCycle({ goal });
    const recall = await learning.recall({ partition, goalId: "next", task: goal.title, environment: "local-test" });
    assert.ok(recall.avoidActionIds.includes("wrong"));
    assert.ok(recall.strategies.some(s => s.actionId === "correct"));
    const state = await store.get("learning-goal");
    assert.equal(state?.attempts[0].verified, false);
    assert.equal(state?.attempts[1].verified, true);
    const metrics = await learning.metrics(partition);
    assert.equal(metrics.externalAiFreeCompletionRate, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("crash after action starts prevents effect replay after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-crash-"));
  try {
    const store = new CognitiveStateStore(root, partition);
    let effects = 0;
    const options = { goalId: "crash", partition, state: store, environment: "test", candidates: async () => [candidate("effect")] };
    const first = createCognitiveGoalLoop({ core: new CognitiveCore(options), contextSources: [], stateStore: stateStore(), executor: { async execute() { effects++; throw new Error("process crashed after effect"); } }, verifier: { async verify() { return { ok: true, summary: "unused" }; } } });
    await assert.rejects(first.runCycle({ goal }), /process crashed/);
    const recovered = new CognitiveCore({ ...options, state: new CognitiveStateStore(root, partition) });
    const proposal = await recovered.proposeNextAction({ goal, context: [], intent: { summary: "resume", confidence: 0.5, evidence: [] } });
    assert.equal(proposal?.capability, "context.inspect");
    assert.equal(effects, 1);
    assert.equal((await store.get("crash"))?.pending_action?.actionId, "effect");
    assert.ok((await store.get("crash"))?.blockers.includes("action_outcome_unknown_reconciliation_required"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("external expert capabilities require explicit opt-in and online connectivity", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-expert-"));
  try {
    const store = new CognitiveStateStore(root, partition);
    let calls = 0;
    const c = { ...candidate("expert-action"), requiresExternalAI: true };
    const expert = { id: "already-authorized-expert", async eligible() { return true; }, async suggest() { calls++; return { candidateId: c.id, assessment: "proposal", hypotheses: [], expectedOutcome: "42", confidence: 0.5, requiredEvidence: [], recoveryOptions: [], escalation: "none" as const }; } };
    const input = { goal, context: [], intent: { summary: "test", confidence: 0.5, evidence: [] } };
    const base = { partition, state: store, environment: "test", candidates: async () => [c], expert };
    const offline = new CognitiveCore({ ...base, goalId: "offline", allowExternal: true, connectivity: "offline" });
    assert.equal((await offline.proposeNextAction(input))?.capability, "context.inspect");
    const disabled = new CognitiveCore({ ...base, goalId: "disabled", connectivity: "online" });
    assert.equal((await disabled.proposeNextAction(input))?.capability, "context.inspect");
    assert.equal(calls, 0);
    const enabled = new CognitiveCore({ ...base, goalId: "enabled", allowExternal: true, connectivity: "online" });
    assert.equal((await enabled.proposeNextAction(input))?.capability, "expert-action");
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("pending reconciliation rejects changed Goal before any authority write", async () => {
  const root = await mkdtemp(join(tmpdir(), "goriq-goal-drift-"));
  try {
    const state = new CognitiveStateStore(root, partition);
    const previous = await state.initialize("g", goal), action = candidate("persisted-result");
    await state.save({ ...previous, pending_action: { actionId: action.id, fingerprint: cognitiveActionFingerprint({ ...action.action, completesBoundedCommand: false }), startedAt: new Date().toISOString() } }, previous.revision);
    const core = new CognitiveCore({ goalId: "g", partition, state, environment: "test", candidates: async () => [action] });
    const authority = stateStore(); core.decorateStore(authority);
    await assert.rejects(core.reconcileVerifiedAction(action, { ...goal, successCriteria: ["Different output"] }, { actionId: action.id, ok: true, summary: "old artifact" }, { ok: true, summary: "old evidence", evidence: { refs: ["independent-artifact"] } }), /goal contract changed/);
    assert.equal(authority.records.length, 0, "rejected recovery must not mutate Goal authority");
    assert.ok((await state.get("g"))?.pending_action);
  } finally { await rm(root, { recursive: true, force: true }); }
});
