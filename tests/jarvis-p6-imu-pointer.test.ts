import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_POINTER_POSITION,
  calibrationFromSample,
  canActivatePointerTarget,
  nearestPointerTarget,
  normalizeOrientationSample,
  projectOrientation,
} from "../src/app/jarvis/mobile/pointer/imu-pointer.ts";

const pointerSurface = readFileSync(new URL("../src/app/jarvis/mobile/pointer/ImuPointerCommander.tsx", import.meta.url), "utf8");
const mobilePage = readFileSync(new URL("../src/app/jarvis/mobile/page.tsx", import.meta.url), "utf8");

test("orientation samples reject missing values and clamp browser extremes", () => {
  assert.equal(normalizeOrientationSample({ beta: null, gamma: 2 }), null);
  assert.equal(normalizeOrientationSample({ beta: 2, gamma: null }), null);
  assert.deepEqual(normalizeOrientationSample({ beta: 999, gamma: -999 }), { beta: 180, gamma: -90 });
  assert.deepEqual(calibrationFromSample({ beta: 12, gamma: -4 }), { beta: 12, gamma: -4 });
});

test("IMU pointer uses dead-zone, smoothing and bounded local projection", () => {
  const calibration = { beta: 0, gamma: 0 };
  assert.deepEqual(projectOrientation({ beta: 1, gamma: -1 }, calibration, DEFAULT_POINTER_POSITION), DEFAULT_POINTER_POSITION);

  const tilted = projectOrientation({ beta: 20, gamma: 20 }, calibration, DEFAULT_POINTER_POSITION);
  assert.ok(tilted);
  assert.ok((tilted?.x ?? 0) > 50 && (tilted?.x ?? 100) < 96);
  assert.ok((tilted?.y ?? 0) > 50 && (tilted?.y ?? 100) < 96);

  let position = DEFAULT_POINTER_POSITION;
  for (let index = 0; index < 100; index += 1) {
    position = projectOrientation({ beta: 180, gamma: 90 }, calibration, position) ?? position;
  }
  assert.ok(position.x <= 96);
  assert.ok(position.y <= 96);
});

test("nearest target selection never performs activation by itself", () => {
  const targets = [
    { id: "left", x: 20, y: 20 },
    { id: "right", x: 80, y: 20 },
    { id: "bottom", x: 50, y: 80 },
  ];
  assert.equal(nearestPointerTarget({ x: 18, y: 22 }, targets), "left");
  assert.equal(nearestPointerTarget({ x: 79, y: 19 }, targets), "right");
  assert.equal(nearestPointerTarget({ x: 50, y: 77 }, targets), "bottom");
  assert.equal(nearestPointerTarget({ x: 50, y: 50 }, []), null);
  assert.equal(canActivatePointerTarget("requesting", "left"), false);
  assert.equal(canActivatePointerTarget("active", null), false);
  assert.equal(canActivatePointerTarget("denied", "left"), true);
});

test("sensor is explicit, visible, stoppable, local-only and cannot execute device commands", () => {
  assert.match(pointerSurface, /IMUはOFFです/);
  assert.match(pointerSurface, /onClick=\{\(\) => void startSensor\(\)\}/);
  assert.match(pointerSurface, /requestPermission\(\)/);
  assert.match(pointerSurface, /IMUを停止/);
  assert.match(pointerSurface, /中央を再補正/);
  assert.match(pointerSurface, /センサーデータはこのブラウザ内だけで処理し、送信しません/);
  assert.match(pointerSurface, /動かすだけでは実行しません/);
  assert.match(pointerSurface, /Human Gate/);
  assert.match(pointerSurface, /通常のタップ・キーボード操作/);
  assert.match(pointerSurface, /onKeyDown/);
  assert.match(pointerSurface, /選択中の「\{selectedTarget\.label\}」を開く/);
  assert.doesNotMatch(pointerSurface, /\/api\/jarvis\/action|fetch\(|device-task|approve|factory-reset|reboot|lock-device/);
  assert.doesNotMatch(pointerSurface, /useEffect\([^]*startSensor\(/);
});

test("mobile commander exposes the IMU surface without replacing voice or text fallback", () => {
  assert.match(mobilePage, /href="\/jarvis\/mobile\/pointer"/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/voice"/);
  assert.match(mobilePage, /<MobileCommander \/>/);
});
