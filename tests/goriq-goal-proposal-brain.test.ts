import assert from "node:assert/strict";
import test from "node:test";
import { OllamaPrimaryBrainAdapter, validateBrainDecision, type PrimaryBrainContext } from "../src/gai/primary-brain.ts";

const context = (): PrimaryBrainContext => ({ purpose: "goal-draft", goal: { title: "Owner report", description: "Preserve the supplied local report", successCriteria: [], constraints: ["No external transfer"] },
  currentState: "Propose outcomes only", candidates: [], memories: [], world: [], previousAttempts: [], environment: "local", connectivity: "offline", budget: { remainingActions: 0 }, constraints: ["No external transfer"] });
const draft = () => ({ successCriteria: ["The output preserves all supplied report content"], assumptions: ["The owner supplies the source"], unresolvedQuestions: [{ question: "Which output format is required?", impact: "medium" as const }] });
const decision = () => ({ candidateId: null, plan: [], assessment: "Propose desired outcomes for owner review", hypotheses: [], expectedOutcome: "A report preserving the source", confidence: 0.8,
  requiredEvidence: ["Independent readback of output bytes"], recoveryOptions: ["Ask the owner to clarify the format"], escalation: "none" as const, goalDraft: draft() });
const response = (value: unknown) => new Response(JSON.stringify({ response: JSON.stringify(value) }));

test("Goal draft validates desired outcomes separately from evidence without changing host authority", () => {
  const c = context(), before = structuredClone(c), proposed = decision();
  proposed.goalDraft.successCriteria[0] = "  The output preserves all supplied report content  ";
  const checked = validateBrainDecision(proposed, c);
  assert.deepEqual(checked.goalDraft, draft());
  assert.deepEqual(checked.requiredEvidence, proposed.requiredEvidence);
  assert.notDeepEqual(checked.goalDraft?.successCriteria, checked.requiredEvidence);
  assert.deepEqual(c, before);
  assert.equal(Object.hasOwn(checked.goalDraft!, "title"), false);
  assert.equal(Object.hasOwn(checked.goalDraft!, "constraints"), false);
  proposed.goalDraft.successCriteria[0] = "Mutated caller data";
  assert.deepEqual(checked.goalDraft?.successCriteria, draft().successCriteria);
});

test("Goal draft rejects injected identity, permissions, verification and unknown nested fields", () => {
  for (const field of ["title", "description", "constraints", "approvalRequired", "verified", "path", "permission", "confidence"]) {
    assert.throws(() => validateBrainDecision({ ...decision(), goalDraft: { ...draft(), [field]: "forged" } }, context()));
    assert.throws(() => validateBrainDecision({ ...decision(), [field]: "forged" }, context()));
  }
  assert.throws(() => validateBrainDecision({ ...decision(), goalDraft: { ...draft(), unresolvedQuestions: [{ question: "Which output?", impact: "low", answer: "forged" }] } }, context()));
});

test("Goal draft enforces text, count, duplicate and question-impact bounds", () => {
  const valid = decision();
  assert.equal(validateBrainDecision({ ...valid, goalDraft: { ...draft(), successCriteria: ["x".repeat(500)] } }, context()).goalDraft?.successCriteria[0].length, 500);
  for (const goalDraft of [null, [], {}, { ...draft(), successCriteria: [] }, { ...draft(), successCriteria: [" "] }, { ...draft(), successCriteria: ["same", " same "] },
    ...["successCriteria", "assumptions"].flatMap(field => [{ ...draft(), [field]: ["x".repeat(501)] }, { ...draft(), [field]: Array.from({ length: 17 }, (_, i) => "entry " + i) }]),
    { ...draft(), unresolvedQuestions: Array.from({ length: 17 }, () => ({ question: "Question", impact: "low" })) },
    { ...draft(), unresolvedQuestions: [{ question: "x".repeat(501), impact: "low" }] }, { ...draft(), unresolvedQuestions: [{ question: "Question", impact: "critical" }] }]) {
    assert.throws(() => validateBrainDecision({ ...valid, goalDraft }, context()));
  }
});

