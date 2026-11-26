import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompassStore } from '../src/compass/store.ts';
import { CompassWorkStateStoreAdapter } from '../src/orchestrator/compass-work-state-store.ts';
import { compassGoalToLoopGoal } from '../src/orchestrator/compass-state-store.ts';
import { CompassGoalExecutionAdapter } from '../src/orchestrator/compass-goal-execution-adapter.ts';
import { completionDigest } from '../src/orchestrator/completion-path.ts';
import { goalWorkStateId } from '../src/orchestrator/work-state-integration.ts';
import { loadCompletionRuntimeHandoff } from '../src/orchestrator/completion-runtime-handoff.ts';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { CompassWorkRunStore } from '../src/orchestrator/compass-work-run-store.ts';
import { createQueuedWorkRun } from '../src/orchestrator/work-run-state.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'completion-handoff-')), dbPath = join(root, 'state.sqlite');
  const db = new CompassStore(dbPath);
  const goal = compassGoalToLoopGoal(db.setGoal({ title: 'Verify existing file', successCriteria: ['artifact bytes equal accepted text'], constraints: ['No model API or overwrite'] }));
  db.updateState({ status: 'READY', blockers: [] }); db.close();
  const goalId = goalWorkStateId(goal), revision = 'a'.repeat(40), file = join(root, 'handoff.json');
  writeFileSync(join(root, 'artifact.txt'), 'accepted bytes');
  const handoff = { version: 1, goalId, goalDigest: completionDigest(goal), dataRootDigest: sha(realpathSync(root)), sourceRevision: revision, expiresAt: new Date(Date.now() + 3600000).toISOString(),
    requirements: [{ criterionId: 'criterion-1', weight: 1, evidence: [{ kind: 'software', environment: 'host-local-artifact:artifact.txt', sourceRevision: revision, artifactDigest: sha('accepted bytes'), trustedIssuers: ['completion-local-sha256-v1'] }] }],
    candidates: [{ workItem: { id: 'inspect', objective: 'Inspect accepted artifact', requiredCapabilities: ['context.inspect'], dependsOn: [] }, criterionIds: ['criterion-1'], strategyId: 'readback', rationale: 'required artifact condition', evidenceRefs: ['issue:1858'], feasibility: 'available', estimatedMinutes: 1, riskSignals: {}, humanActions: [], action: { id: 'inspect', description: 'Inspect accepted artifact', capability: 'context.inspect', risk: 'low' } }],
    checks: [{ criterionId: 'criterion-1', taskId: 'inspect', path: 'artifact.txt', expectedSha256: sha('accepted bytes') }] };
  const env: Record<string,string> = { GORIQ_COMPLETION_HANDOFF_PATH: file, GORIQ_COMPLETION_DATA_ROOT: root, GORIQ_RUNTIME_REVISION: revision };
  function save() { const bytes = JSON.stringify(handoff); writeFileSync(file, bytes); env.GORIQ_COMPLETION_HANDOFF_SHA256 = sha(bytes); }
  save(); return { root, file, dbPath, goal, goalId, handoff, env, save };
}

test('host handoff drives existing adapter and independently verifies actual bytes across restart', async () => {
  const f = fixture();
  let source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal); assert.ok(source);
  const first = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 1 });
  assert.equal(first.cycles[0].action?.capability, 'context.inspect');
  source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  const resumed = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 1 });
  assert.equal(resumed.stopReason, 'goal_complete'); assert.equal(resumed.cycles[0].action, null);
  const db = new CompassStore(f.dbPath); try { const s = new CompassWorkStateStoreAdapter(db); assert.equal((await s.get(f.goalId))?.status, 'COMPLETED'); assert.equal((await s.getCompletionHistory(f.goalId)).at(-1)?.verifiedCriteria.length, 1); } finally { db.close(); }
});

test('absent setting preserves default; wrong pin, revision, Goal, expiry and path fail closed', async () => {
  const f = fixture(); assert.equal(await loadCompletionRuntimeHandoff({}, f.goalId, f.goal), undefined);
  await assert.rejects(loadCompletionRuntimeHandoff({ ...f.env, GORIQ_COMPLETION_HANDOFF_SHA256: '0'.repeat(64) }, f.goalId, f.goal), /digest/);
  await assert.rejects(loadCompletionRuntimeHandoff({ ...f.env, GORIQ_RUNTIME_REVISION: 'b'.repeat(40) }, f.goalId, f.goal), /revision/);
  await assert.rejects(loadCompletionRuntimeHandoff(f.env, f.goalId, { ...f.goal, successCriteria: ['different'] }), /Goal/);
  f.handoff.expiresAt = '2020-01-01T00:00:00Z'; f.save(); await assert.rejects(loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal), /expired/);
  f.handoff.expiresAt = new Date(Date.now() + 3600000).toISOString(); f.handoff.checks[0].path = '../outside'; f.save(); await assert.rejects(loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal), /path/);
});

test('changed artifact invalidates previous PASS and edited handoff cannot execute', async () => {
  const f = fixture(); let source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 2 });
  writeFileSync(join(f.root, 'artifact.txt'), 'changed');
  source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  const report = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 1 });
  assert.notEqual(report.stopReason, 'goal_complete'); assert.equal(report.goalEvaluation?.achieved, false);
  writeFileSync(f.file, '{}'); await assert.rejects(source!.inspect({} as never), /digest/);
});

