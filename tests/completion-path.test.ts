import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import { GoalControllerRuntime } from "../src/orchestrator/goal-controller-runtime.ts";
import { DevelopmentOrchestrator } from "../src/orchestrator/development-orchestrator.ts";
import { assessCompletionPath, type CompletionInput, type CompletionCandidate, type CompletionCycle } from "../src/orchestrator/completion-path.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

const revision = "a".repeat(40);
const digest = "b".repeat(64);
const at = "2026-10-23T00:00:00.000Z";
function state(): WorkState {
  return { goalId: "goal-1858", objective: "Remote operation", definitionOfDone: [
    { id: "software", description: "software", required: true },
    { id: "physical", description: "physical remote input", required: true },
  ], currentState: "prepared", status: "IN_PROGRESS", riskClass: "R1", constraints: ["human consent"],
  decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers: ["physical-pending"], nextAction: "original", updatedAt: at };
}
function candidate(id: string, criteria = ["software"]): CompletionCandidate {
  return { workItem: { id, objective: id, dependsOn: [], requiredCapabilities: ["node"] }, criterionIds: criteria,
    strategyId: "strategy-1", rationale: "verified missing requirement", evidenceRefs: ["issue:1858"],
    feasibility: "available", estimatedMinutes: 10, riskSignals: {}, humanActions: [], existingIssue: "1858", existingPr: "candidate" };
}
function input(candidates = [candidate("implement")]): CompletionInput {
  return { goalId: "goal-1858", cycleId: "cycle-0", at, candidates,
    requirements: ["software", "physical"].map(id => ({ criterionId: id, weight: id === "physical" ? 5 : 1,
      evidence: [{ kind: id === "physical" ? "physical" : "ci", environment: id === "physical" ? "physical-device" : "ci",
        sourceRevision: revision, artifactDigest: digest, trustedIssuers: ["independent-verifier"] }] })),
    evidence: [], capabilities: { node: true }, completedWorkItems: [], responses: [], deliveries: [] };
}

test("prioritizes useful dependencies over unrelated cheap work without mutation", () => {
  const setup = candidate("setup", []);
  const operation = candidate("operation", ["physical"]); operation.workItem.dependsOn = ["setup"];
  const fluff = candidate("cosmetic", []); fluff.estimatedMinutes = 0.01;
  const s = state(); const before = structuredClone(s);
  const result = assessCompletionPath(s, input([fluff, candidate("software"), operation, setup]));
  assert.equal(result.recommendation?.taskId, "setup");
  assert.equal(result.candidates.find(c => c.taskId === "operation")?.status, "WAITING_DEPENDENCY");
  assert.equal(result.candidates.find(c => c.taskId === "cosmetic")?.status, "NO_CONTRIBUTION");
  assert.deepEqual(s, before); assert.equal(result.executionAuthority, false);
});

test("detects human needs ahead of dependencies, retains gated work and recommends safe work", () => {
  const gated = candidate("publish", ["physical"]); gated.workItem.dependsOn = ["safe"];
  gated.riskSignals = { permissionChange: true };
  gated.humanActions = [{ kind: "os_permission", operation: "Allow screen capture", reason: "Android requires consent", target: "nubia", deadline: "2026-10-23T01:00:00Z", impact: "physical acceptance waits" }];
  const r = assessCompletionPath(state(), input([gated, candidate("safe")]));
  assert.equal(r.recommendation?.taskId, "safe");
  assert.equal(r.notifications.length, 2);
  assert.ok(r.notifications.every(n => n.status === "PREPARED" && !n.deliveredAt));
  assert.equal(r.candidates.find(c => c.taskId === "publish")?.status, "HUMAN_REQUIRED");
});

test("CI, executor assertions, stale evidence and waivers cannot satisfy physical acceptance", () => {
  const s = state(); s.verificationResults = [{ itemId: "physical", passed: true, waived: true }];
  const i = input(); i.evidence = [{ id: "ci", criterionId: "physical", kind: "ci", environment: "ci", issuer: "independent-verifier", verified: true, sourceRevision: revision, artifactDigest: digest, recordedAt: at }];
  assert.deepEqual(assessCompletionPath(s, i).verifiedCriteria, []);
  i.evidence[0] = { ...i.evidence[0], kind: "physical", environment: "physical-device", sourceRevision: "c".repeat(40) };
  assert.deepEqual(assessCompletionPath(s, i).verifiedCriteria, []);
  i.evidence[0] = { ...i.evidence[0], sourceRevision: revision, issuer: "builder" };
  assert.deepEqual(assessCompletionPath(s, i).verifiedCriteria, []);
  i.evidence[0].issuer = "independent-verifier";
  assert.deepEqual(assessCompletionPath(s, i).verifiedCriteria, ["physical"]);
  i.evidence.push({ ...i.evidence[0], id: "failed", verified: false, recordedAt: "2026-10-23T00:01:00Z" });
  i.at = "2026-10-23T00:02:00Z";
  assert.deepEqual(assessCompletionPath(s, i).verifiedCriteria, []);
});

