import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_SPEECH_POLICY,
  applySpeechStyle,
  normalizeSpeechPolicySettings,
  speechProfileForPreferences,
} from "../src/app/jarvis/mobile/voice/speech-policy.ts";

const panel = readFileSync(new URL("../src/app/jarvis/mobile/voice/SpeechPersonaStylePanel.tsx", import.meta.url), "utf8");
const voicePage = readFileSync(new URL("../src/app/jarvis/mobile/voice/page.tsx", import.meta.url), "utf8");

test("speech style is separate, bounded and corrupt values fail closed to standard", () => {
  assert.equal(normalizeSpeechPolicySettings({ ...DEFAULT_SPEECH_POLICY, style: "brief" }).style, "brief");
  assert.equal(normalizeSpeechPolicySettings({ ...DEFAULT_SPEECH_POLICY, style: "formal" }).style, "formal");
  assert.equal(normalizeSpeechPolicySettings({ ...DEFAULT_SPEECH_POLICY, style: "wild" }).style, "standard");
  assert.equal(normalizeSpeechPolicySettings(null).muted, true, "conservative muted default remains intact");
});

test("speech style only rewrites known generic status phrases", () => {
  assert.equal(applySpeechStyle("指示を送信しました。", "brief"), "送信しました。");
  assert.equal(applySpeechStyle("指示を送信しました。", "formal"), "確認済みの指示を送信しました。");
  assert.equal(applySpeechStyle("操作する端末を選択してください。", "brief"), "端末を選択してください。");
  assert.equal(applySpeechStyle("任意のサーバー文字列", "brief"), "任意のサーバー文字列");
});

test("persona tuning is bounded and cannot revive silent output", () => {
  const commander = speechProfileForPreferences("neutral", "commander");
  const quiet = speechProfileForPreferences("neutral", "quiet");
  const silent = speechProfileForPreferences("silent", "commander");
  assert.ok(commander.rate > 1 && commander.rate <= 1.3);
  assert.ok(quiet.volume < 1 && quiet.volume >= 0);
  assert.equal(silent.volume, 0);
  assert.ok(commander.pitch >= 0.65 && commander.pitch <= 1.25);
});

test("voice page exposes independent voice, persona and speech-style settings without action paths", () => {
  assert.match(panel, /音声プロファイル/);
  assert.match(panel, /ペルソナ/);
  assert.match(panel, /発話スタイル/);
  assert.match(panel, /Human Gateは変更しません/);
  assert.match(panel, /writeJarvisPreferences/);
  assert.match(panel, /writeSpeechPolicySettings/);
  assert.doesNotMatch(panel, /\/api\/jarvis\/action|device-task|approve|factory-reset|reboot|lock-device/);
  assert.match(voicePage, /<SpeechPersonaStylePanel \/>/);
  assert.match(voicePage, /<MobileVoiceCommander \/>/);
});
