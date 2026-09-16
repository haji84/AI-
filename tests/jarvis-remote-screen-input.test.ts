import assert from "node:assert/strict";
import test from "node:test";
import { ScreenGestureTracker, screenPoint, screenGesture } from "../src/jarvis/remote-screen-input.ts";

const geometry = { left: 10, top: 20, width: 300, height: 600, nativeWidth: 1080, nativeHeight: 2160 };
test("remote input maps scaled screenshot pixels including edges", () => {
  assert.deepEqual(screenPoint({ x: 160, y: 320 }, geometry), { x: 540, y: 1080 });
  assert.deepEqual(screenPoint({ x: 310, y: 620 }, geometry), { x: 1079, y: 2159 });
  assert.deepEqual(screenPoint({ x: 10, y: 20 }, geometry), { x: 0, y: 0 });
});
test("remote input rejects outside points, unloaded images and invalid geometry", () => {
  for (const point of [{ x: 9, y: 20 }, { x: 311, y: 320 }, { x: NaN, y: 20 }, { x: 10, y: Infinity }]) assert.equal(screenPoint(point, geometry), null);
  for (const patch of [{ width: 0 }, { height: -1 }, { nativeWidth: 0 }, { nativeHeight: 2160.5 }, { nativeWidth: 20_001 }, { left: NaN }]) assert.equal(screenPoint({ x: 160, y: 320 }, { ...geometry, ...patch }), null);
});
test("remote gesture distinguishes tap jitter from scaled swipe", () => {
  assert.deepEqual(screenGesture({ x: 160, y: 320 }, { x: 161, y: 321 }, geometry, 100), { action: "tap", x: 543, y: 1083 });
  assert.deepEqual(screenGesture({ x: 160, y: 500 }, { x: 160, y: 100 }, geometry, 300), { action: "swipe", x1: 540, y1: 1728, x2: 540, y2: 288, durationMs: 300 });
  assert.equal(screenGesture({ x: 160, y: 500 }, { x: 160, y: 100 }, geometry, 1)?.action, "swipe");
});
test("remote gesture cancels outside release and stale or invalid duration", () => {
  const start = { x: 160, y: 500 };
  for (const duration of [-1, NaN, Infinity, 5001]) assert.equal(screenGesture(start, start, geometry, duration), null);
  assert.equal(screenGesture(start, { x: 500, y: 100 }, geometry, 100), null);
});

test("pointer cancellation, multitouch, mismatched pointer and layout change send nothing", () => {
  const tracker = new ScreenGestureTracker();
  const point = { x: 160, y: 320 };
  for (const cancel of [() => tracker.cancel(), () => tracker.begin(2, false, point, geometry, 20)]) {
    assert.equal(tracker.begin(1, true, point, geometry, 10), true);
    cancel();
    assert.equal(tracker.finish(1, point, geometry, 100), null);
  }
  tracker.begin(1, true, point, geometry, 10);
  assert.equal(tracker.finish(2, point, geometry, 100), null);
  tracker.begin(1, true, point, geometry, 10);
  assert.equal(tracker.finish(1, point, { ...geometry, width: 200 }, 100), null);
});

test("one pointer gesture emits once and fresh context cannot finish old gesture", () => {
  const tracker = new ScreenGestureTracker();
  const point = { x: 160, y: 320 };
  tracker.begin(1, true, point, geometry, 10);
  assert.equal(new ScreenGestureTracker().finish(1, point, geometry, 100), null);
  assert.deepEqual(tracker.finish(1, point, geometry, 100), { action: "tap", x: 540, y: 1080 });
  assert.equal(tracker.finish(1, point, geometry, 100), null);
});