test("three unproductive attempts trigger Recovery and prefer a different strategy", () => {
  const history: CompletionCycle[] = [];
  for (let n = 0; n < 3; n++) {
    const i = input(); i.cycleId = `attempt-${n}`; i.at = `2026-10-23T00:0${n}:00Z`;
    i.attempt = { taskId: "implement", strategyId: "strategy-1", failureSignature: "same-failure", failureClass: "implementation" };
    history.push(assessCompletionPath(state(), i, history));
  }
  const alt = candidate("alternative"); alt.strategyId = "strategy-2";
  const i = input([candidate("implement"), alt]); i.at = "2026-10-23T00:05:00Z"; i.cycleId = "replan";
  const r = assessCompletionPath(state(), i, history);
  assert.equal(r.replanRequired, true); assert.equal(r.recommendation?.taskId, "alternative");
  assert.equal(r.metrics.unproductiveAttempts, 3); assert.equal(r.metrics.stagnationMs, 300_000);
  assert.equal(history[2].recovery?.action, "strategy_pivot");
});

test("unknown evidence requires investigation; duplicate tasks reuse existing issue/PR", () => {
  const a = candidate("first"); const b = candidate("duplicate"); b.workItem.objective = a.workItem.objective;
  const i = input([a, b]); delete i.capabilities.node;
  const r = assessCompletionPath(state(), i);
  assert.equal(r.recommendation?.mode, "INVESTIGATE");
  assert.equal(r.candidates.filter(c => c.status === "DUPLICATE").length, 1);
  assert.deepEqual(r.recommendation?.reuse, { issue: "1858", pr: "candidate" });
});

test("rejects cycles, invalid timestamps and missing criterion evidence contracts", () => {
  const i = input(); i.candidates[0].workItem.dependsOn = ["implement"];
  assert.throws(() => assessCompletionPath(state(), i), /dependency/);
  assert.throws(() => assessCompletionPath(state(), { ...input(), at: "invalid" }), /timestamp/);
  const incomplete = input(); incomplete.requirements = [];
  const r = assessCompletionPath(state(), incomplete);
  assert.equal(r.readyForCompletionReview, false); assert.ok(r.gaps.some(x => x.includes("evidence_contract")));
});

test("journal survives real SQLite restart, deduplicates notices/receipts and preserves authority", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "goriq-advisory-")), "compass.sqlite");
  let db = new CompassStore(path); let store = new CompassWorkStateStoreAdapter(db);
  const s = state(); await store.put(s);
  const c = candidate("consent"); c.riskSignals.permissionChange = true;
  const i = input([c]);
  const first = await store.recordCompletionAssessment(i);
  db.close(); db = new CompassStore(path); store = new CompassWorkStateStoreAdapter(db);
  try {
    assert.deepEqual(await store.recordCompletionAssessment(i), first);
    const second = { ...i, cycleId: "cycle-1", at: "2026-10-23T00:01:00Z", deliveries: [{ notificationId: first.notifications[0].id, at: "2026-10-23T00:00:30Z", receiptRef: "owner-ui:receipt1" }] };
    const r = await store.recordCompletionAssessment(second);
    assert.equal(r.notifications.length, 1); assert.equal(r.newNotificationIds.length, 0);
    assert.equal(r.notifications[0].status, "DELIVERED");
    const third = { ...i, cycleId: "cycle-2", at: "2026-10-23T00:02:00Z", responses: [{ notificationId: first.notifications[0].id, status: "approved" as const, at: "2026-10-23T00:01:30Z", receiptRef: "owner:approval1" }] };
    const answered = await store.recordCompletionAssessment(third);
    assert.equal(answered.notifications[0].status, "ANSWERED");
    assert.equal(answered.candidates[0].status, "HUMAN_REQUIRED");
    assert.deepEqual(await store.get(s.goalId), s);
    await store.put({ ...s, currentState: "authoritative update" });
    assert.equal((await store.getCompletionHistory(s.goalId)).length, 3);
    await assert.rejects(store.recordCompletionAssessment({ ...i, candidates: [] }), /cycle identity conflict/);
  } finally { db.close(); }
});

