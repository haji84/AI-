import test from "node:test";
import assert from "node:assert/strict";
import { startRemoteRefreshLoop } from "../src/jarvis/remote-refresh-loop.ts";

test("refresh waits for completion, then only 100ms; resume never overlaps", async () => {
  let release!: (value: boolean) => void;
  let calls = 0;
  const delays: number[] = [];
  const loop = startRemoteRefreshLoop({ capture: () => { calls++; return new Promise(resolve => { release = resolve; }); }, visible: () => true,
    schedule: (_fn, ms) => { delays.push(ms); return 1 as unknown as ReturnType<typeof setTimeout>; }, cancel: () => {} });
  loop.resume(); loop.resume();
  assert.equal(calls, 1); assert.deepEqual(delays, []);
  release(true); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(delays, [100]); loop.stop();
});

test("failed refresh backs off; hidden page or active touch does not capture", async () => {
  const delays: number[] = []; let visible = false; let calls = 0;
  const loop = startRemoteRefreshLoop({ capture: async () => { calls++; return false; }, visible: () => visible,
    schedule: (_fn, ms) => { delays.push(ms); return 1 as unknown as ReturnType<typeof setTimeout>; }, cancel: () => {} });
  assert.equal(calls, 0); assert.deepEqual(delays, [1000]);
  visible = true; loop.resume(); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1); assert.deepEqual(delays, [1000, 2000]); loop.stop();
});

test("stop during a capture prevents further polling", async () => {
  let release!: (value: boolean) => void; let schedules = 0;
  const loop = startRemoteRefreshLoop({ capture: () => new Promise(resolve => { release = resolve; }), visible: () => true,
    schedule: () => { schedules++; return 1 as unknown as ReturnType<typeof setTimeout>; }, cancel: () => {} });
  loop.stop(); release(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(schedules, 0); loop.resume(); assert.equal(schedules, 0);
});
