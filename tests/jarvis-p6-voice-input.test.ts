import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendSharedCommandHistory,
  emptySharedCommandContext,
  normalizeSharedCommandContext,
  redactCommandContextText,
  type SharedCommandContext,
} from "../src/app/jarvis/mobile/command-context.ts";
import { getSafeContextCandidates, resolveSafeContextReference } from "../src/app/jarvis/mobile/context-reference.ts";
import { parseSafeMobileCommand, parseSafeVoiceCommand } from "../src/app/jarvis/mobile/voice-command.ts";
import {
  DEFAULT_SPEECH_POLICY,
  containsSensitiveSpeechText,
  isQuietHoursActive,
  normalizeSpeechPolicySettings,
  shouldSpeakLocal,
  sortSpeechQueueEntries,
  speechProfileForPreference,
} from "../src/app/jarvis/mobile/voice/speech-policy.ts";

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
    selectedHistoryId: "missing",
    history: [{ source: "voice", outcome: "sent", command: "token=secret-value", createdAt: "2026-09-16T00:00:00.000Z" }, { garbage: true }],
  });
  assert.equal(normalized.targetNodeId, "android-1");
  assert.equal(normalized.selectedHistoryId, undefined);
  assert.equal(normalized.history.length, 1);
  assert.doesNotMatch(normalized.history[0]?.command ?? "", /secret-value/);
});

test("safe context references reuse only sent, reparsable, same-target, non-redacted commands", () => {
  let context: SharedCommandContext = { ...emptySharedCommandContext(), targetNodeId: "android-1" };
  context = appendSharedCommandHistory(context, { source: "text", command: "YouTubeを開いて", outcome: "sent", targetNodeId: "android-1" }, new Date("2026-09-16T01:00:00.000Z"));
  const youtubeId = context.history.at(-1)?.id;
  context = appendSharedCommandHistory(context, { source: "voice", command: "端末を再起動", outcome: "blocked", targetNodeId: "android-1" }, new Date("2026-09-16T01:01:00.000Z"));
  context = appendSharedCommandHistory(context, { source: "text", command: "https://example.com/?token=abc", outcome: "sent", targetNodeId: "android-1" }, new Date("2026-09-16T01:02:00.000Z"));
  context = appendSharedCommandHistory(context, { source: "text", command: "Chromeを開いて", outcome: "sent", targetNodeId: "android-2" }, new Date("2026-09-16T01:03:00.000Z"));
  context = appendSharedCommandHistory(context, { source: "voice", command: "Wi-Fi設定", outcome: "sent", targetNodeId: "android-1" }, new Date("2026-09-16T01:04:00.000Z"));

  const candidates = getSafeContextCandidates(context);
  assert.deepEqual(candidates.map((candidate) => candidate.entry.command), ["Wi-Fi設定", "YouTubeを開いて"]);
  assert.deepEqual(resolveSafeContextReference("さっきのやつ", context), {
    kind: "resolved",
    command: "Wi-Fi設定",
    entryId: candidates[0]?.entry.id,
    label: "さっきのやつ",
  });
  assert.deepEqual(resolveSafeContextReference("2番目", context), {
    kind: "resolved",
    command: "YouTubeを開いて",
    entryId: youtubeId,
    label: "2番目",
  });

  const selected: SharedCommandContext = { ...context, selectedHistoryId: youtubeId };
  assert.deepEqual(resolveSafeContextReference("これ", selected), {
    kind: "resolved",
    command: "YouTubeを開いて",
    entryId: youtubeId,
    label: "これ",
  });
  assert.equal(resolveSafeContextReference("3番目", context).kind, "rejected");
  assert.equal(resolveSafeContextReference("これ", context).kind, "rejected");
  assert.equal(resolveSafeContextReference("端末を再起動", context).kind, "none");
});

test("selected context cannot cross device targets or replay redacted credential text", () => {
  let context: SharedCommandContext = { ...emptySharedCommandContext(), targetNodeId: "android-1" };
  context = appendSharedCommandHistory(context, { source: "text", command: "Chromeを開いて", outcome: "sent", targetNodeId: "android-2" }, new Date("2026-09-16T02:00:00.000Z"));
  const otherTargetId = context.history.at(-1)?.id;
  context = appendSharedCommandHistory(context, { source: "text", command: "https://example.com/?token=abc", outcome: "sent", targetNodeId: "android-1" }, new Date("2026-09-16T02:01:00.000Z"));
  const redactedId = context.history.at(-1)?.id;

  assert.match(context.history.at(-1)?.command ?? "", /REDACTED/);
  assert.equal(getSafeContextCandidates(context).length, 0);
  assert.equal(resolveSafeContextReference("これ", { ...context, selectedHistoryId: otherTargetId }).kind, "rejected");
  assert.equal(resolveSafeContextReference("これ", { ...context, selectedHistoryId: redactedId }).kind, "rejected");
});