test("existing controllers expose read-only assessment and never create a Goal or DevelopmentJob", async () => {
  const s = state(); const i = input();
  const runtime = new GoalControllerRuntime({ registry: { listActive: async () => [], create: async () => { throw Error("must not create Goal"); } }, workStateStore: { get: async () => s, put: async () => { throw Error("must not mutate"); }, appendEvent: async () => { throw Error("must not mutate"); } } });
  assert.deepEqual(await runtime.inspectCompletionPath(i), new DevelopmentOrchestrator().assessCompletionPath(s, i));
});

test("read-only Remote Lite case selects activation investigation, keeps four human waits and no physical PASS", () => {
  const fixture = "docs/evidence/1858-remote-lite-snapshot.json";
  const before = readFileSync(fixture, "utf8");
  const r = JSON.parse(execFileSync(process.execPath, ["scripts/goriq-completion-inspect.ts", fixture], { encoding: "utf8" })) as CompletionCycle;
  assert.equal(r.recommendation?.taskId, "inspect-activation"); assert.equal(r.recommendation?.mode, "INVESTIGATE");
  assert.deepEqual(r.recommendation?.reuse, { issue: "1831", pr: "1832" });
  assert.equal(r.notifications.length, 4); assert.equal(r.readyForCompletionReview, false);
  assert.deepEqual(r.verifiedCriteria, []); assert.equal(readFileSync(fixture, "utf8"), before);
});

test("synthetic FIFO comparison measures verified outcomes, wasted selections and early notification", () => {
  // Explicit model baseline, not a claim about historical GORIQ wall-clock performance.
  const cosmetic = candidate("cosmetic", []), useful = candidate("useful");
  const consent = candidate("consent", ["physical"]);
  consent.humanActions = [{ kind: "physical_operation", operation: "Allow capture", reason: "OS consent", target: "phone", deadline: "2026-10-23T00:01:00Z", impact: "physical blocked" }];
  const cases = [cosmetic, consent, useful];
  const improved = assessCompletionPath(state(), input(cases));
  assert.equal(improved.recommendation?.taskId, "useful");
  const receiptAt = "2026-10-23T00:00:10Z";
  const afterInput = input(cases); afterInput.cycleId = "after"; afterInput.at = "2026-10-23T00:01:00Z";
  afterInput.deliveries = [{ notificationId: improved.notifications[0].id, at: receiptAt, receiptRef: "synthetic-ui:1" }];
  afterInput.evidence = [{ id: "pass", criterionId: "software", kind: "ci", environment: "ci", issuer: "independent-verifier", verified: true, sourceRevision: revision, artifactDigest: digest, recordedAt: afterInput.at }];
  const after = assessCompletionPath(state(), afterInput, [improved]);
  const baselineSelectionsBeforeUseful = cases.findIndex(c => c.workItem.id === "useful");
  assert.deepEqual({ baseline: { verifiedAtMinute1: 0, wastedSelections: baselineSelectionsBeforeUseful, firstUsefulMinute: 3, noticeDelayMs: 120_000 },
    advisory: { verifiedAtMinute1: after.metrics.verifiedDelta, wastedSelections: 0, firstUsefulMinute: 1, noticeDelayMs: Date.parse(receiptAt) - Date.parse(at) } },
  { baseline: { verifiedAtMinute1: 0, wastedSelections: 2, firstUsefulMinute: 3, noticeDelayMs: 120_000 }, advisory: { verifiedAtMinute1: 1, wastedSelections: 0, firstUsefulMinute: 1, noticeDelayMs: 10_000 } });
  assert.equal(after.metrics.lateNotifications, 0);
});

test("late, unknown, conflicting and future receipts do not invent delivery or approval", () => {
  const c = candidate("gated"); c.humanActions = [{ kind: "account", operation: "Sign in", reason: "existing account", target: "browser", deadline: "2026-10-23T00:01:00Z", impact: "integration waits" }];
  const first = assessCompletionPath(state(), input([c]));
  const second = { ...input([c]), cycleId: "late", at: "2026-10-23T00:02:00Z" };
  assert.equal(assessCompletionPath(state(), second, [first]).metrics.lateNotifications, 1);
  second.deliveries = [{ notificationId: "unknown", at, receiptRef: "receipt" }];
  assert.throws(() => assessCompletionPath(state(), second, [first]), /receipt/);
  second.deliveries[0].notificationId = first.notifications[0].id; second.deliveries[0].at = "2026-10-23T00:03:00Z";
  assert.throws(() => assessCompletionPath(state(), second, [first]), /receipt/);
});

test("a replay cannot reuse readiness for a changed Goal, criterion or blocker", () => {
  const i = input(), s = state(); const first = assessCompletionPath(s, i);
  assert.throws(() => assessCompletionPath({ ...s, goalId: "other" }, i, [first]), /identity/);
  assert.throws(() => assessCompletionPath({ ...s, objective: "changed" }, i, [first]), /history/);
  assert.throws(() => assessCompletionPath({ ...s, blockers: ["new-blocker"] }, i, [first]), /stale/);
  assert.throws(() => assessCompletionPath({ ...s, definitionOfDone: [...s.definitionOfDone, { id: "new", description: "new" }] }, i, [first]), /history/);
});

