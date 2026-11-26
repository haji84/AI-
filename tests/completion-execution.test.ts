import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CompassStore } from '../src/compass/store.ts';
import { CompassWorkStateStoreAdapter } from '../src/orchestrator/compass-work-state-store.ts';
import { CompassStateStoreAdapter } from '../src/orchestrator/compass-state-store.ts';
import { createWorkStateIntegratedGoalLoop, goalWorkStateId } from '../src/orchestrator/work-state-integration.ts';
import { CompletionExecution, type CompletionSource, type BoundCompletionCandidate } from '../src/orchestrator/completion-execution.ts';
import type { Goal, Planner } from '../src/orchestrator/goal-loop.ts';

const goal: Goal = { title: 'Finish isolated artifact', successCriteria: ['artifact contains ready', 'physical interaction'], constraints: ['no public network'] };
const revision = 'a'.repeat(40);
const artifactDigest = createHash('sha256').update('ready').digest('hex');
const planner: Planner = {
  async inferIntent() { return { summary: 'Complete the accepted conditions', confidence: 1, evidence: [{ source: 'goal', text: goal.title }] }; },
  async proposeNextAction() { return { id: 'fluff', capability: 'fixture.write', description: 'unrelated', risk: 'low', input: { value: 'unrelated' } }; },
};
function candidate(id: string, criterionIds = ['criterion-1']): BoundCompletionCandidate {
  return { workItem: { id, objective: id, dependsOn: [], requiredCapabilities: ['fixture.write'] }, criterionIds,
    strategyId: id, rationale: 'accepted missing condition', evidenceRefs: ['issue:1858'], feasibility: 'available', estimatedMinutes: 1,
    riskSignals: {}, humanActions: [], action: { id, capability: 'fixture.write', description: id, risk: 'low', input: { value: 'ready' } } };
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'completion-execution-'));
  const dbPath = join(dir, 'compass.sqlite');
  let db = new CompassStore(dbPath);
  let store = new CompassWorkStateStoreAdapter(db);
  let tick = Date.parse('2026-10-23T10:00:00Z');
  const now = () => new Date(tick += 1000).toISOString();
  const gated = candidate('permission', ['criterion-2']); gated.riskSignals.permissionChange = true;
  const candidates = [candidate('fluff', []), gated, candidate('useful')];
  const source: CompletionSource = {
    async inspect() { return { requirements: [1, 2].map(n => ({ criterionId: `criterion-${n}`, weight: n,
      evidence: [{ kind: n === 1 ? 'software' : 'physical', environment: n === 1 ? 'isolated' : 'device', sourceRevision: revision, artifactDigest, trustedIssuers: ['readback'] }] })), candidates,
      capabilities: { 'fixture.write': true }, evidence: [] }; },
    async observe({ verification }) { return verification?.ok ? [{ id: 'artifact-readback', criterionId: 'criterion-1', kind: 'software', environment: 'isolated', issuer: 'readback', verified: readFileSync(join(dir, 'artifact'), 'utf8') === 'ready', sourceRevision: revision, artifactDigest, recordedAt: now() }] : []; },
  };
  let executions = 0;
  const loop = (approvalKey?: string, enabled = true) => createWorkStateIntegratedGoalLoop({ goal, planner, contextSources: [], workStateStore: store, options: { approvedActionKey: approvalKey },
    stateStore: new CompassStateStoreAdapter(db), ...(enabled ? { completion: { source, now } } : {}),
    executor: { async execute(action) { executions++; writeFileSync(join(dir, 'artifact'), (action.input as {value:string}).value); return { actionId: action.id, ok: true, summary: 'wrote isolated artifact', definitionOfDoneResults: [{ itemId: 'criterion-2', passed: true }] }; } },
    verifier: { async verify() { return { ok: readFileSync(join(dir, 'artifact'), 'utf8') === 'ready', summary: 'independent file readback' }; } },
  });
  return { dir, dbPath, source, candidates, now, loop, executions: () => executions, get store() { return store; }, get db() { return db; },
    restart() { db.close(); db = new CompassStore(dbPath); store = new CompassWorkStateStoreAdapter(db); }, close() { db.close(); } };
}

