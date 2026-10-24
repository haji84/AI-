import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';
import { evaluateTrafficBudget, openTrafficBudget, readLinuxTrafficSnapshot } from '../src/remote-lite/traffic-budget.mjs';

const start = Date.parse('2026-10-01T00:00:00Z');
const policy = { periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z', limitBytes: '8000000000000', openingBytes: '1000' };
const sample = (extra = {}) => ({ bootId: '01234567-89ab-4cde-8fab-0123456789ab', wallMs: start + 60000, uptimeMs: 60000, counters: { eth0: '2000' }, ...extra });

test('budget counts the whole boot conservatively and persists unsigned 64-bit counters without rounding', () => {
  const first = evaluateTrafficBudget(policy, sample());
  assert.equal(first.usedBytes, '3000');
  const second = evaluateTrafficBudget(policy, sample({ wallMs: start + 65000, uptimeMs: 65000, counters: { eth0: '2050' } }), first);
  assert.equal(second.usedBytes, '3050');
  const large = evaluateTrafficBudget({ ...policy, openingBytes: '0' }, sample({ counters: { eth0: '9007199254740993' } }));
  assert.equal(large.usedBytes, '9007199254740993');
  assert.equal(large.status, 'exhausted');
});

test('limit equality blocks and cannot be reset by restart, changed policy or a new period', () => {
  const small = { ...policy, limitBytes: '3000' };
  const exhausted = evaluateTrafficBudget(small, sample());
  assert.equal(exhausted.status, 'exhausted');
  assert.throws(() => evaluateTrafficBudget(small, sample(), exhausted), /TRAFFIC_BUDGET_EXHAUSTED/);
  const first = evaluateTrafficBudget(policy, sample());
  assert.throws(() => evaluateTrafficBudget({ ...policy, limitBytes: '9000000000000' }, sample(), first), /TRAFFIC_POLICY_CHANGED/);
  assert.throws(() => evaluateTrafficBudget(policy, sample({ wallMs: Date.parse(policy.periodEnd) }), first), /TRAFFIC_PERIOD_ENDED/);
});

test('reboot, counter reset, interface changes, stale measurement and time reversal stop admission', () => {
  const first = evaluateTrafficBudget(policy, sample());
  for (const [change, code] of [
    [{ bootId: '11234567-89ab-4cde-8fab-0123456789ab' }, 'TRAFFIC_BOOT_CHANGED'],
    [{ counters: { eth0: '1999' } }, 'TRAFFIC_COUNTER_RESET'],
    [{ counters: { eth0: '2000', eth1: '1' } }, 'TRAFFIC_INTERFACES_CHANGED'],
    [{ counters: {} }, 'TRAFFIC_SAMPLE_INVALID'],
    [{ uptimeMs: 76000, wallMs: start + 76000 }, 'TRAFFIC_MEASUREMENT_GAP'],
    [{ uptimeMs: 59000 }, 'TRAFFIC_CLOCK_INVALID'],
    [{ wallMs: start + 59000 }, 'TRAFFIC_CLOCK_INVALID'],
  ]) assert.throws(() => evaluateTrafficBudget(policy, sample(change), first), new RegExp(code));
  for (const value of ['-1', '1.5', '1e9', '18446744073709551616']) {
    assert.throws(() => evaluateTrafficBudget(policy, sample({ counters: { eth0: value } })), /TRAFFIC_SAMPLE_INVALID/);
  }
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'remote-lite-traffic-'));
  t.after(() => {
    const resolved = resolve(root);
    assert.ok(resolved.startsWith(resolve(tmpdir()) + sep));
    rmSync(resolved, { recursive: true, force: true });
  });
  return join(root, 'meter');
}

test('durable meter requires explicit initialization, excludes a second writer and retains usage on restart', t => {
  const dir = fixture(t);
  assert.throws(() => openTrafficBudget(dir, policy));
  const meter = openTrafficBudget(dir, policy, { initialize: true });
  assert.throws(() => openTrafficBudget(dir, policy));
  assert.equal(meter.observe(sample()).usedBytes, '3000');
  meter.close();
  const reopened = openTrafficBudget(dir, policy);
  assert.equal(reopened.observe(sample({ wallMs: start + 65000, uptimeMs: 65000, counters: { eth0: '2100' } })).usedBytes, '3100');
  reopened.close();
  assert.throws(() => openTrafficBudget(dir, policy, { initialize: true }));
  assert.equal(JSON.parse(readFileSync(join(dir, 'traffic.json'), 'utf8')).usedBytes, '3100');
});

test('corrupt or uninitialized state is never an empty allowance; a failed monitor retains its lock', t => {
  const dir = fixture(t);
  const meter = openTrafficBudget(dir, policy, { initialize: true });
  meter.observe(sample());
  assert.throws(() => meter.observe(sample({ counters: { eth0: '1' } })), /TRAFFIC_COUNTER_RESET/);
  // On unsafe monitoring failure the caller deliberately does not close the meter.
  assert.ok(existsSync(join(dir, 'traffic.lock')));
  assert.throws(() => openTrafficBudget(dir, policy));
  meter.close();
  writeFileSync(join(dir, 'traffic.json'), '{}');
  assert.throws(() => openTrafficBudget(dir, policy), /TRAFFIC_STATE_INVALID/);
});

test('Linux native read observes real boot/uptime and every non-loopback interface without changing networking', { skip: process.platform !== 'linux' }, () => {
  const current = readLinuxTrafficSnapshot();
  assert.ok(Object.keys(current.counters).length > 0);
  const day = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.parse(day) + 86400000).toISOString().replace('.000Z', 'Z');
  const observed = evaluateTrafficBudget({ ...policy, periodStart: day + 'T00:00:00Z', periodEnd: end, openingBytes: '0' }, current);
  assert.match(observed.usedBytes, /^\d+$/);
});

test('live ledger modification is not silently overwritten by in-memory usage', t => {
  const dir = fixture(t);
  const meter = openTrafficBudget(dir, policy, { initialize: true });
  meter.observe(sample());
  writeFileSync(join(dir, 'traffic.json'), '{}');
  assert.throws(() => meter.observe(sample()), /TRAFFIC_STATE_CHANGED/);
  assert.equal(readFileSync(join(dir, 'traffic.json'), 'utf8'), '{}');
  meter.close();
});