test("Recovery budgets do not mix unrelated task failures", () => {
  const history: CompletionCycle[] = [];
  for (let n = 0; n < 3; n++) {
    const i = input([candidate(`task-${n}`)]); i.cycleId = `cycle-${n}`; i.at = `2026-10-23T00:0${n}:00Z`;
    i.attempt = { taskId: `task-${n}`, strategyId: "same-command", failureSignature: "timeout", failureClass: "transient" };
    history.push(assessCompletionPath(state(), i, history));
  }
  assert.equal(history[2].replanRequired, true);
  assert.equal(history[2].recovery?.action, "retry_same");
  assert.equal(history[2].recommendation?.taskId, "task-2");
});

test("an unavailable duplicate never suppresses a different available capability", () => {
  const offline = candidate("offline"), online = candidate("online");
  online.workItem.objective = offline.workItem.objective; offline.workItem.requiredCapabilities = ["offline-node"];
  const i = input([offline, online]); i.capabilities["offline-node"] = false;
  assert.equal(assessCompletionPath(state(), i).recommendation?.taskId, "online");
});

test("a less verified duplicate does not suppress a fully checked medium-risk candidate", () => {
  const pending = candidate("a-pending"), checked = candidate("z-checked"); checked.workItem.objective = pending.workItem.objective;
  pending.riskSignals.crossComponentChange = true; checked.riskSignals.crossComponentChange = true;
  checked.mediumChecks = { ciPassed: true, qaPassed: true, reviewerPassed: true, unresolvedReviewThreads: 0, destructiveChangeAbsent: true, privilegedChangeAbsent: true };
  const result = assessCompletionPath(state(), input([pending, checked]));
  assert.equal(result.candidates.find(c => c.taskId === "z-checked")?.status, "READY");
  assert.equal(result.recommendation?.taskId, "z-checked");
});

test("human responses evolve without overwriting or accepting conflicting receipts", () => {
  const c = candidate("permission"); c.riskSignals.permissionChange = true;
  const i = input([c]); const first = assessCompletionPath(state(), i);
  const deferred: CompletionInput = { ...i, cycleId: "deferred", at: "2026-10-23T00:01:00Z", responses: [{ notificationId: first.notifications[0].id, at: "2026-10-23T00:00:30Z", status: "deferred", receiptRef: "owner:1" }] };
  const second = assessCompletionPath(state(), deferred, [first]);
  const approved: CompletionInput = { ...deferred, cycleId: "approved", at: "2026-10-23T00:02:00Z", responses: [{ ...deferred.responses[0], at: "2026-10-23T00:01:30Z", status: "approved", receiptRef: "owner:2" }] };
  const third = assessCompletionPath(state(), approved, [first, second]);
  assert.equal(third.notifications[0].responses?.length, 2); assert.equal(third.notifications[0].response?.status, "approved");
  assert.equal(third.candidates[0].status, "HUMAN_REQUIRED");
  approved.cycleId = "conflict"; approved.responses[0].receiptRef = "owner:1";
  assert.throws(() => assessCompletionPath(state(), approved, [first, second, third]), /receipt conflict/);
});

test("persisted and read-only assessments agree after a canonical blocker resolves", async () => {
  const db = new CompassStore(":memory:"); const store = new CompassWorkStateStoreAdapter(db);
  try {
    const s = state(); s.blockers = ["spec_sync_pending:resolved"];
    await store.put(s);
    assert.deepEqual(await store.recordCompletionAssessment(input()), assessCompletionPath((await store.get(s.goalId))!, input()));
  } finally { db.close(); }
});

test("mixed, duplicate and out-of-order journals fail before folding Recovery history", () => {
  const i = input(); const first = assessCompletionPath(state(), i);
  const next = { ...i, cycleId: "next", at: "2026-10-23T00:01:00Z" };
  assert.throws(() => assessCompletionPath(state(), next, [{ ...first, contractDigest: "other-goal" }, first]), /history/);
  assert.throws(() => assessCompletionPath(state(), next, [first, first]), /history/);
  assert.throws(() => assessCompletionPath(state(), next, [{ ...first, cycleId: "later", at: "2026-10-23T00:02:00Z" }, first]), /history/);
  const bad = input(); bad.candidates[0].riskSignals = { unknownPermission: true } as never;
  assert.throws(() => assessCompletionPath(state(), bad), /unknown risk/);
});
