import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCaptureQueue } from '../src/jarvis/remote-capture-queue.ts';
import { screenSwipe } from '../src/jarvis/remote-screen-input.ts';

test('swipe buttons use actual device dimensions, including small Android8 screens', () => {
  for (const [width, height] of [[320, 640], [720, 1440], [1080, 2400]]) {
    const up = screenSwipe(width, height, 'up');
    const down = screenSwipe(width, height, 'down');
    assert(up && up.action === 'swipe' && down && down.action === 'swipe');
    assert(up.x1 < width && up.y1 < height && up.y2 >= 0 && up.y1 > up.y2);
    assert.equal(up.y1, down.y2); assert.equal(up.y2, down.y1);
  }
  assert.equal(screenSwipe(0, 640, 'up'), null);
  assert.equal(screenSwipe(NaN, 640, 'up'), null);
});

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
