import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DevelopmentOrchestrator } from '../src/orchestrator/development-orchestrator.ts';
import { CompassStore } from '../src/compass/store.ts';
import { CompassWorkStateStoreAdapter } from '../src/orchestrator/compass-work-state-store.ts';
import { CompassStateStoreAdapter, compassGoalToLoopGoal } from '../src/orchestrator/compass-state-store.ts';
import { CompassGoalExecutionAdapter } from '../src/orchestrator/compass-goal-execution-adapter.ts';
import { createWorkStateIntegratedGoalLoop, goalWorkStateId } from '../src/orchestrator/work-state-integration.ts';
import { runBoundedGoalLoop } from '../src/orchestrator/bounded-runner.ts';
import type { Goal, Planner } from '../src/orchestrator/goal-loop.ts';
import { CompletionExecution, type CompletionSource } from '../src/orchestrator/completion-execution.ts';

test('existing DevelopmentPlan dependencies execute through Goal Loop and only independent final readback completes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'development-completion-')); const file = join(dir, 'artifact');
  const db = new CompassStore(join(dir, 'state.sqlite')); const store = new CompassWorkStateStoreAdapter(db);
  const goal: Goal = { title: 'Verify local artifact', successCriteria: ['file contains ready'], constraints: [] };
  const revision = 'a'.repeat(40); const digest = createHash('sha256').update('ready').digest('hex');
  const orchestrator = new DevelopmentOrchestrator();
  const plan = orchestrator.plan({ jobId: 'development', goalId: goalWorkStateId(goal), objective: goal.title, requirementIds: ['AUTO-026'], acceptanceCriteria: goal.successCriteria, baseRevision: revision, taskScopeId: '1858-isolated', maxRisk: 'low', targetFiles: ['src/fixture.ts'], contextDigest: 'c'.repeat(64) });
  const bindings = Object.fromEntries(plan.job.workItems.map((item, index) => [item.id, { criterionIds: ['criterion-1'], rationale: 'existing DevelopmentPlan dependency', evidenceRefs: ['issue:1858'], feasibility: 'available' as const, estimatedMinutes: 1, riskSignals: {}, humanActions: [], action: { id: item.id, description: item.objective, capability: index === 2 ? 'filesystem' : 'code-builder', risk: 'low' as const, input: { index } } }]));
  const source = orchestrator.completionSource(plan, {
    requirements: [{ criterionId: 'criterion-1', weight: 1, evidence: [{ kind: 'software', environment: 'isolated', sourceRevision: revision, artifactDigest: digest, trustedIssuers: ['independent-readback'] }] }], bindings,
    async capabilities() { return { 'code-builder': true, filesystem: true }; },
    async evidence() { return []; },
    async observe(record) { return record.action?.id === 'development:verify' && record.verification?.ok ? [{ id: 'readback', criterionId: 'criterion-1', kind: 'software', environment: 'isolated', sourceRevision: revision, artifactDigest: digest, issuer: 'independent-readback', verified: readFileSync(file, 'utf8') === 'ready', recordedAt: new Date().toISOString() }] : []; },
  });
  const planner: Planner = { async inferIntent() { return { summary: goal.title, confidence: 1, evidence: [{ source: 'goal', text: goal.title }] }; }, async proposeNextAction() { throw Error('unrelated planner route must not replace catalog action'); } };
  const executed: string[] = [];
  try {
    const loop = createWorkStateIntegratedGoalLoop({ goal, planner, contextSources: [], workStateStore: store, stateStore: new CompassStateStoreAdapter(db), completion: { source },
      executor: { async execute(action) { executed.push(action.id); if (action.id === 'development:test') writeFileSync(file, 'pending'); if (action.id === 'development:implement') writeFileSync(file, 'ready'); return { actionId: action.id, ok: true, summary: 'local fixture step' }; } },
      verifier: { async verify({ action }) { return { ok: readFileSync(file, 'utf8') === (action.id === 'development:test' ? 'pending' : 'ready'), summary: 'independent readback' }; } },
    });
    const report = await runBoundedGoalLoop(loop, goal, { maxCycles: 4 });
    assert.deepEqual(executed, ['development:test', 'development:implement', 'development:verify']);
    assert.equal(report.stopReason, 'goal_complete');
    const history = await store.getCompletionHistory(goalWorkStateId(goal));
    assert.equal(history[3].verifiedCriteria.length, 0, 'implementation output is not independent final acceptance');
    assert.deepEqual(history.at(-1)!.verifiedCriteria, ['criterion-1']);
    assert.equal((await store.get(goalWorkStateId(goal)))?.status, 'COMPLETED');
  } finally { db.close(); }
});