test('local bytes never satisfy the separate physical evidence requirement', async () => {
  const f = fixture();
  f.handoff.requirements[0].evidence.push({ kind: 'physical', environment: 'real-device', sourceRevision: 'a'.repeat(40), artifactDigest: sha('accepted bytes'), trustedIssuers: ['physical-acceptance'] }); f.save();
  const source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  const report = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 2 });
  assert.notEqual(report.stopReason, 'goal_complete');
  assert.equal(report.goalEvaluation?.achieved, false);
});

test('failed independent readback remains retryable after artifact correction and restart', async () => {
  const f = fixture(); writeFileSync(join(f.root, 'artifact.txt'), 'wrong');
  let source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  const failed = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 1 });
  assert.equal(failed.goalEvaluation?.achieved, false);
  const db = new CompassStore(f.dbPath);
  assert.deepEqual((await new CompassWorkStateStoreAdapter(db).getCompletionExecution(f.goalId))?.completedTasks, []); db.close();
  writeFileSync(join(f.root, 'artifact.txt'), 'accepted bytes');
  source = await loadCompletionRuntimeHandoff(f.env, f.goalId, f.goal);
  const repaired = await new CompassGoalExecutionAdapter(f.dbPath, {}, {}, undefined, source).run(f.goalId, { maxCycles: 2 });
  assert.equal(repaired.stopReason, 'goal_complete');
});

test('resident executor consumes the pinned handoff and fails closed on tampering', async () => {
  const f = fixture();
  let db = new CompassStore(f.dbPath);
  await new CompassWorkRunStore(db).put(createQueuedWorkRun(f.goalId)); db.close();
  const env = { ...process.env, ...f.env, GORIQ_SELF_DEVELOPMENT_RUNTIME: '', JARVIS_GOAL_EXECUTION_GOAL_ID: f.goalId, JARVIS_GOAL_EXECUTION_COMPASS_PATH: f.dbPath, JARVIS_GOAL_EXECUTION_CONTEXT_B64: Buffer.from(JSON.stringify([{ intent: 'DEVELOPMENT_TASK' }])).toString('base64') };
  const run = () => spawnSync(process.execPath, ['scripts/jarvis-goal-executor.ts'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const result = run(); assert.equal(result.status, 0, result.stderr);
  db = new CompassStore(f.dbPath);
  assert.equal((await new CompassWorkRunStore(db).getByGoal(f.goalId))?.phase, 'COMPLETED');
  assert.ok((await new CompassWorkStateStoreAdapter(db).getCompletionHistory(f.goalId)).some(c => c.verifiedCriteria.length === 1));
  db.close();
  const bad = fixture(); db = new CompassStore(bad.dbPath); await new CompassWorkRunStore(db).put(createQueuedWorkRun(bad.goalId)); db.close();
  Object.assign(env, bad.env, { JARVIS_GOAL_EXECUTION_GOAL_ID: bad.goalId, JARVIS_GOAL_EXECUTION_COMPASS_PATH: bad.dbPath });
  writeFileSync(bad.file, '{}');
  const denied = run(); assert.equal(denied.status, 1); assert.match(denied.stderr, /digest mismatch/);
  db = new CompassStore(bad.dbPath); assert.equal((await new CompassWorkRunStore(db).getByGoal(bad.goalId))?.phase, 'BLOCKED'); db.close();
});

test('Broker startup executes the host handoff and owner status survives restart without repeating work', { timeout: 20000 }, async () => {
  const f = fixture();
  const db = new CompassStore(f.dbPath); await new CompassWorkRunStore(db).put(createQueuedWorkRun(f.goalId)); db.close();
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as {port:number}).port; await new Promise<void>(r => socket.close(() => r()));
  const env = { ...process.env, ...f.env, GITHUB_TOKEN: '', GORIQ_SELF_DEVELOPMENT_RUNTIME: '', JARVIS_PRODUCTION_CONFIG: '', JARVIS_BROKER_HOST: '127.0.0.1', JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: 'completion-runtime-test-owner', JARVIS_DB_PATH: join(f.root, 'broker.sqlite'), JARVIS_COMPASS_DB_PATH: f.dbPath, JARVIS_PUBLIC_BROKER_URL: '', JARVIS_WORKER_INSTALL_URL: '', JARVIS_WORKER_APK_PATH: '' };
  const url = `http://127.0.0.1:${port}/api/jarvis/admin/work/${f.goalId}`;
  const headers = { Authorization: 'Bearer completion-runtime-test-owner' };
  let firstCycle = '';
  for (let start = 0; start < 2; start++) {
    const child = spawn(process.execPath, ['scripts/jarvis-broker.ts'], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = ''; child.stderr.on('data', c => { errors += String(c); });
    try {
      let status;
      for (let n = 0; n < 100; n++) {
        try {
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(500) });
          if (response.ok) status = await response.json();
          if (status?.run?.phase === 'COMPLETED') break;
        } catch { /* bounded process startup */ }
        await new Promise(r => setTimeout(r, 50));
      }
      assert.equal(status?.run?.phase, 'COMPLETED', errors);
      assert.deepEqual(status.completion.verifiedCriteria, ['criterion-1']);
      assert.equal((await fetch(url)).status, 401);
      if (start === 0) firstCycle = status.completion.cycleId;
      else assert.equal(status.completion.cycleId, firstCycle);
    } finally { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } }
  }
});
