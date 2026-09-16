import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canAcceptGestureCandidate,
  classifyMotionGesture,
  nextTargetIndex,
  trimMotionWindow,
} from "../src/app/jarvis/mobile/gesture/gesture-motion.ts";

const gestureSurface = readFileSync(new URL("../src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx", import.meta.url), "utf8");
const gestureCss = readFileSync(new URL("../src/app/jarvis/mobile/gesture/gesture.css", import.meta.url), "utf8");
const mobilePage = readFileSync(new URL("../src/app/jarvis/mobile/page.tsx", import.meta.url), "utf8");

test("coarse motion classifier only accepts bounded dominant-axis candidates", () => {
  assert.equal(classifyMotionGesture([
    { x: 0.2, y: 0.5, at: 0 },
    { x: 0.4, y: 0.51, at: 200 },
    { x: 0.7, y: 0.52, at: 400 },
  ])?.direction, "right");
  assert.equal(classifyMotionGesture([
    { x: 0.8, y: 0.5, at: 0 },
    { x: 0.5, y: 0.49, at: 200 },
    { x: 0.2, y: 0.48, at: 400 },
  ])?.direction, "left");
  assert.equal(classifyMotionGesture([
    { x: 0.5, y: 0.75, at: 0 },
    { x: 0.49, y: 0.5, at: 200 },
    { x: 0.48, y: 0.2, at: 400 },
  ])?.direction, "up");
  assert.equal(classifyMotionGesture([
    { x: 0.5, y: 0.2, at: 0 },
    { x: 0.51, y: 0.45, at: 200 },
    { x: 0.52, y: 0.75, at: 400 },
  ])?.direction, "down");

  assert.equal(classifyMotionGesture([
    { x: 0.4, y: 0.4, at: 0 },
    { x: 0.45, y: 0.45, at: 200 },
    { x: 0.5, y: 0.5, at: 400 },
  ]), null, "small diagonal movement is ignored");
  assert.equal(classifyMotionGesture([
    { x: 0.2, y: 0.2, at: 0 },
    { x: 0.45, y: 0.45, at: 700 },
    { x: 0.8, y: 0.8, at: 1_400 },
  ]), null, "slow/ambiguous diagonal movement is ignored");
});

test("gesture navigation stays bounded and candidate cooldown rejects bursts", () => {
  assert.equal(nextTargetIndex(0, "right", 4), 1);
  assert.equal(nextTargetIndex(0, "left", 4), 3);
  assert.equal(nextTargetIndex(3, "down", 4), 0);
  assert.equal(nextTargetIndex(1, "up", 4), 0);
  assert.equal(nextTargetIndex(7, "right", 0), 0);

  assert.equal(canAcceptGestureCandidate(Number.NEGATIVE_INFINITY, 5_000), true, "first candidate may be accepted");
  assert.equal(canAcceptGestureCandidate(4_500, 5_000), false);
  assert.equal(canAcceptGestureCandidate(4_000, 5_000), true);
  assert.equal(canAcceptGestureCandidate(4_000, Number.NaN), false);
});

test("motion history is bounded to the local analysis window", () => {
  assert.deepEqual(trimMotionWindow([
    { x: 0.1, y: 0.1, at: 3_000 },
    { x: 0.2, y: 0.2, at: 4_200 },
    { x: 0.3, y: 0.3, at: 4_900 },
  ], 5_000), [
    { x: 0.2, y: 0.2, at: 4_200 },
    { x: 0.3, y: 0.3, at: 4_900 },
  ]);
});

test("camera gesture surface is explicit, visible, local-only and never executes device commands", () => {
  assert.match(gestureSurface, /カメラはOFFです/);
  assert.match(gestureSurface, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(gestureSurface, /audio: false/);
  assert.match(gestureSurface, /CAMERA ACTIVE · LOCAL ONLY/);
  assert.match(gestureSurface, /保存・送信しません/);
  assert.match(gestureSurface, /Human Gate/);
  assert.match(gestureSurface, /最後は必ずタップまたはEnterで確定します/);
  assert.match(gestureSurface, /カメラを停止/);
  assert.match(gestureSurface, /cameraActiveRef\.current = true/);
  assert.match(gestureSurface, /cameraActiveRef\.current = false/);
  assert.match(gestureSurface, /window\.location\.assign\(selectedTarget\.href\)/);
  assert.doesNotMatch(gestureSurface, /\/api\/jarvis\/action|fetch\(|device-task|approve|factory-reset|reboot|lock-device/);
});

test("Distance Mode scales camera controls and mobile navigation exposes all local interaction modes", () => {
  assert.match(gestureCss, /html\[data-jarvis-display-mode="distance"\] \.gesture-target\{min-height:112px/);
  assert.match(gestureCss, /html\[data-jarvis-display-mode="distance"\] \.gesture-controls button\{min-height:62px/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/pointer"/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/gesture"/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/voice"/);
  assert.match(mobilePage, /<MobileCommander \/>/);
});
