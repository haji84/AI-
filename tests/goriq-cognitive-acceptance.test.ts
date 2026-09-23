import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CognitiveCore, createCognitiveGoalLoop, type CognitiveCandidate, type CognitiveLearningBridge } from "../src/gai/cognitive-core.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { PersistentWorldModel } from "../src/gai/world-model.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { CapabilityRegistry } from "../src/orchestrator/capabilities.ts";
import type { StateStore, WriteBackRecord } from "../src/orchestrator/goal-loop.ts";
import type { ExternalExpertProvider, PrimaryBrainAdapter } from "../src/gai/primary-brain.ts";
import type { ImprovementCandidate, ImprovementStageResult } from "../src/gai/self-improvement-runtime.ts";

const partition = { tenantId: "acceptance", principalId: "owner" };
const environment = "synthetic-local-records";
const input = [" 18 ", "6", "19", " 4 "];
const title = "Sort numeric records in increasing order";
const transform = (values: string[], numeric: boolean) => numeric ? values.map(Number).sort((a, b) => a - b) : values.map(Number).sort();
// Independent verifier checks conservation and order, not equality to the tool's algorithm.
function verifyOrder(values: string[], output: unknown): boolean {
  if (!Array.isArray(output) || output.length !== values.length || !output.every(x => typeof x === "number" && Number.isFinite(x))) return false;
  const counts = new Map<number, number>();
  for (const value of values) { const n = Number(value); counts.set(n, (counts.get(n) ?? 0) + 1); }
  for (const value of output) { const left = counts.get(value) ?? 0; if (left <= 0) return false; counts.set(value, left - 1); }
  return output.every((value, index) => index === 0 || output[index - 1] <= value);
}
function sink(): StateStore & { records: WriteBackRecord[] } {
  return { records: [], async getState() { return { completed: [], blockers: [] }; }, async writeBack(record) { this.records.push(record); } };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "goriq-acceptance-"));
  return { root, learning: new CognitiveLearningEngine(join(root, "learning")), cleanup: () => rm(root, { recursive: true, force: true }) };
}
function runFixture(root: string, goalId: string, values: string[], options: {
  learning?: CognitiveLearningBridge; numericOnly?: boolean; expertOnly?: boolean; numericRegression?: boolean;
  allowExternal?: boolean; expert?: ExternalExpertProvider; brain?: PrimaryBrainAdapter; offline?: boolean;
} = {}) {
  const state = new CognitiveStateStore(join(root, "state"), partition);
  const goal = { title, description: `Numeric input: ${values.join(",")}`, successCriteria: ["All input numbers occur exactly once and are in ascending numeric order"], constraints: [] };
  let actual: unknown;
  const visited: string[] = [];
  const registry = new CapabilityRegistry().register({ name: "local.sort", async execute(action) {
    const numeric = action.id === "numeric";
    visited.push(action.id); actual = transform(values, numeric && !options.numericRegression);
    return { actionId: action.id, ok: true, summary: `Produced numeric records ${JSON.stringify(actual)}`, evidence: { output: actual } };
  } }).register({ name: "context.inspect", async execute(action) { visited.push("inspect"); return { actionId: action.id, ok: true, summary: "No additional registered local tools are available" }; } });
  const candidate = (id: string): CognitiveCandidate => ({ id, kind: "experiment",
    requiresExternalAI: options.expertOnly, action: { id, capability: "local.sort", description: `Apply ${id} ordering`, risk: "low" }, expectedOutcome: "Conserved records in increasing numeric order", evidenceRequired: ["independent-order-check"] });
  const core = new CognitiveCore({ goalId, partition, state, environment, learning: options.learning, brain: options.brain,
    allowExternal: options.allowExternal, expert: options.expert, connectivity: options.offline ? "offline" : options.allowExternal ? "online" : "unknown",
    candidates: async () => options.numericOnly || options.expertOnly ? [candidate("numeric")] : [candidate("lexical"), candidate("numeric")],
    completion: async s => s.attempts.some(a => a.actionId === "numeric" && a.verified),
  });
  const records = sink();
  const loop = createCognitiveGoalLoop({ core, contextSources: [], executor: registry, stateStore: records,
    verifier: { async verify({ action, result }) {
      const output = (result.evidence as { output?: unknown } | undefined)?.output;
      const ok = verifyOrder(values, output);
      return { ok, summary: ok ? "Independent conservation and numeric-order checks passed" : "Independent numeric-order check failed", evidence: { refs: [`order:${goalId}:${action.id}`] } };
    } },
  });
  return { core, loop, goal, state, records, visited, output: () => actual, async finish(max = 5) {
    for (let i = 0; i < max; i++) { const report = await loop.runCycle({ goal }); if (report.stopReason === "goal_complete") return report; }
    throw Error("acceptance goal did not complete within bounded cycle budget");
  } };
}

