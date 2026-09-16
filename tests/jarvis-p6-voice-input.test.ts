import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSafeVoiceCommand } from "../src/app/jarvis/mobile/voice-command.ts";

const voiceSurface = readFileSync(new URL("../src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx", import.meta.url), "utf8");
const mobilePage = readFileSync(new URL("../src/app/jarvis/mobile/page.tsx", import.meta.url), "utf8");

test("voice parser accepts only the bounded safe mobile command set", () => {
  assert.deepEqual(parseSafeVoiceCommand("画面を起こして"), { ok: true, task: { type: "wake-device", payload: {} } });
  assert.deepEqual(parseSafeVoiceCommand("Wi-Fi設定"), { ok: true, task: { type: "launch-settings", payload: { screen: "wifi" } } });
  assert.deepEqual(parseSafeVoiceCommand("YouTubeを開いて"), { ok: true, task: { type: "open-app", payload: { packageName: "com.google.android.youtube" } } });
  assert.deepEqual(parseSafeVoiceCommand("https://example.com を開いて"), { ok: true, task: { type: "open-url", payload: { url: "https://example.com" } } });
  assert.deepEqual(parseSafeVoiceCommand("通知: テスト"), { ok: true, task: { type: "show-notification", payload: { title: "JARVIS", message: "テスト" } } });
});

test("voice parser fail-closes protected and unknown instructions", () => {
  for (const text of ["端末を再起動", "ロックして", "初期化して", "承認して", "権限を変更して"]) {
    const result = parseSafeVoiceCommand(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "protected");
  }
  const unsupported = parseSafeVoiceCommand("適当に全部やって");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.reason, "unsupported");
});

test("push-to-talk requires explicit activation and a second explicit execute action", () => {
  assert.match(voiceSurface, /onPointerDown=.*startListening/);
  assert.match(voiceSurface, /onPointerUp=\{\(\) => stopListening\(\)\}/);
  assert.match(voiceSurface, /onKeyDown=.*startListening/);
  assert.match(voiceSurface, /この指示を実行/);
  assert.match(voiceSurface, /onClick=\{\(\) => void executeTranscript\(\)\}/);
  assert.match(voiceSurface, /マイクは自動起動しません/);
  assert.doesNotMatch(voiceSurface, /useEffect\(\(\) => \{[\s\S]{0,300}startListening\(\)/);
});

test("voice surface keeps captions visible and uses the existing owner-protected action endpoint", () => {
  assert.match(voiceSurface, /認識字幕/);
  assert.match(voiceSurface, /aria-live="polite"/);
  assert.match(voiceSurface, /fetch\("\/api\/jarvis\/action"/);
  assert.match(voiceSurface, /action: "device-task"/);
  assert.match(voiceSurface, /オーナー認証/);
  assert.doesNotMatch(voiceSurface, /lock-device|reboot|factory-reset|approve|permission-change/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/voice"/);
});
