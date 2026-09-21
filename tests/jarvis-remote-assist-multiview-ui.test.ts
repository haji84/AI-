import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/jarvis/RemoteAssistMultiView.tsx", "utf8");

test("multi-view uses separate per-device sessions and bounded screenshot refresh", () => {
  assert.match(source, /session-start/);
  assert.match(source, /session-end/);
  assert.match(source, /sessionId: session\.id/);
  assert.match(source, /remoteAssistRefreshConcurrency/);
  assert.match(source, /remoteAssistAdaptiveRefreshMs/);
  assert.match(source, /refreshIntervalMs/);
  assert.match(source, /document\.visibilityState !== "visible"/);
});

test("multi-view exposes 2-way, 4-way and bounded fleet grid with adaptive load control", () => {
  assert.match(source, />2画面</);
  assert.match(source, />4画面</);
  assert.match(source, />Fleet Grid</);
  assert.match(source, /REMOTE_ASSIST_FLEET_WINDOW/);
  assert.match(source, /表示台数と失敗率から更新間隔・同時取得数を自動調整/);
  assert.match(source, /負荷上昇時は安全に間引きます/);
});

test("tile promotion selects a serial but does not send manual input", () => {
  assert.match(source, /onPromote\(serial\)/);
  assert.doesNotMatch(source, /action: "tap"/);
  assert.doesNotMatch(source, /action: "swipe"/);
  assert.doesNotMatch(source, /action: "text"/);
});
