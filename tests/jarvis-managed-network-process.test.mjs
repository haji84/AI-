import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { manageNetworkProcess } from '../scripts/jarvis-managed-process.mjs';

function harness(available = false) {
  const probes = new Map(), retries = new Map(), children = [], events = [];
  const enqueue = queue => (fn, ms) => { const key = {}; queue.set(key, { fn, ms }); return key; };
  const run = queue => {
    assert.equal(queue.size, 1);
    const [key, value] = queue.entries().next().value;
    queue.delete(key); value.fn();
  };
  let queryFails = false, killFails = false, killReturnsFalse = false, delayedExit = false;
  const controller = manageNetworkProcess({ name: 'private-worker-ingress', command: 'node', args: ['same-private-ingress'] }, {
    canStart: () => { if (queryFails) throw Error('private-detail'); return available; },
    maxFailures: 2,
    now: () => 0,
    setTimeout: enqueue(retries), clearTimeout: key => retries.delete(key),
    probeSetTimeout: enqueue(probes), probeClearTimeout: key => probes.delete(key),
    report: event => events.push(event),
    spawn: (_command, args) => {
      const child = new EventEmitter();
      child.args = args; child.signals = [];
      child.pid = children.length + 1;
      child.kill = signal => {
        if (killFails) throw Error('private-detail');
        child.signals.push(signal);
        if (killReturnsFalse) { child.emit('error', Object.assign(Error('private-detail'), {code:'EPERM'})); return false; }
        if (!delayedExit) child.emit('exit', null, signal);
        return true;
      };
      children.push(child); return child;
    },
  });
  return { controller, probes, retries, children, events,
    probe: () => run(probes), retry: () => run(retries),
    availability: value => { available = value; },
    queryFailure: value => { queryFails = value; },
    killFailure: value => { killFails = value; },
    falseKill: value => { killReturnsFalse = value; },
    deferExit: value => { delayedExit = value; } };
}

test('network absence waits without spawning or spending a process retry budget', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.probe();
  assert.equal(h.children.length, 0);
  assert.equal(h.retries.size, 0);
  assert.deepEqual(h.controller.snapshot(), { state: 'waiting-for-network', failures: 0, retryPending: false });
  assert.deepEqual(h.events, [{ service: 'private-worker-ingress', state: 'waiting-for-network' }]);
  h.controller.stop();
  assert.equal(h.probes.size, 0);
});

test('address return launches once; address loss stops only its child; return reuses the same entrypoint', () => {
  const h = harness();
  h.availability(true); h.probe();
  h.children[0].emit('spawn');
  for (let i = 0; i < 5; i++) h.probe();
  assert.equal(h.children.length, 1);
  assert.equal(h.controller.snapshot().state, 'running');
  h.availability(false); h.probe();
  assert.deepEqual(h.children[0].signals, ['SIGTERM']);
  assert.equal(h.controller.snapshot().state, 'waiting-for-network');
  h.availability(true); h.probe();
  assert.equal(h.children.length, 2);
  assert.deepEqual(h.children[1].args, h.children[0].args);
  h.controller.stop();
  assert.deepEqual(h.children[1].signals, ['SIGTERM']);
  assert.equal(h.probes.size, 0);
});

test('exhaustion stays bounded while availability is unchanged and resumes only after network return', () => {
  const h = harness(true);
  h.children[0].emit('spawn'); h.children[0].emit('exit', 1);
  h.retry();
  h.children[1].emit('spawn'); h.children[1].emit('exit', 1);
  assert.equal(h.controller.snapshot().state, 'exhausted');
  for (let i = 0; i < 20; i++) h.probe();
  assert.equal(h.children.length, 2);
  assert.equal(h.retries.size, 0);
  h.availability(false); h.probe();
  h.availability(true); h.probe();
  assert.equal(h.children.length, 3);
  assert.equal(h.controller.snapshot().failures, 0);
  h.controller.stop();
  assert.equal(h.probes.size, 0);
});

test('network query errors fail closed without leaking details or terminating other services', () => {
  const h = harness(true);
  h.queryFailure(true); h.probe();
  assert.deepEqual(h.children[0].signals, ['SIGTERM']);
  assert.equal(h.controller.snapshot().state, 'waiting-for-network');
  assert.doesNotMatch(JSON.stringify(h.events), /private-detail/);
  h.queryFailure(false); h.probe();
  assert.equal(h.children.length, 2);
  h.controller.stop();
});

test('shutdown cancels process backoff and network observation; stale probe cannot relaunch', () => {
  const h = harness(true);
  h.children[0].emit('exit', 1);
  assert.equal(h.retries.size, 1);
  const staleProbe = h.probes.values().next().value.fn;
  h.controller.stop();
  assert.equal(h.retries.size, 0);
  assert.equal(h.probes.size, 0);
  h.availability(false); staleProbe();
  h.availability(true); staleProbe();
  assert.equal(h.children.length, 1);
});

test('failed child stop prevents duplicate launch until stop succeeds, with sanitized bounded reporting', () => {
  const h = harness(true);
  h.killFailure(true); h.availability(false); h.probe();
  h.availability(true);
  for (let i = 0; i < 5; i++) h.probe();
  assert.equal(h.children.length, 1);
  assert.equal(h.events.filter(event => event.reason === 'child-stop-failed').length, 1);
  assert.doesNotMatch(JSON.stringify(h.events), /private-detail/);
  h.killFailure(false); h.probe();
  assert.equal(h.children.length, 2);
  h.controller.stop();
});

test('false/error kill retains ownership and cannot launch a duplicate on network return', () => {
  const h = harness(true);
  h.children[0].emit('spawn');
  h.falseKill(true); h.availability(false); h.probe();
  h.availability(true);
  for (let i = 0; i < 5; i++) h.probe();
  assert.equal(h.children.length, 1);
  assert.equal(h.controller.snapshot().state, 'waiting-for-network');
  h.falseKill(false); h.probe();
  assert.equal(h.children.length, 2);
  assert.doesNotMatch(JSON.stringify(h.events), /private-detail/);
  h.controller.stop();
});

test('successful signal waits for confirmed exit before relaunch and is not resent while pending', () => {
  const h = harness(true);
  h.children[0].emit('spawn');
  h.deferExit(true); h.availability(false); h.probe();
  h.availability(true);
  for (let i = 0; i < 5; i++) h.probe();
  assert.equal(h.children.length, 1);
  assert.deepEqual(h.children[0].signals, ['SIGTERM']);
  h.children[0].emit('exit', null, 'SIGTERM');
  h.probe();
  assert.equal(h.children.length, 2);
  h.deferExit(false); h.controller.stop();
});