test("local speech policy defaults muted, validates quiet hours and suppresses sensitive text", () => {
  assert.equal(DEFAULT_SPEECH_POLICY.muted, true);
  const normalized = normalizeSpeechPolicySettings({ muted: false, quietHoursEnabled: true, quietStart: "99:77", quietEnd: "07:30", quietMinimumPriority: "high" });
  assert.equal(normalized.muted, false);
  assert.equal(normalized.quietStart, "22:00");
  assert.equal(normalized.quietEnd, "07:30");
  assert.equal(normalized.quietMinimumPriority, "high");

  const quiet = { ...normalized, quietStart: "22:00", quietEnd: "07:00" };
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 8, 16, 23, 0)), true);
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 8, 17, 6, 30)), true);
  assert.equal(isQuietHoursActive(quiet, new Date(2026, 8, 17, 12, 0)), false);
  assert.deepEqual(shouldSpeakLocal("通常通知", "normal", quiet, new Date(2026, 8, 16, 23, 0)), { allowed: false, reason: "quiet-hours" });
  assert.deepEqual(shouldSpeakLocal("重要通知", "high", quiet, new Date(2026, 8, 16, 23, 0)), { allowed: true });

  for (const sensitive of ["token=abc123", "password=hunter2", "Authorization=secret", "Bearer abc.def", "[REDACTED]"]) {
    assert.equal(containsSensitiveSpeechText(sensitive), true);
    assert.deepEqual(shouldSpeakLocal(sensitive, "critical", { ...quiet, muted: false }, new Date(2026, 8, 17, 12, 0)), { allowed: false, reason: "sensitive" });
  }
});

test("local speech queue is priority ordered and JARVIS voice preference only changes speech profile", () => {
  const ordered = sortSpeechQueueEntries([
    { id: "normal-1", text: "n1", priority: "normal", sequence: 1 },
    { id: "critical-3", text: "c", priority: "critical", sequence: 3 },
    { id: "high-2", text: "h", priority: "high", sequence: 2 },
    { id: "normal-4", text: "n2", priority: "normal", sequence: 4 },
  ]);
  assert.deepEqual(ordered.map((entry) => entry.id), ["critical-3", "high-2", "normal-1", "normal-4"]);
  assert.deepEqual(speechProfileForPreference("deep"), { rate: 0.92, pitch: 0.75, volume: 1 });
  assert.deepEqual(speechProfileForPreference("silent"), { rate: 1, pitch: 1, volume: 0 });
  assert.deepEqual(speechProfileForPreference("unknown"), { rate: 1, pitch: 1, volume: 1 });
});

test("push-to-talk requires explicit activation, cancels local speech first and needs a second explicit execute action", () => {
  assert.match(voiceSurface, /function startListening\(\) \{[\s\S]*?cancelLocalSpeech\(\);[\s\S]*?recognitionConstructor\(\)/);
  assert.match(voiceSurface, /onPointerDown=.*startListening/);
  assert.match(voiceSurface, /onPointerUp=\{\(\) => stopListening\(\)\}/);
  assert.match(voiceSurface, /onKeyDown=.*startListening/);
  assert.match(voiceSurface, /この指示を実行/);
  assert.match(voiceSurface, /onClick=\{\(\) => void executeTranscript\(\)\}/);
  assert.match(voiceSurface, /マイクは自動起動しません/);
  assert.match(voiceSurface, /初期状態はミュート/);
  assert.match(voiceSurface, /有料APIへ送りません/);
  assert.match(voiceSurface, /useEffect\(\(\) => \{\s*setSupported\(Boolean\(recognitionConstructor\(\)\)\);/);
  assert.doesNotMatch(voiceSurface, /useEffect\(\(\) => \{\s*startListening\(\)/);
});

test("voice and text surfaces share target, history and explicit safe context selection", () => {
  for (const surface of [voiceSurface, mobileSurface]) {
    assert.match(surface, /parseSafeMobileCommand/);
    assert.match(surface, /resolveSafeContextReference/);
    assert.match(surface, /saveSharedTargetNode/);
    assert.match(surface, /selectSharedHistoryEntry/);
    assert.match(surface, /recordSharedCommand/);
    assert.match(surface, /まだ端末操作は送信していません/);
    assert.match(surface, /fetch\("\/api\/jarvis\/action"/);
    assert.match(surface, /action: "device-task"/);
  }
  assert.match(voiceSurface, /認識字幕/);
  assert.match(voiceSurface, /aria-live="polite"/);
  assert.match(voiceSurface, /オーナー認証/);
  assert.doesNotMatch(voiceSurface, /lock-device|reboot|factory-reset|approve|permission-change/);
  assert.match(mobileSurface, /履歴を選ぶだけでは端末操作しません/);
  assert.match(voiceSurface, /必ず「この指示を実行」で確定します/);
  assert.match(mobilePage, /href="\/jarvis\/mobile\/voice"/);
});
