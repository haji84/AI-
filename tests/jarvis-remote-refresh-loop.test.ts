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

test("KYV pacing and bounded recovery: three retries, then stop; resume cannot bypass exhaustion", async () => {
  let next: (() => void) | undefined; const delays: number[]=[];let calls=0;let exhausted=0;
  const loop=startRemoteRefreshLoop({capture:async()=>{calls++;return false;},visible:()=>true,successDelayMs:1500,maxFailures:4,onExhausted:()=>{exhausted++;},schedule:(fn,ms)=>{next=fn;delays.push(ms);return 1 as unknown as ReturnType<typeof setTimeout>;},cancel:()=>{}});
  for(let i=0;i<4;i++){await Promise.resolve();await Promise.resolve();if(i<3)next!();}
  assert.equal(calls,4);assert.equal(exhausted,1);assert.deepEqual(delays,[2000,4000,8000]);loop.resume();assert.equal(calls,4);loop.stop();
});
test("configured completion gap applies after success and failure counter resets", async()=>{
  let next:(()=>void)|undefined;const delays:number[]=[];let calls=0;
  const loop=startRemoteRefreshLoop({capture:async()=>++calls!==1,visible:()=>true,successDelayMs:1500,schedule:(fn,ms)=>{next=fn;delays.push(ms);return 1 as unknown as ReturnType<typeof setTimeout>;},cancel:()=>{}});
  await Promise.resolve();await Promise.resolve();next!();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(delays,[2000,1500]);loop.stop();
});

test("visibility resume preserves KYV gap and recovery backoff",async()=>{
 let now=100;let calls=0;const delays:number[]=[];
 const loop=startRemoteRefreshLoop({capture:async()=>{calls++;return false;},visible:()=>true,now:()=>now,successDelayMs:1500,schedule:(_fn,ms)=>{delays.push(ms);return 1 as unknown as ReturnType<typeof setTimeout>;},cancel:()=>{}});
 await Promise.resolve();await Promise.resolve();now+=100;loop.resume();assert.equal(calls,1);assert.deepEqual(delays,[2000,1900]);loop.stop();
});