test("A: certified existing skill completes with no external provider", async t => {
  const f = await fixture();
  try {
    await runFixture(f.root, "skill-source-1", input, { learning: f.learning, numericOnly: true }).finish();
    await runFixture(f.root, "skill-source-2", ["21", "8", "3"], { learning: f.learning, numericOnly: true }).finish();
    const synthesized = (await f.learning.candidates(partition))[0];
    assert.ok(synthesized);
    assert.equal((await f.learning.recall({ partition, goalId: "not-certified", task: title, environment })).skills.length, 0);
    const heldout = ["32", "9", "5"];
    const baseline = Number(verifyOrder(heldout, transform(heldout, false)));
    const improved = Number(verifyOrder(heldout, transform(heldout, true)));
    assert.equal((await f.learning.certify({ partition, skillId: synthesized.id, evidenceRefs: ["heldout:new-numeric-input"], baselinePassRate: baseline, candidatePassRate: improved, safetyPassed: true, independent: true })).accepted, true);
    assert.equal((await f.learning.candidates(partition)).find(c => c.id === synthesized.id)?.status, "active");
    assert.equal((await f.learning.recall({ partition, goalId: "different-host", task: title, environment: "different-environment" })).skills.length, 0);
    assert.equal((await f.learning.recall({ partition: { ...partition, principalId: "tester" }, goalId: "different-user", task: title, environment })).skills.length, 0);
    let modelCalls = 0;
    const unexpectedModel = async () => { modelCalls++; throw Error("certified skill should precede model reasoning"); };
    const brain: PrimaryBrainAdapter = { id: "model-must-not-run", infer: unexpectedModel, plan: unexpectedModel, classify: unexpectedModel, summarize: unexpectedModel, hypothesize: unexpectedModel, critique: unexpectedModel, estimateConfidence: unexpectedModel };
    const run = runFixture(f.root, "A", ["44", "3", "7"], { learning: f.learning, brain });
    await run.finish();
    const state = await run.state.get("A");
    assert.deepEqual(run.visited, ["numeric"]); assert.equal(state?.attempts[0].source, "skill"); assert.equal(state?.external_ai_calls, 0);
    assert.equal(modelCalls, 0); assert.equal((await f.learning.metrics(partition)).skillReuseRate, 1 / 3);
    const regressed = runFixture(f.root, "A-regression", input, { learning: f.learning, numericRegression: true });
    await regressed.loop.runCycle({ goal: regressed.goal });
    assert.equal((await regressed.state.get("A-regression"))?.attempts[0].source, "skill");
    assert.equal((await regressed.state.get("A-regression"))?.attempts[0].verified, false);
    assert.equal((await f.learning.candidates(partition)).find(c => c.id === synthesized.id)?.status, "quarantined");
    assert.equal((await new PersistentSkillLibrary(f.learning.partitionPath(partition, "skills.json")).get(synthesized.id))?.status, "quarantined");
    const retry = runFixture(f.root, "A-after-regression", input, { learning: f.learning, numericOnly: true });
    await retry.loop.runCycle({ goal: retry.goal });
    assert.deepEqual(retry.visited, ["inspect"]);
    t.diagnostic(JSON.stringify({ attempts: run.visited.length, externalCalls: state?.external_ai_calls, modelCalls, skillSourceExperiences: synthesized.sourceExperiences.length, verifiedRegressionQuarantined: true }));
  } finally { await f.cleanup(); }
});

test("B: unfamiliar local input is experimented on, verified, and replanned", async t => {
  const f = await fixture();
  try {
    const run = runFixture(f.root, "B", input, { learning: f.learning }); await run.finish();
    assert.deepEqual(run.visited, ["lexical", "numeric"]);
    const state = await run.state.get("B");
    assert.equal(state?.attempts[0].verified, false); assert.equal(state?.attempts[1].verified, true);
    assert.ok(state?.attempts.every(a => a.expectedOutcome && Number.isFinite(a.predictionError)));
    const world = await new PersistentWorldModel(f.learning.partitionPath(partition, "world.json")).list();
    assert.equal(world.length, 2); assert.equal(world[0].observation.success, false); assert.equal(world[1].observation.success, true);
    t.diagnostic(JSON.stringify({ attempts: 2, failures: 1, finalVerified: true, scope: "bounded host-supplied action catalog; arbitrary novel decomposition not established" }));
  } finally { await f.cleanup(); }
});

test("C: verified failure recall avoids repeating the same failed strategy", async t => {
  const f = await fixture();
  try {
    await runFixture(f.root, "failure-source", input, { learning: f.learning }).finish();
    const next = runFixture(f.root, "C", ["38", "5", "20"], { learning: f.learning }); await next.finish();
    assert.deepEqual(next.visited, ["numeric"]);
    assert.ok((await f.learning.recall({ partition, goalId: "C-next", task: title, environment })).avoidActionIds.includes("lexical"));
    t.diagnostic(JSON.stringify({ failedStrategyRepeated: false, attempts: next.visited.length }));
  } finally { await f.cleanup(); }
});