test('integrated loop executes useful work, retains Human Gate, and rejects executor physical PASS', async () => {
  const f = fixture();
  try {
    const result = await f.loop().runCycle({ goal });
    assert.equal(result.action?.id, 'useful'); assert.equal(f.executions(), 1);
    const state = await f.store.get(goalWorkStateId(goal));
    assert.equal(state?.verificationResults.find(r => r.itemId === 'criterion-1')?.passed, true);
    assert.notEqual(state?.verificationResults.find(r => r.itemId === 'criterion-2')?.passed, true);
    const cycle = (await f.store.getCompletionHistory(goalWorkStateId(goal))).at(-1)!;
    assert.equal(cycle.readyForCompletionReview, false);
    assert.equal(cycle.notifications[0].status, 'PREPARED');
    f.restart();
    const resumed = await f.loop().runCycle({ goal });
    assert.equal(f.executions(), 1); assert.notEqual(resumed.stopReason, 'goal_complete');
    assert.ok((await f.store.getCompletionHistory(goalWorkStateId(goal))).at(-1)!.candidates.some(c => c.taskId === 'permission' && c.status === 'HUMAN_REQUIRED'));
  } finally { f.close(); }
});

test('action mutation, capability loss and interrupted execution fail closed across restart', async () => {
  const f = fixture();
  try {
    await f.loop().runCycle({ goal }); // establishes existing authoritative WorkState
    const different = candidate('second'); f.candidates.push(different);
    // A different host contract cannot silently replace an already executed one.
    await assert.rejects(f.loop().runCycle({ goal }), /contract/);
    f.candidates.pop();
    const checkpoint = await f.store.getCompletionExecution(goalWorkStateId(goal));
    await f.store.updateCompletionExecution(goalWorkStateId(goal), checkpoint, { ...checkpoint!, pending: { taskId: 'useful', actionDigest: 'c'.repeat(64), cycleId: 'interrupted' } });
    f.restart();
    await assert.rejects(f.loop().runCycle({ goal }), /pending|reconcil/);
    assert.equal(f.executions(), 1);
  } finally { f.close(); }
});

test('only displayed known notices get idempotent receipts; client cannot approve a task', async () => {
  const f = fixture();
  try {
    await f.loop().runCycle({ goal });
    const id = goalWorkStateId(goal);
    const current = (await f.store.getCompletionHistory(id)).at(-1)!;
    assert.equal(current.notifications[0].status, 'PREPARED');
    await assert.rejects(f.store.acknowledgeCompletionNotifications(id, { cycleId: current.cycleId, notificationIds: ['unknown'] }, f.now()), /notification/);
    await assert.rejects(f.store.acknowledgeCompletionNotifications(id, { cycleId: current.cycleId, notificationIds: [current.notifications[0].id], approved: true } as never, f.now()), /receipt/);
    await f.store.acknowledgeCompletionNotifications(id, { cycleId: current.cycleId, notificationIds: [current.notifications[0].id] }, f.now());
    const first = (await f.store.getCompletionHistory(id)).at(-1)!;
    await f.store.acknowledgeCompletionNotifications(id, { cycleId: current.cycleId, notificationIds: [current.notifications[0].id] }, f.now());
    assert.equal((await f.store.getCompletionHistory(id)).length, 3);
    f.restart();
    const last = (await f.store.getCompletionHistory(id)).at(-1)!;
    assert.deepEqual(last.notifications, first.notifications);
    assert.equal(last.notifications[0].status, 'DELIVERED');
    assert.equal(last.notifications[0].response, undefined);
  } finally { f.close(); }
});

test('exact action binding guards input and risk before executor side effects', async () => {
  const f = fixture();
  try {
    // Initialize through an ordinary paused-free loop; then use the same controller guard directly.
    await f.loop().runCycle({ goal });
    const checkpoint = await f.store.getCompletionExecution(goalWorkStateId(goal));
    await f.store.updateCompletionExecution(goalWorkStateId(goal), checkpoint, { ...checkpoint!, completedTasks: [], evidence: [] });
    const control = new CompletionExecution(f.store, f.source, f.now);
    const action = await control.propose(goal);
    assert.ok(action);
    await assert.rejects(control.beforeExecute({ ...action, input: { value: 'changed' } }, goal), /binding/);
    assert.equal(f.executions(), 1);
  } finally { f.close(); }
});

