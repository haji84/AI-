import test from 'node:test';
import assert from 'node:assert/strict';
import { startTrafficGuard } from '../scripts/remote-lite-traffic-guard.mjs';

test('guard persists before readiness/heartbeat and never closes unsafe state', () => {
  const events = [];
  let tick;
  let bad = false;
  const monitor = startTrafficGuard({
    meter: { observe() { events.push('persist'); if (bad) throw new Error('TRAFFIC_COUNTER_RESET'); return { status: 'monitoring' }; }, close() { events.push('close'); } },
    read: () => ({}), notify: flag => events.push(flag),
    schedule: fn => { tick = fn; return 1; }, cancel: () => events.push('cancel'),
    failed: error => events.push(error.message)
  });
  assert.deepEqual(events, ['persist', '--ready']);
  tick();
  assert.deepEqual(events.slice(-2), ['persist', 'WATCHDOG=1']);
  bad = true;
  tick();
  monitor.stop();
  assert.deepEqual(events.slice(-3), ['persist', 'cancel', 'TRAFFIC_COUNTER_RESET']);
  assert.ok(!events.includes('close'));
});

test('exhausted or unwritable meter cannot signal ready; failed notifier cannot keep monitoring', () => {
  for (const failure of ['exhausted', 'write', 'notify']) {
    const events = [];
    startTrafficGuard({
      meter: { observe() { if (failure === 'write') throw new Error('disk failed'); return { status: failure === 'exhausted' ? 'exhausted' : 'monitoring' }; }, close() { assert.fail('unsafe close'); } },
      read: () => ({}), notify: () => { events.push('notify'); throw new Error('notify failed'); },
      schedule: () => assert.fail('unsafe schedule'), failed: () => events.push('failed')
    });
    assert.deepEqual(events, failure === 'notify' ? ['notify', 'failed'] : ['failed']);
  }
});

test('graceful stop durably samples before releasing the lock', () => {
  const events = [];
  const monitor = startTrafficGuard({
    meter: { observe() { events.push('persist'); return { status: 'monitoring' }; }, close() { events.push('close'); } },
    read: () => ({}), notify: () => {}, schedule: () => 1, cancel: () => events.push('cancel'), failed: () => assert.fail('unexpected failure')
  });
  monitor.stop(); monitor.stop();
  assert.deepEqual(events, ['persist', 'cancel', 'persist', 'close']);
});
