import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundVideoPlan, groundVideoTarget, validateVideoActionPlan } from '../src/jarvis/video-action-plan.ts';
import { TeachingStore, replayTeaching, type DeviceProfile } from '../src/jarvis/teaching.ts';
import { observeAndroidUi } from '../src/jarvis/teaching-observation.ts';
const profile: DeviceProfile = { deviceId: 'test', platform: 'android', model: 'fixture', osVersion: '1', app: 'fixture', appVersion: '1' };
const plan = { uncertain: false, goal: 'Read details', completion: 'Detail view', steps: [{ label: 'Details', before: 'List view', after: 'Detail view' }] };
function observation(label: string) { return observeAndroidUi(`<hierarchy><node text="${label}" class="Button" package="fixture" resource-id="fixture:id/button" clickable="true" enabled="true" bounds="[0,0][100,100]"/></hierarchy>`, profile); }
test('model output cannot authorize unsupported actions or uncertainty', () => {
  assert.equal(validateVideoActionPlan(plan).steps.length, 1);
  for (const value of [{ ...plan, uncertain: true }, { ...plan, steps: [] }, { ...plan, steps: [{ ...plan.steps[0], label: 'Purchase' }] }, { ...plan, completion: 'password' }]) assert.throws(() => validateVideoActionPlan(value));
});
test('grounding requires unique live safe label, not inferred coordinates or IDs', () => {
  const o = observation('Details'); assert.equal(groundVideoTarget(o, 'Details').selector, o.targets[0].selector);
  assert.throws(() => groundVideoTarget(o, 'Close'));
  assert.throws(() => groundVideoTarget({ ...o, targets: [...o.targets, ...o.targets] }, 'Details'));
  assert.throws(() => groundVideoTarget({ ...o, protectedScreen: true }, 'Details'));
});
test('video grounding persists DRAFT then independent replay grants verification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-ground-')); const store = new TeachingStore(join(dir, 'store.json'));
  let screen = 'Details'; let inputs = 0;
  const adapter = { authorize() {}, async observe() { return observation(screen); }, async execute() { inputs++; screen = 'Close'; }, async matches(d: string) { return d === (screen === 'Details' ? 'List view' : 'Detail view'); } };
  try {
    const v = await groundVideoPlan(validateVideoActionPlan(plan), store, adapter, 'session');
    assert.equal(v.status, 'DRAFT'); assert.equal(inputs, 1); assert.equal(store.list().runs.length, 0);
    await assert.rejects(replayTeaching(store, v.id, adapter, 'execute'));
    screen = 'Details'; assert.equal((await replayTeaching(store, v.id, adapter, 'verify')).status, 'PASSED');
    screen = 'Details'; assert.equal((await replayTeaching(store, v.id, adapter, 'execute')).status, 'PASSED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('mismatch before input does nothing and failed postcondition never retries', async () => {
  for (const failBefore of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), 'video-stop-')); const store = new TeachingStore(join(dir, 'store.json')); let inputs = 0;
    try {
      await assert.rejects(groundVideoPlan(validateVideoActionPlan(plan), store, { authorize() {}, async observe() { return observation('Details'); }, async execute() { inputs++; }, async matches() { return !failBefore && inputs === 0; } }, 'session'));
      assert.equal(inputs, failBefore ? 0 : 1); assert.equal(store.list().variants[0].status, 'DRAFT'); assert.equal(store.list().runs.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