test('failed strategy replans after restart and a different verified action makes progress', async () => {
  const f = fixture();
  try {
    f.candidates.find(c => c.workItem.id === 'useful')!.action.input = { value: 'wrong' };
    const alternate = candidate('alternative'); alternate.estimatedMinutes = 2;
    f.candidates.push(alternate);
    for (let i = 0; i < 3; i++) {
      const r = await f.loop().runCycle({ goal });
      assert.equal(r.action?.id, 'useful'); assert.equal(r.verification?.ok, false);
      if (i === 1) f.restart();
    }
    const replanned = await f.loop().runCycle({ goal });
    assert.equal(replanned.action?.id, 'alternative'); assert.equal(replanned.verification?.ok, true);
    const history = await f.store.getCompletionHistory(goalWorkStateId(goal));
    assert.ok(history.some(c => c.replanRequired));
    assert.equal(history.at(-1)!.metrics.verifiedDelta, 1);
    assert.equal(history.at(-1)!.metrics.unproductiveAttempts, 3);
  } finally { f.close(); }
});

test('changing capability between planning and execution prevents any new action', async () => {
  const f = fixture();
  try {
    await f.loop().runCycle({ goal });
    const checkpoint = await f.store.getCompletionExecution(goalWorkStateId(goal));
    await f.store.updateCompletionExecution(goalWorkStateId(goal), checkpoint, { ...checkpoint!, completedTasks: [], evidence: [] });
    const control = new CompletionExecution(f.store, f.source, f.now);
    const action = await control.propose(goal); assert.ok(action);
    const inspect = f.source.inspect;
    f.source.inspect = async state => ({ ...await inspect(state), capabilities: { 'fixture.write': false } });
    await assert.rejects(control.beforeExecute(action, goal), /capability/);
    assert.equal((await f.store.getCompletionExecution(goalWorkStateId(goal)))?.pending, null);
  } finally { f.close(); }
});

test('existing exact-action Human Gate supplies approval and its durable response, not UI receipts', async () => {
  const f = fixture();
  try {
    await f.loop().runCycle({ goal });
    const waiting = await f.loop().runCycle({ goal });
    assert.equal(waiting.stopReason, 'approval_required');
    assert.ok(waiting.approvalKey); assert.equal(f.executions(), 1);
    const completed = await f.loop(waiting.approvalKey).runCycle({ goal });
    assert.equal(completed.action?.id, 'permission'); assert.equal(completed.approvalSatisfied, true);
    const latest = (await f.store.getCompletionHistory(goalWorkStateId(goal))).at(-1)!;
    assert.equal(latest.notifications[0].response?.status, 'approved');
    assert.ok(latest.notifications[0].response?.receiptRef.startsWith('goal-loop-approval:'));
    assert.equal(latest.readyForCompletionReview, false, 'approval is not physical evidence');
  } finally { f.close(); }
});

test('same isolated artifact case compares existing Planner with completion selection using actual readback', async t => {
  const baseline = fixture(); const enabled = fixture();
  try {
    const before = await baseline.loop(undefined, false).runCycle({ goal });
    const after = await enabled.loop().runCycle({ goal });
    const beforeVerified = Number(readFileSync(join(baseline.dir, 'artifact'), 'utf8') === 'ready');
    const afterVerified = Number(readFileSync(join(enabled.dir, 'artifact'), 'utf8') === 'ready');
    assert.equal(beforeVerified, 0); assert.equal(afterVerified, 1);
    assert.equal(before.action?.id, 'fluff'); assert.equal(after.action?.id, 'useful');
    assert.equal(before.verification?.ok, false); assert.equal(after.verification?.ok, true);
    assert.equal((await baseline.store.getCompletionHistory(goalWorkStateId(goal))).length, 0);
    const history = await enabled.store.getCompletionHistory(goalWorkStateId(goal));
    assert.equal(history[0].notifications.length, 1, 'notice is prepared before useful action executes');
    t.diagnostic(JSON.stringify({ scenario: 'same synthetic Goal, real SQLite + file execution/readback', baseline: { verifiedSoftwareCriteria: beforeVerified, wastedSelections: 1, earlyNoticeRecorded: false }, integrated: { verifiedSoftwareCriteria: afterVerified, wastedSelections: 0, earlyNoticeRecorded: true }, physicalCriteriaAdvanced: 0, productionTimingImprovementMeasured: false }));
  } finally { baseline.close(); enabled.close(); }
});