test("proposal privacy checks reject secrets and personal information in all displayed proposal text", () => {
  for (const privateText of ["password=private-value", "api_key=private-value", "Bearer abcdefghijklmnop", "owner@example.invalid", "123-456-7890"]) {
    for (const goalDraft of [{ ...draft(), successCriteria: [privateText] }, { ...draft(), assumptions: [privateText] }, { ...draft(), unresolvedQuestions: [{ question: privateText, impact: "low" }] }])
      assert.throws(() => validateBrainDecision({ ...decision(), goalDraft }, context()));
    for (const extra of [{ assessment: privateText }, { requiredEvidence: [privateText] }, { recoveryOptions: [privateText] }])
      assert.throws(() => validateBrainDecision({ ...decision(), ...extra }, context()));
  }
});

test("proposal context and response cannot contain executable actions", () => {
  const candidate = { id: "write", description: "Write output", risk: "low" as const };
  for (const c of [{ ...context(), candidates: [candidate] }, { ...context(), budget: { remainingActions: 1 } }])
    assert.throws(() => validateBrainDecision(decision(), c));
  assert.throws(() => validateBrainDecision({ ...decision(), candidateId: "write", plan: [{ candidateId: "write", objective: "Write", expectedOutcome: "Saved" }] }, { ...context(), candidates: [candidate] }));
  assert.throws(() => validateBrainDecision({ ...decision(), plan: [{}] }, context()));
});

test("ordinary decisions preserve their previous shape and evidence never invents a missing draft", () => {
  const { goalDraft: _goalDraft, ...normal } = decision(); void _goalDraft;
  const { purpose: _purpose, ...ordinary } = context(); void _purpose;
  assert.deepEqual(validateBrainDecision(normal, ordinary), normal);
  assert.equal(Object.hasOwn(validateBrainDecision(normal, context()), "goalDraft"), false);
  assert.throws(() => validateBrainDecision(decision(), ordinary), /draft|purpose|proposal/i);
});

test("local adapter adds a bounded Goal-only schema and prompt only for proposal purpose", async () => {
  const bodies: Record<string, unknown>[] = [];
  const adapter = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "host-configured", fetchImpl: async (url, init) => {
    assert.equal(url, "http://127.0.0.1:11434/api/generate"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    bodies.push(JSON.parse(String(init!.body)));
    const { goalDraft: _goalDraft, ...normal } = decision(); void _goalDraft;
    return response(bodies.length === 1 ? decision() : normal);
  } });
  assert.deepEqual((await adapter.plan(context())).goalDraft, draft());
  const { purpose: _purpose, ...ordinary } = context(); void _purpose;
  await adapter.plan(ordinary);
  const schema = bodies[0].format as { properties: Record<string, { maxItems?: number; additionalProperties?: boolean; properties?: Record<string, unknown> }> };
  assert.equal(schema.properties.goalDraft.additionalProperties, false);
  assert.equal(schema.properties.plan.maxItems, 0);
  assert.deepEqual(Object.keys(schema.properties.goalDraft.properties!).sort(), ["assumptions", "successCriteria", "unresolvedQuestions"]);
  assert.match(String(bodies[0].prompt), /desired outcomes|success criteria/i);
  assert.match(String(bodies[0].prompt), /evidence/i);
  assert.match(String(bodies[0].prompt), /same language as the owner's Goal/i);
  assert.match(String(bodies[0].prompt), /every explicit desired outcome/i);
  assert.match(String(bodies[0].prompt), /download/i);
  assert.match(String(bodies[0].prompt), /known capability facts/i);
  assert.match(String(bodies[0].prompt), /actual unknowns/i);
  assert.equal(Object.hasOwn((bodies[1].format as { properties: object }).properties, "goalDraft"), false);
});

test("invalid proposal context is rejected before a local model call", async () => {
  let calls = 0;
  const adapter = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "host-configured", fetchImpl: async () => { calls++; return response(decision()); } });
  await assert.rejects(adapter.plan({ ...context(), budget: { remainingActions: 1 } }));
  assert.equal(calls, 0);
});

test("unavailable or oversized local model response fails once without synthesizing a proposal", async () => {
  let calls = 0;
  const unavailable = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "host-configured", fetchImpl: async () => { calls++; return new Response("Unavailable", { status: 503 }); } });
  await assert.rejects(unavailable.plan(context()), /unavailable/); assert.equal(calls, 1);
  let cancelled = false;
  const oversized = new OllamaPrimaryBrainAdapter({ endpoint: "http://127.0.0.1:11434", model: "host-configured", maxResponseBytes: 100, fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } })) });
  await assert.rejects(oversized.plan(context()), /bound/); assert.equal(cancelled, true);
});
