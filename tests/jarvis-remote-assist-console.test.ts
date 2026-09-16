import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/jarvis/JarvisConsole.tsx", "utf8");

test("Remote Assist console requires a bounded session for manual actions", () => {
  assert.match(source, /Remote Assist開始/);
  assert.match(source, /session-start/);
  assert.match(source, /session-end/);
  assert.match(source, /manual: true/);
  assert.match(source, /sessionId/);
  assert.match(source, /remoteSession\.serial !== serial/);
  assert.match(source, /setRemoteSession\(null\)/);
});

test("Remote Assist console labels bounded screenshot refresh without overclaiming streaming", () => {
  assert.match(source, /画面自動更新/);
  assert.match(source, /startRemoteRefreshLoop/);
  assert.match(source, /document\.visibilityState === "visible"/);
  assert.match(source, /動画ストリーミングではありません/);
});

test("Human Takeover linkage is exact and resolution stays explicit", () => {
  assert.match(source, /item\.nodeId === remoteSerial/);
  assert.match(source, /resolve-takeover/);
  assert.match(source, /続きやって/);
});