test('explicit approval notice uses the existing approval handshake', async () => {
  const f = fixture();
  try {
    f.candidates.splice(0, f.candidates.length, candidate('explicit'));
    f.candidates[0].humanActions = [{ kind: 'approval', operation: 'Approve fixture', reason: 'Owner review required', target: 'fixture', deadline: null, impact: 'Wait for exact approval' }];
    const waiting = await f.loop().runCycle({ goal });
    assert.equal(waiting.stopReason, 'approval_required'); assert.ok(waiting.approvalKey);
    assert.equal(f.executions(), 0);
    await f.loop(waiting.approvalKey).runCycle({ goal });
    assert.equal(f.executions(), 1);
  } finally { f.close(); }
});

test('completion preserves explicit Child Work Item mutation binding', async () => {
  const f = fixture();
  try {
    await f.loop(undefined, false).runCycle({ goal });
    const state = (await f.store.get(goalWorkStateId(goal)))!;
    state.childWorkItems.push({ id: 'closed', objective: 'closed', definitionOfDone: [{ id: 'done', description: 'done' }], affectedScope: ['fixture'], executionApproach: 'fixture', verificationMethod: 'fixture', status: 'COMPLETED' });
    await f.store.put(state);
    Object.assign(f.candidates.find(c => c.workItem.id === 'useful')!.action, { materialMutation: true, workItemId: 'closed', completesWorkItem: true });
    const r = await f.loop().runCycle({ goal });
    assert.equal(r.result?.blocker, 'bound_work_item_not_active');
    assert.equal(f.executions(), 1);
  } finally { f.close(); }
});

test('reservation rejects concurrent authoritative state changes during inspection', async () => {
  const f = fixture();
  try {
    const inspect = f.source.inspect; let calls = 0;
    f.source.inspect = async state => {
      if (++calls === 2) await f.store.put({ ...state, blockers: ['owner-stop'], status: 'BLOCKED' });
      return inspect(state);
    };
    await assert.rejects(f.loop().runCycle({ goal }), /stale state|state conflict/);
    assert.equal(f.executions(), 0);
    assert.deepEqual((await f.store.get(goalWorkStateId(goal)))?.blockers, ['owner-stop']);
    assert.equal((await f.store.getCompletionExecution(goalWorkStateId(goal)))?.pending, null);
  } finally { f.close(); }
});

test('finalization rejects concurrent stop without losing pending action or advancing criteria', async () => {
  const f = fixture();
  try {
    const observe = f.source.observe;
    f.source.observe = async record => {
      const state = (await f.store.get(goalWorkStateId(goal)))!;
      await f.store.put({ ...state, blockers: ['owner-stop'], status: 'BLOCKED' });
      return observe(record);
    };
    await assert.rejects(f.loop().runCycle({ goal }), /stale state|state conflict/);
    const state = (await f.store.get(goalWorkStateId(goal)))!;
    assert.deepEqual(state.blockers, ['owner-stop']); assert.equal(state.status, 'BLOCKED');
    assert.notEqual(state.verificationResults.find(r => r.itemId === 'criterion-1')?.passed, true);
    assert.ok((await f.store.getCompletionExecution(state.goalId))?.pending);
    assert.equal((await f.store.getCompletionHistory(state.goalId)).length, 1);
  } finally { f.close(); }
});

