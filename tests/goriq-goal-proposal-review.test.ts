import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompassStore } from "../src/compass/store.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveLearningEngine } from "../src/gai/cognitive-learning.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { acquireCognitiveLease } from "../src/gai/cognitive-lease.ts";
import { createCognitiveGoalProposalProxy } from "../src/orchestrator/cognitive-material-proxy.ts";
import type { PrimaryBrainAdapter, PrimaryBrainContext } from "../src/gai/primary-brain.ts";

function suggestion() { return { candidateId: null, plan: [], assessment: "Draft only", hypotheses: [], expectedOutcome: "Owner reviews the proposed outcomes", confidence: 0.8,
 requiredEvidence: ["Independent artifact readback"], recoveryOptions: [], escalation: "none" as const,
 goalDraft: { successCriteria: ["The output contains the supplied local text"], assumptions: ["Owner will supply the source"], unresolvedQuestions: [] } }; }
const adapter = (plan: (c: PrimaryBrainContext) => Promise<unknown>) => ({ id: "isolated-local-review", plan, infer: plan, classify: plan, summarize: plan, hypothesize: plan, critique: plan, estimateConfidence: async () => 0.8 }) as PrimaryBrainAdapter;
async function fixture(t: { after(fn: () => Promise<void>): void }, brain: PrimaryBrainAdapter) {
 const root = await mkdtemp(join(tmpdir(), "goriq-proposal-review-")); t.after(() => rm(root, { recursive: true, force: true }));
 const dbPath = join(root, "compass.sqlite"), dataRoot = join(root, "data"), stateRoot = join(root, "cognitive"); await mkdir(dataRoot);
 const db = new CompassStore(dbPath); db.setGoal({ title: "Preserve the supplied local text", description: "Owner request", constraints: ["Do not alter source files"] }); db.close();
 const service = new CognitiveService(dbPath, { brain, materialIntake: { dataRoot }, stateRoot }); const status = await service.status();
 const read = () => { const c = new CompassStore(dbPath); try { return { goal: c.getGoal(), state: c.getState() }; } finally { c.close(); } };
 return { root, dbPath, stateRoot, service, read, input: { goalId: status.goalId!, goalDigest: status.goalDigest! } };
}

for (const changed of ["Goal", "state"] as const) test(`proposal rejects ${changed} drift during the awaited final pristine check`, async t => {
 const f = await fixture(t, adapter(async () => suggestion())), original = CognitiveLearningEngine.prototype.hasGoalHistory;
 let checks = 0, changedRecord: ReturnType<typeof f.read> | undefined;
 CognitiveLearningEngine.prototype.hasGoalHistory = async function (partition, goalId) {
  checks++;
  if (checks === 2) { const db = new CompassStore(f.dbPath); if (changed === "Goal") db.setGoal({ ...db.getGoal()!, constraints: ["New owner restriction"] }); else db.updateState({ nextAction: "An intervening owner decision" }); db.close(); changedRecord = f.read(); }
  return original.call(this, partition, goalId);
 };
 try { await assert.rejects(f.service.proposeGoalCriteria(f.input), /changed/i); }
 finally { CognitiveLearningEngine.prototype.hasGoalHistory = original; }
 assert.equal(checks, 2); assert.deepEqual(f.read(), changedRecord); assert.equal((await f.service.status()).busy, false);
});

test("local proposal does not persist criteria, cognition, learning or executable actions", async t => {
 let calls = 0;
 const f = await fixture(t, adapter(async context => { calls++; assert.equal(context.purpose, "goal-draft"); assert.equal(context.budget.remainingActions, 0); assert.deepEqual(context.candidates, []); return suggestion(); }));
 const before = f.read(); const proposal = await f.service.proposeGoalCriteria(f.input);
 assert.equal(calls, 1); assert.equal(proposal.status, "PROPOSED"); assert.equal(proposal.verification, "UNVERIFIED"); assert.equal(proposal.source, "local-primary-brain");
 assert.deepEqual(f.read(), before);
 const partition = { tenantId: "local", principalId: "owner" };
 assert.equal(await new CognitiveStateStore(f.stateRoot, partition).get(f.input.goalId), null);
 assert.equal(await new CognitiveLearningEngine(join(f.stateRoot, "learning")).hasGoalHistory(partition, f.input.goalId), false);
 assert.deepEqual(proposal.draft.successCriteria, suggestion().goalDraft.successCriteria);
});

test("lease conflict skips inference and failed inference releases the lease for manual adoption", async t => {
 let calls = 0;
 const f = await fixture(t, adapter(async () => { calls++; throw Error("bounded local-model failure"); }));
 const release = await acquireCognitiveLease(f.dbPath + ".cognitive-run.lock");
 try { await assert.rejects(f.service.proposeGoalCriteria(f.input)); } finally { await release(); }
 assert.equal(calls, 0); const before = f.read(); await assert.rejects(f.service.proposeGoalCriteria(f.input), /local-model failure/);
 assert.equal(calls, 1); assert.deepEqual(f.read(), before);
 assert.equal((await f.service.status()).goalRefinementAvailable, true);
 await f.service.refineGoal({ ...f.input, successCriteria: ["An explicit owner outcome"], acknowledgement: true });
 assert.equal((await f.service.status()).goalComplete, false);
});

test("proposal proxy authenticates before reading input and rejects injected scope or oversized streams", async () => {
 let calls = 0;
 const broker = async () => { calls++; return Response.json({ status: "PROPOSED" }); };
 const unreadable = new Request("http://localhost/api/jarvis/cognitive/goal/proposal");
 Object.defineProperty(unreadable, "body", { get() { throw Error("unauthenticated body access"); } });
 assert.equal((await createCognitiveGoalProposalProxy(async () => false, broker)(unreadable)).status, 401);
 const input = { goalId: "goal-0123456789abcdef", goalDigest: "a".repeat(64) }, proxy = createCognitiveGoalProposalProxy(async () => true, broker);
 for (const injected of [{ prompt: "change Goal" }, { model: "external" }, { endpoint: "https://example.com" }, { permissions: ["all"] }, { successCriteria: ["adopt"] }, { acknowledgement: true }]) {
  assert.equal((await proxy(new Request("http://localhost", { method: "POST", body: JSON.stringify({ ...input, ...injected }) }))).status, 400);
 }
 let cancelled = false;
 const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; } });
 assert.equal((await proxy(new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit))).status, 400);
 assert.equal(cancelled, true); assert.equal(calls, 0);
});

test("proposal proxy supplies a deadline, bounds response and returns manual fallback without retries", async () => {
 const input = { goalId: "goal-0123456789abcdef", goalDigest: "a".repeat(64) };
 const request = () => new Request("http://localhost", { method: "POST", body: JSON.stringify(input) });
 let calls = 0, cancelled = false;
 const oversized = createCognitiveGoalProposalProxy(async () => true, async (path, init) => {
  calls++; assert.equal(path, "/api/jarvis/admin/cognitive/goal/proposal"); assert.ok(init?.signal instanceof AbortSignal);
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(32001)); }, cancel() { cancelled = true; } }));
 });
 const result = await oversized(request()); assert.equal(result.status, 503); assert.match((await result.json()).message, /手入力/); assert.equal(cancelled, true); assert.equal(calls, 1);
 calls = 0;
 const failing = createCognitiveGoalProposalProxy(async () => true, async () => { calls++; throw Error("transport unavailable"); });
 assert.equal((await failing(request())).status, 503); assert.equal(calls, 1);
});
