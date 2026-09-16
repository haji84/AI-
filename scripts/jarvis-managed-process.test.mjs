import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { manageProcess, serviceSpecs } from './jarvis-managed-process.mjs';

function harness(spawnOverride) {
  const timers = new Map();
  const children = [];
  const events = [];
  let time = 0;
  const options = {
    maxFailures: 3, now: () => time, report: e => events.push(e),
    spawn: spawnOverride ?? (() => { const child = new EventEmitter(); child.kill = () => child.emit('exit', 0); children.push(child); return child; }),
    setTimeout: (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  return { options, children, timers, events, advance: ms => { time += ms; }, retry: () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); } };
}

test('Windows-safe dashboard command directly launches Next with Node', () => {
  const spec = serviceSpecs(process.cwd())[2];
  assert.equal(spec.command, process.execPath);
  assert.equal(spec.args.includes('127.0.0.1'), true);
  const run = spawnSync(spec.command, [spec.args[0], '--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  assert.match(run.stdout, /Next.js/);
});

test('enrollment portal joins bounded supervision only when explicitly enabled', () => {
  const normal = serviceSpecs(process.cwd());
  assert.deepEqual(normal.map(spec => spec.name), ['broker', 'remote-gateway', 'dashboard']);

  const enabled = serviceSpecs(process.cwd(), process.execPath, '3000', { enableEnrollmentPortal: true });
  assert.deepEqual(enabled.map(spec => spec.name), ['broker', 'remote-gateway', 'dashboard', 'enrollment-portal']);
  assert.match(enabled[3].args[0], /jarvis-fixed-enrollment-portal\.ts$/);
});

test('synchronous spawn errors retry with bounded budget and survive without children', () => {
  const h = harness(() => { throw Object.assign(new Error('failed'), { code: 'EINVAL' }); });
  const manager = manageProcess({ name: 'test' }, h.options);
  assert.deepEqual(manager.snapshot(), { state: 'backoff', failures: 1, retryPending: true });
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.retry();
  assert.equal([...h.timers.values()][0].delay, 2000);
  h.retry();
  assert.deepEqual(manager.snapshot(), { state: 'exhausted', failures: 3, retryPending: false });
  assert.equal(h.timers.size, 0);
});

test('error plus exit schedules only one restart; stop cancels it', () => {
  const h = harness(); const manager = manageProcess({ name: 'test' }, h.options);
  h.children[0].emit('error', { code: 'ENOENT' });
  h.children[0].emit('exit', 1);
  assert.equal(h.timers.size, 1);
  assert.equal(manager.snapshot().failures, 1);
  manager.stop(); assert.equal(h.timers.size, 0);
});

test('stable process resets failure budget and stopping never restarts', () => {
  const h = harness(); const manager = manageProcess({ name: 'test' }, h.options);
  h.children[0].emit('exit', 1); h.retry();
  h.children[1].emit('spawn'); h.advance(60_001); h.children[1].emit('exit', 1);
  assert.equal(manager.snapshot().failures, 1);
  h.retry(); h.children[2].emit('spawn'); manager.stop();
  assert.equal(h.timers.size, 0); assert.equal(manager.snapshot().state, 'stopped');
});
