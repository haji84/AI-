import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCaptureQueue } from '../src/jarvis/remote-capture-queue.ts';

test('input waits for capture, suppresses refresh, and runs exactly once', async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext('a');
  let release!: () => void;
  const events: string[] = [];
  const capture = queue.request('a', () => new Promise<void>(resolve => { release = resolve; }), () => events.push('frame'));
  const input = queue.input('a', async () => { events.push('input'); return true; });
  assert.equal(events.length, 0);
  assert.equal(await queue.request('a', async () => { events.push('overlap'); }, () => {}), false);
  assert.equal(await queue.input('a', async () => { events.push('duplicate'); }), null);
  release(); await capture;
  assert.equal(await input, true);
  assert.deepEqual(events, ['frame', 'input']);
});

test('session/device change cancels an input waiting for capture', async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext('a');
  let release!: () => void; let calls = 0;
  const capture = queue.request('a', () => new Promise<void>(resolve => { release = resolve; }), () => {});
  const input = queue.input('a', async () => { calls++; });
  queue.setContext('b'); release(); await capture; await input;
  assert.equal(calls, 0);
});

test('input failure is never retried and does not block future refresh', async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext('a'); let calls = 0;
  await assert.rejects(queue.input('a', async () => { calls++; throw Error('unknown outcome'); }), /unknown outcome/);
  assert.equal(calls, 1);
  assert.equal(await queue.request('a', async () => true, () => {}), true);
});