test("D: memory ablation measures fewer attempts with recalled evidence", async t => {
  const f = await fixture();
  try {
    await runFixture(f.root, "ablation-source", input, { learning: f.learning }).finish();
    const without = runFixture(f.root, "D-without", ["55", "8", "21"]);
    const withMemory = runFixture(f.root, "D-with", ["55", "8", "21"], { learning: f.learning });
    await without.finish(); await withMemory.finish();
    assert.ok(verifyOrder(["55", "8", "21"], without.output())); assert.ok(verifyOrder(["55", "8", "21"], withMemory.output()));
    assert.equal(without.visited.length, 2); assert.equal(withMemory.visited.length, 1);
    t.diagnostic(JSON.stringify({ sameInput: true, withoutMemoryAttempts: without.visited.length, withMemoryAttempts: withMemory.visited.length, reduction: 1 - withMemory.visited.length / without.visited.length, trainingCostExcluded: true }));
  } finally { await f.cleanup(); }
});

test("E: verified simulated expert strategy is recalled by a later local run", async t => {
  const f = await fixture();
  try {
    let calls = 0;
    const expert: ExternalExpertProvider = { id: "injected-expert-simulation", async eligible() { return true; }, async suggest() { calls++; return { candidateId: "numeric", assessment: "Use numeric comparison", hypotheses: ["Lexical order differs from numeric order"], expectedOutcome: "Increasing numeric order", confidence: 0.8, requiredEvidence: ["independent-order-check"], recoveryOptions: [], escalation: "none" }; } };
    const first = runFixture(f.root, "E-expert", input, { learning: f.learning, expertOnly: true, allowExternal: true, expert }); await first.finish();
    assert.equal(calls, 1); assert.equal((await first.state.get("E-expert"))?.attempts[0].source, "external-expert");
    // Host rebinds the independently verified strategy to its already registered local tool.
    // No model response is turned into executable code or permission.
    const next = runFixture(f.root, "E-local", ["41", "6", "13"], { learning: f.learning }); await next.finish();
    assert.equal((await next.state.get("E-local"))?.attempts[0].source, "memory"); assert.equal((await next.state.get("E-local"))?.external_ai_calls, 0);
    assert.deepEqual(next.visited, ["numeric"]); assert.equal(calls, 1);
    t.diagnostic(JSON.stringify({ provider: "simulation", expertCallsFirst: 1, expertCallsNext: 0, localRebind: "host-authorized existing tool", limit: "new executable skill generation from arbitrary expert prose not tested" }));
  } finally { await f.cleanup(); }
});

test("F: independently verified human correction prevents the old decision", async t => {
  const f = await fixture();
  try {
    assert.ok(verifyOrder(input, transform(input, true)));
    await f.learning.recordCorrection({ id: "human-correction", partition, goalId: "corrected", task: title, environment, originalActionId: "lexical", replacementActionId: "numeric", evidenceRefs: ["corrected-replay:conservation-and-order"], verified: true, scope: "preference" });
    const run = runFixture(f.root, "F", input, { learning: f.learning }); await run.finish();
    assert.deepEqual(run.visited, ["numeric"]); assert.equal((await run.state.get("F"))?.attempts[0].source, "memory");
    assert.equal((await f.learning.recall({ partition: { ...partition, principalId: "tester" }, goalId: "tester", task: title, environment })).corrections.length, 0);
    t.diagnostic(JSON.stringify({ oldDecisionRepeated: false, testerCorrectionLeakage: 0 }));
  } finally { await f.cleanup(); }
});

test("G: offline cognitive state and learning restore across runtime instances", async t => {
  const f = await fixture();
  try {
    const first = runFixture(f.root, "G", input, { learning: f.learning, offline: true });
    await first.loop.runCycle({ goal: first.goal });
    const before = await first.state.get("G"); assert.equal(before?.attempts.length, 1);
    const restored = runFixture(f.root, "G", input, { learning: new CognitiveLearningEngine(f.learning.directory), offline: true });
    await restored.finish(); const after = await restored.state.get("G");
    assert.equal(after?.goal_id, before?.goal_id); assert.deepEqual(after?.partition, before?.partition); assert.equal(after?.attempts.length, 2); assert.equal(after?.external_ai_calls, 0);
    assert.deepEqual(restored.visited, ["numeric"]);
    t.diagnostic(JSON.stringify({ restoredGoal: true, savedAttempts: before?.attempts.length, finalAttempts: after?.attempts.length, externalCalls: 0, scope: "runtime restart; no uncertain in-flight effects" }));
  } finally { await f.cleanup(); }
});