test('planning roles bind existing registry names and true risk cannot be masked by false', async () => {
  const db = new CompassStore(':memory:'); const store = new CompassWorkStateStoreAdapter(db);
  try {
    const orchestrator = new DevelopmentOrchestrator();
    const goal: Goal = { title: 'Mapped development', successCriteria: ['verified change'], constraints: [] };
    const id = goalWorkStateId(goal);
    const plan = orchestrator.plan({ jobId: 'mapped', goalId: id, objective: goal.title, requirementIds: ['AUTO-026'], acceptanceCriteria: goal.successCriteria, baseRevision: 'a'.repeat(40), taskScopeId: '1858-isolated', maxRisk: 'low', targetFiles: ['src/fixture.ts'], contextDigest: 'c'.repeat(64) });
    await store.put({ goalId: id, objective: goal.title, definitionOfDone: plan.job.definitionOfDone, constraints: [], currentState: '', status: 'NOT_STARTED', riskClass: 'R0', decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers: [], nextAction: null, updatedAt: new Date().toISOString() });
    const bindings = Object.fromEntries(plan.job.workItems.map((item, i) => [item.id, { criterionIds: ['criterion-1'], rationale: 'existing development dependency', evidenceRefs: ['issue:1858'], feasibility: 'available' as const, estimatedMinutes: 1, riskSignals: {}, humanActions: [], action: { id: item.id, description: item.objective, capability: i === 2 ? 'context.inspect' : 'code.builder', risk: 'low' as const, riskSignals: { permissionChange: false } } }]));
    const input = { bindings, capabilityBindings: { 'code-builder': 'code.builder', filesystem: 'context.inspect' }, requirements: [{ criterionId: 'criterion-1', weight: 1, evidence: [{ kind: 'software', environment: 'isolated', sourceRevision: 'a'.repeat(40), artifactDigest: 'b'.repeat(64), trustedIssuers: ['verifier'] }] }], async capabilities() { return { 'code.builder': true, 'context.inspect': true }; }, async evidence() { return []; }, async observe() { return []; } };
    const control = new CompletionExecution(store, orchestrator.completionSource(plan, input));
    assert.equal((await control.propose(goal))?.capability, 'code.builder');
    bindings['mapped:test'].riskSignals = { permissionChange: true };
    assert.throws(() => orchestrator.completionSource(plan, input), /approval scope/);
  } finally { db.close(); }
});

test('real Compass execution adapter uses existing capability and durable observation after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'completion-adapter-')); const dbPath = join(dir, 'state.sqlite');
  const db = new CompassStore(dbPath);
  const goal = compassGoalToLoopGoal(db.setGoal({ title: 'Read supplied status', successCriteria: ['status inspected'], constraints: ['read-only local test'] }));
  db.updateState({ status: 'READY', blockers: [] }); db.close();
  const source: CompletionSource = {
    async inspect() { return { requirements: [{ criterionId: 'criterion-1', weight: 1, evidence: [{ kind: 'software', environment: 'isolated', sourceRevision: 'a'.repeat(40), artifactDigest: 'b'.repeat(64), trustedIssuers: ['context-readback'] }] }], capabilities: { 'context.inspect': true }, evidence: [], candidates: [{ workItem: { id: 'inspect', objective: 'Read status', requiredCapabilities: ['context.inspect'], dependsOn: [] }, criterionIds: ['criterion-1'], strategyId: 'read-only', rationale: 'required status evidence', evidenceRefs: ['issue:1858'], feasibility: 'available', estimatedMinutes: 1, riskSignals: {}, humanActions: [], action: { id: 'inspect', capability: 'context.inspect', description: 'Read status', risk: 'low' } }] }; },
    async observe(record) { const context = (record.result?.evidence as { context?: string })?.context; assert.ok(context?.includes('unified-entry:1:fixture status expected')); return [{ id: 'status-readback', criterionId: 'criterion-1', kind: 'software', environment: 'isolated', sourceRevision: 'a'.repeat(40), artifactDigest: 'b'.repeat(64), issuer: 'context-readback', verified: record.verification?.ok === true, recordedAt: new Date().toISOString() }]; },
  };
  const first = await new CompassGoalExecutionAdapter(dbPath, {}, {}, undefined, source).run(goalWorkStateId(goal), { maxCycles: 1, context: ['fixture status expected'] });
  assert.equal(first.cycles[0].action?.capability, 'context.inspect'); assert.equal(first.cycles[0].verification?.ok, true);
  const resumed = await new CompassGoalExecutionAdapter(dbPath, {}, {}, undefined, source).run(goalWorkStateId(goal), { maxCycles: 1 });
  assert.equal(resumed.stopReason, 'goal_complete'); assert.equal(resumed.cycles[0].action, null);
  const reopened = new CompassStore(dbPath);
  try { assert.equal((await new CompassWorkStateStoreAdapter(reopened).get(goalWorkStateId(goal)))?.status, 'COMPLETED'); } finally { reopened.close(); }
});
