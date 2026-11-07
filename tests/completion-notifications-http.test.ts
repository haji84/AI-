import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { CompassStore } from '../src/compass/store.ts';
import { CompassWorkStateStoreAdapter } from '../src/orchestrator/compass-work-state-store.ts';
import { CompassWorkRunStore } from '../src/orchestrator/compass-work-run-store.ts';
import { createQueuedWorkRun } from '../src/orchestrator/work-run-state.ts';

test('real Broker owner route displays notices and acknowledges only displayed IDs without approval', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'completion-http-')); const path = join(dir, 'compass.sqlite');
  const db = new CompassStore(path); const store = new CompassWorkStateStoreAdapter(db);
  const goalId = 'goal-notification-test'; const at = new Date(Date.now() - 1000).toISOString();
  await store.put({ goalId, objective: 'physical acceptance', definitionOfDone: [{ id: 'physical', description: 'real device', required: true }], constraints: [], status: 'NOT_STARTED', riskClass: 'R1', decisions: [], artifacts: [], verificationResults: [], childWorkItems: [], blockers: [], currentState: '', updatedAt: at });
  await new CompassWorkRunStore(db).put(createQueuedWorkRun(goalId));
  const cycle = await store.recordCompletionAssessment({ goalId, cycleId: 'initial', at, requirements: [], evidence: [], capabilities: {}, completedWorkItems: [], responses: [], deliveries: [], candidates: [{ workItem: { id: 'device', objective: 'phone operation', dependsOn: [], requiredCapabilities: [] }, criterionIds: ['physical'], strategyId: 'device', rationale: 'required real operation', evidenceRefs: ['issue:1858'], estimatedMinutes: 5, feasibility: 'unavailable', riskSignals: {}, humanActions: [{ kind: 'physical_operation', operation: 'Allow screen sharing', reason: 'OS consent', target: 'nubia', deadline: null, impact: 'physical acceptance remains incomplete' }] }] });
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
  const child = spawn(process.execPath, ['scripts/jarvis-broker.ts'], { env: { ...process.env, GITHUB_TOKEN: '', JARVIS_BROKER_HOST: '127.0.0.1', JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: 'fixture-completion-owner', JARVIS_DB_PATH: join(dir, 'broker.sqlite'), JARVIS_COMPASS_DB_PATH: path, JARVIS_PUBLIC_BROKER_URL: '', JARVIS_WORKER_INSTALL_URL: '', JARVIS_WORKER_APK_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let errors = ''; child.stderr.on('data', c => { errors += String(c); });
  const url = `http://127.0.0.1:${port}/api/jarvis/admin/work/${goalId}`;
  const headers = { Authorization: 'Bearer fixture-completion-owner', 'content-type': 'application/json' };
  try {
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise(r => setTimeout(r, 50)); } }
    assert.equal(ready, true, errors);
    assert.equal((await fetch(url)).status, 401);
    const before = await (await fetch(url, { headers })).json();
    assert.equal(before.completion.notifications[0].status, 'PREPARED');
    assert.equal(before.completion.notifications[0].operation, 'Allow screen sharing');
    const payload = { cycleId: cycle.cycleId, notificationIds: [cycle.notifications[0].id] };
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, approved: true }) })).status, 409);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, notificationIds: ['unknown'] }) })).status, 409);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })).status, 200);
    const after = await (await fetch(url, { headers })).json();
    assert.equal(after.completion.notifications[0].status, 'DELIVERED');
    assert.equal(after.completion.notifications[0].response, undefined);
    assert.equal(after.completion.readyForCompletionReview, false);
    assert.equal((await store.getCompletionHistory(goalId)).length, 2);
  } finally { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } db.close(); }
});
