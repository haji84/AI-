import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES,
  normalizeJarvisAccessibilityPreferences,
} from "../src/app/jarvis/accessibility-preferences.ts";
import {
  deriveJarvisConnectivityStatus,
  jarvisConnectivityCopy,
} from "../src/app/jarvis/connectivity-status.ts";

const accessibilityControls = readFileSync(new URL("../src/app/jarvis/JarvisAccessibilityControls.tsx", import.meta.url), "utf8");
const connectivityStatus = readFileSync(new URL("../src/app/jarvis/JarvisConnectivityStatus.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/app/jarvis/settings/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/jarvis/accessibility-status.css", import.meta.url), "utf8");

test("accessibility preferences normalize malformed persisted values conservatively", () => {
  assert.deepEqual(normalizeJarvisAccessibilityPreferences(null), DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES);
  assert.deepEqual(normalizeJarvisAccessibilityPreferences({ textScale: "huge", contrast: "max", captions: "always" }), DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES);
  assert.deepEqual(normalizeJarvisAccessibilityPreferences({ textScale: "large", contrast: "high", captions: "on" }), {
    textScale: "large",
    contrast: "high",
    captions: "on",
    reducedMotion: "system",
    largeTargets: "off",
    screenReaderHints: "on",
  });
});

test("connectivity status distinguishes offline reconnect sync auth and online", () => {
  assert.equal(deriveJarvisConnectivityStatus({ browserOnline: false, probe: "ok" }), "offline");
  assert.equal(deriveJarvisConnectivityStatus({ browserOnline: true, probe: "idle", reconnecting: true }), "reconnecting");
  assert.equal(deriveJarvisConnectivityStatus({ browserOnline: true, probe: "pending", reconnecting: true }), "syncing");
  assert.equal(deriveJarvisConnectivityStatus({ browserOnline: true, probe: "auth-required" }), "auth-required");
  assert.equal(deriveJarvisConnectivityStatus({ browserOnline: true, probe: "ok" }), "online");
  assert.equal(jarvisConnectivityCopy("offline").label, "オフライン");
  assert.equal(jarvisConnectivityCopy("reconnecting").label, "再接続中");
  assert.equal(jarvisConnectivityCopy("syncing").label, "同期中");
});

test("connectivity surface is read-only and fail-visible", () => {
  assert.match(connectivityStatus, /navigator\.onLine/);
  assert.match(connectivityStatus, /addEventListener\("offline"/);
  assert.match(connectivityStatus, /addEventListener\("online"/);
  assert.match(connectivityStatus, /fetch\("\/api\/jarvis\/state", \{ cache: "no-store" \}\)/);
  assert.match(connectivityStatus, /response\.status === 401/);
  assert.match(connectivityStatus, /role="status"/);
  assert.match(connectivityStatus, /aria-live="polite"/);
  assert.doesNotMatch(connectivityStatus, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(connectivityStatus, /\/remote|\/enroll|\/approve|\/revoke/);
});

test("keyboard and accessibility controls remain local presentation behavior", () => {
  assert.match(shell, /className="jarvis-skip-link"/);
  assert.match(shell, /href="#jarvis-main-content"/);
  assert.match(shell, /id="jarvis-main-content"/);
  assert.match(shell, /tabIndex=\{-1\}/);
  assert.match(shell, /JarvisConnectivityStatus/);
  assert.match(settings, /JarvisAccessibilityControls/);
  assert.match(accessibilityControls, /文字サイズ/);
  assert.match(accessibilityControls, /高コントラスト/);
  assert.match(accessibilityControls, /字幕表示を優先/);
  assert.match(accessibilityControls, /アニメーションを抑える/);
  assert.match(accessibilityControls, /ボタン・入力欄を大きくする/);
  assert.match(accessibilityControls, /読み上げ補助ラベルを優先/);
  assert.match(accessibilityControls, /P6の音声認識やリアルタイム音声字幕の完成を意味しない/);
  assert.doesNotMatch(accessibilityControls, /fetch\(/);
  assert.match(css, /focus-visible/);
  assert.match(css, /data-jarvis-text-scale="large"/);
  assert.match(css, /data-jarvis-contrast="high"/);
  assert.match(css, /data-jarvis-captions="on"/);
});
