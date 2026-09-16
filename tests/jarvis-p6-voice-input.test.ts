import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendSharedCommandHistory,
  emptySharedCommandContext,
  normalizeSharedCommandContext,
  redactCommandContextText,
} from "../src/app/jarvis/mobile/command-context.ts";
import { parseSafeMobileCommand, parseSafeVoiceCommand } from "../src/app/jarvis/mobile/voice-command.ts";

const voiceSurface = readFileSync(new URL("../src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx", import.meta.url), "utf8");
const mobileSurface = readFileSync(new URL("../src/app/jarvis/mobile/MobileCommander.tsx", import.meta.url), "utf8");
const mobilePage = readFileSync(new URL("../src/app/jarvis/mobile/page.tsx", import.meta.url), "utf8");

test("voice and text share the same bounded safe mobile command parser", () => {
  assert.equal(parseSafeVoiceCommand, parseSafeMobileCommand);
  assert.deepEqual(parseSafeMobileCommand("画面を起こして"), { ok: true, task: { type: "wake-device", payload: {} } });
  assert.deepEqual(parseSafeMobileCommand("Wi-Fi設定"), { ok: true, task: { type: "launch-settings", payload: { screen: "wifi" } } });
  assert.deepEqual(parseSafeMobileCommand("YouTubeを開いて"), { ok: true, task: { type: "open-app", payload: { packageName: "com.google.android.youtube" } } });
  assert.deepEqual(parseSafeMobileCommand("https://example.com を開いて"), { ok: true, task: { type: "open-url", payload: { url: "https://example.com" } } });
  assert.deepEqual(parseSafeMobileCommand("通知: テスト"), { ok: true, task: { type: "show-notification", payload: { title: "JARVIS", message: "テスト" } } });
});

test("shared parser fail-closes protected and unknown instructions for both input modes", () => {
  for (const text of ["端末を再起動", "ロックして", "初期化して", "承認して", "権限を変更して", "billingを変更", "credentialを更新"]) {
    const result = parseSafeMobileCommand(text);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "protected");
      assert.match(result.message, /実行も承認もしません/);
    }
  }
  const unsupported = parseSafeMobileCommand("適当に全部やって");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.reason, "unsupported");
});

test("browser-local shared context is bounded and redacts common credential material", () => {
  const redacted = redactCommandContextText("https://example.com/run?token=abc123&mode=safe Bearer topsecret password=hunter2");
  assert.doesNotMatch(redacted, /abc123|topsecret|hunter2/);
  assert.match(redacted, /REDACTED/);

  let context = emptySharedCommandContext();
  for (let index = 0; index < 15; index += 1) {
    context = appendSharedCommandHistory(context, {
      source: index % 2 ? "voice" : "text",
      command: `command-${index}`,
      outcome: "sent",
      targetNodeId: "android-1",
    }, new Date(`2026-09-16T00:${String(index).padStart(2, "0")}:00.000Z`));
  }
  assert.equal(context.history.length, 12);
  assert.equal(context.history[0]?.command, "command-3");
  assert.equal(context.history.at(-1)?.command, "command-14");

  const normalized = normalizeSharedCommandContext({
    targetNodeId: "android-1",
    history: [{ source: "voice", outcome: "sent", command: "token=secret-value", createdAt: "2026-09-16T00:00:00.000Z" }, { garbage: true }],
  });
  assert.equal(normalized.targetNodeId, "android-1");
  assert.equal(normalized.history.length, 1);
  assert.doesNotMatch(normalized.history[0]?.command ?? "", /secret-value/);
});

test("push-to-talk requires explicit activation and a second explicit execute action", () => {
  assert.match(voiceSurface, /onPointerDown=.*startListening/);
  assert.match(voiceSurface, /onPointerUp=\{\(\) => stopListening\(\)\}/);
  assert.match(voiceSurface, /onKeyDown=.*startListening/);
  assert.match(voiceSurface, /この指示を実行/);
  assert.match(voiceSurface, /onClick=\{\(\) => void executeTranscript\(\)\}/);
  assert.match(voiceSurface, /マイクは自動起動しません/);
  assert.match(voiceSurface, /useEffect\(\(\) => \{\s*setSupported\(Boolean\(recognitionConstructor\(\)\)\);\s*setSharedContext\(loadSharedCommandContext\(\)\);\s*void refresh\(\);/);
  assert.doesNotMatch(voiceSurface, /useEffect\(\(\) => \{\s*startListening\(\)/);
});

test("voice and text surfaces share target context, history and the owner-protected action endpoint", () => {
  for (const surface of [voiceSurface, mobileSurface]) {
    assert.match(surface, /parseSafeMobileCommand/);
    assert.match(surface, /saveSharedTargetNode/);
    assert.match(surface, /recordSharedCommand/);
    assert.match(surface, /fetch\("\/api\/jarvis\/action"/);
    assert.match(surface, /action: "device-task"/);
  }
  assert.match(voiceSurface, /認識字幕/);
  assert.match(voiceSurface, /aria-live="polite"/);
  assert.match(voiceSurface, /オーナー認証/);
  assert.doesNotMatch(voiceSurface, /lock-device|reboot|factory-reset|approve|permission-change/);
  assert.match(mobileSurface, /保護対象はここから承認も実行もしません/);
  assert.match(voiceSurface, /保護対象は音声から実行も承認もしません/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/voice"/);
});