test('transaction failure cannot publish partial completion or clear pending execution', async () => {
  const f = fixture();
  try {
    const original = f.db.updateActive.bind(f.db);
    const observe = f.source.observe;
    f.source.observe = async record => {
      f.db.updateActive = transform => original(active => {
        const next = transform(active);
        throw Error(`simulated commit failure after transform:${next.length}`);
      });
      return observe(record);
    };
    await assert.rejects(f.loop().runCycle({ goal }), /simulated commit failure/);
    f.db.updateActive = original;
    f.restart();
    const state = (await f.store.get(goalWorkStateId(goal)))!;
    assert.notEqual(state.status, 'COMPLETED');
    assert.notEqual(state.verificationResults.find(r => r.itemId === 'criterion-1')?.passed, true);
    assert.ok((await f.store.getCompletionExecution(state.goalId))?.pending);
    assert.equal((await f.store.getCompletionHistory(state.goalId)).length, 1);
    await assert.rejects(f.loop().runCycle({ goal }), /pending.*reconciliation/);
    assert.equal(f.executions(), 1);
  } finally { f.close(); }
});

test('stale completion assessment never publishes goal_complete after owner stop', async () => {
  const f = fixture();
  try {
    const inspect = f.source.inspect;
    f.source.inspect = async state => ({ ...await inspect(state), evidence: [1, 2].map(n => ({ id: `existing-${n}`, criterionId: `criterion-${n}`, kind: n === 1 ? 'software' : 'physical', environment: n === 1 ? 'isolated' : 'device', issuer: 'readback', verified: true, sourceRevision: revision, artifactDigest, recordedAt: '2026-10-23T09:00:00Z' })) });
    const real = new CompassStateStoreAdapter(f.db);
    const loop = createWorkStateIntegratedGoalLoop({ goal, planner, contextSources: [], workStateStore: f.store, completion: { source: f.source, now: f.now }, stateStore: { getState: () => real.getState(), writeBack: r => real.writeBack(r), async completionBlockers() { const s = (await f.store.get(goalWorkStateId(goal)))!; await f.store.put({ ...s, blockers: ['owner-stop'], status: 'BLOCKED' }); return []; } }, executor: { async execute() { throw Error('must not execute'); } }, verifier: { async verify() { throw Error('must not verify'); } } });
    await assert.rejects(loop.runCycle({ goal }), /stale|conflict/);
    assert.notEqual(f.db.getState().status, 'goal_complete');
    assert.deepEqual((await f.store.get(goalWorkStateId(goal)))?.blockers, ['owner-stop']);
  } finally { f.close(); }
});

test('new failed observation revokes authoritative PASS before a repair can fail', async () => {
  const f = fixture();
  try {
    const inspect = f.source.inspect; let passing = true;
    f.source.inspect = async state => ({ ...await inspect(state), evidence: [1, 2].map(n => ({ id: `existing-${n}`, criterionId: `criterion-${n}`, kind: n === 1 ? 'software' : 'physical', environment: n === 1 ? 'isolated' : 'device', issuer: 'readback', verified: passing, sourceRevision: revision, artifactDigest, recordedAt: passing ? '2026-10-23T09:00:00Z' : '2026-10-23T09:01:00Z' })) });
    assert.equal((await f.loop().runCycle({ goal })).stopReason, 'goal_complete');
    passing = false;
    f.source.observe = async () => { throw Error('observer unavailable'); };
    await assert.rejects(f.loop().runCycle({ goal }), /observer unavailable/);
    f.restart();
    const state = (await f.store.get(goalWorkStateId(goal)))!;
    assert.notEqual(state.status, 'COMPLETED');
    assert.equal(state.verificationResults.some(r => r.passed), false);
    assert.ok((await f.store.getCompletionExecution(state.goalId))?.pending);
  } finally { f.close(); }
});

test('a legacy waiver cannot survive missing evidence and interrupted repair', async () => {
  const f = fixture();
  try {
    await f.loop(undefined, false).runCycle({ goal });
    const state = (await f.store.get(goalWorkStateId(goal)))!;
    await f.store.put({ ...state, verificationResults: state.definitionOfDone.map(c => ({ itemId: c.id, passed: false, waived: true })), status: 'COMPLETED' });
    f.source.observe = async () => { throw Error('observer unavailable'); };
    await assert.rejects(f.loop().runCycle({ goal }), /observer unavailable/);
    const after = (await f.store.get(state.goalId))!;
    assert.notEqual(after.status, 'COMPLETED');
    assert.ok(after.verificationResults.every(v => !v.passed && !v.waived));
  } finally { f.close(); }
});