function improvement(id: string, gain: number): ImprovementCandidate {
  return { id, surface: "planner", sourceEvidence: ["measured:sorting-benchmark"], knownGoodVersion: "numeric-v1", candidateVersion: "candidate-v2", verified: true, measurableGain: gain, safetyRegression: false, humanInterventionDelta: 0, additionalApiCostUsd: 0 };
}
test("H: no measured improvement is rejected before mutation", async t => {
  const f = await fixture();
  try {
    const path = join(f.root, "active-algorithm.json"); await writeFile(path, JSON.stringify({ algorithm: "numeric" }));
    const baseline = Number(verifyOrder(input, transform(input, true))); const candidate = Number(verifyOrder(input, transform(input, true)));
    let stages = 0; const stage = async (): Promise<ImprovementStageResult> => { stages++; return { ok: true, evidence: ["unexpected-stage"] }; };
    const record = await f.learning.improve(partition, improvement("H", candidate - baseline), { sandbox: stage, test: stage, regression: stage, deviceE2E: stage, canary: stage, promote: stage, rollback: stage, independentVerification: stage, security: stage });
    assert.equal(record.state, "rejected"); assert.equal(record.reason, "measurable_gain_required"); assert.equal(stages, 0);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { algorithm: "numeric" });
    t.diagnostic(JSON.stringify({ baselineScore: baseline, candidateScore: candidate, rejected: true, mutations: 0 }));
  } finally { await f.cleanup(); }
});

test("I: canary regression restores and independently verifies the baseline", async t => {
  const f = await fixture();
  try {
    const path = join(f.root, "active-algorithm.json"); const baseline = JSON.stringify({ algorithm: "numeric" }); await writeFile(path, baseline);
    const virtualStage = async (name: string): Promise<ImprovementStageResult> => ({ ok: verifyOrder(["8", "1", "4"], transform(["8", "1", "4"], true)), evidence: [`synthetic-local-stage:${name}`] });
    let rolledBack = false; let promoted = false;
    const record = await f.learning.improve(partition, improvement("I", 0.1), {
      sandbox: () => virtualStage("sandbox"), test: () => virtualStage("train"), regression: () => virtualStage("pre-canary"), independentVerification: () => virtualStage("independent"), security: () => virtualStage("isolated-temp-root"),
      // Exercises the existing stage contract with software evidence; never a physical PASS.
      deviceE2E: () => virtualStage("virtual-artifact-flow"),
      async canary() { await writeFile(path, JSON.stringify({ algorithm: "lexical" })); const selected = JSON.parse(await readFile(path, "utf8")).algorithm; return { ok: verifyOrder(input, transform(input, selected === "numeric")), evidence: ["heldout:canary-order-check"], reason: "measured_canary_regression" }; },
      async promote() { promoted = true; return { ok: false, evidence: ["unexpected-promotion"] }; },
      async rollback() { await writeFile(path, baseline); rolledBack = (await readFile(path, "utf8")) === baseline && verifyOrder(input, transform(input, JSON.parse(await readFile(path, "utf8")).algorithm === "numeric")); return { ok: rolledBack, evidence: ["restore:bytes-and-output-verified"] }; },
    });
    assert.equal(record.state, "rolled-back"); assert.equal(rolledBack, true); assert.equal(promoted, false); assert.equal(await readFile(path, "utf8"), baseline);
    t.diagnostic(JSON.stringify({ canaryRegression: true, rollbackVerified: rolledBack, physicalEvidence: false }));
  } finally { await f.cleanup(); }
});

test("J: unavailable local model and disabled experts preserve useful degraded execution", async t => {
  const f = await fixture();
  try {
    let requests = 0; const unavailable = async () => { requests++; throw Error("local model unavailable"); };
    const brain: PrimaryBrainAdapter = { id: "unavailable-test-adapter", infer: unavailable, plan: unavailable, classify: unavailable, summarize: unavailable, hypothesize: unavailable, critique: unavailable, estimateConfidence: unavailable };
    const run = runFixture(f.root, "J", input, { learning: f.learning, brain, numericOnly: true, offline: true }); await run.finish();
    const state = await run.state.get("J"); assert.equal(state?.mode, "DEGRADED"); assert.equal(state?.attempts[0].verified, true); assert.equal(state?.external_ai_calls, 0); assert.equal(requests, 1);
    const metrics = await f.learning.metrics(partition); assert.equal(metrics.externalAiFreeCompletionRate, 1); assert.equal(metrics.localOnlyCompletionRate, 1);
    t.diagnostic(JSON.stringify({ degraded: true, verifiedLocalOutput: true, measured: metrics }));
  } finally { await f.cleanup(); }
});
