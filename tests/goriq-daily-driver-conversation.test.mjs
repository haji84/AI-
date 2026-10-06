import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("global conversation is mounted on every primary GORIQ screen and keeps current screen as context, not authority", async () => {
  const [shell, launcher, chat, commandRoute, bridge] = await Promise.all([
    source("src/app/jarvis/JarvisPrimaryShell.tsx"),
    source("src/app/jarvis/GlobalConversationLauncher.tsx"),
    source("src/app/CommandChat.tsx"),
    source("src/app/api/command/route.ts"),
    source("scripts/chatgpt-resident-bridge-lib.mjs"),
  ]);
  assert.match(shell, /<GlobalConversationLauncher \/>/);
  assert.match(launcher, /GORIQと会話/);
  assert.match(launcher, /contextPath=\{pathname\}/);
  assert.match(chat, /screenContext: contextPath/);
  assert.match(chat, /inputMode: source/);
  assert.match(commandRoute, /currentScreen: screenContext/);
  assert.match(commandRoute, /inputMode/);
  assert.match(bridge, /検索範囲を制限しません/);
});

test("shared conversation keeps visible voice transcript and speaks a new AI bridge reply through local TTS", async () => {
  const chat = await source("src/app/CommandChat.tsx");
  assert.match(chat, /recognitionConstructor/);
  assert.match(chat, /音声入力/);
  assert.match(chat, /setCommand\(next\.slice\(0, 500\)\)/);
  assert.match(chat, /startConversationPolling/);
  assert.match(chat, /latestAi/);
  assert.match(chat, /playGoriqLocalVoice\(latestAi\.text\)/);
  assert.match(chat, /history-list/);
});

test("new-development room exposes Goal spec design technology and DoD before one final start action", async () => {
  const [page, room] = await Promise.all([
    source("src/app/jarvis/new-development/page.tsx"),
    source("src/app/jarvis/new-development/DevelopmentDesignRoom.tsx"),
  ]);
  assert.match(page, /<DevelopmentDesignRoom enabled=\{enabled\} \/>/);
  for (const label of ["Goal", "仕様", "設計", "技術", "完了条件"]) assert.ok(room.includes(`label: "${label}"`), `missing ${label}`);
  assert.match(room, /status: "confirmed"/);
  assert.match(room, /仕様・設計を確定して開発開始/);
  assert.match(room, /goriq-command-submit/);
  assert.match(room, /既存Goal Controller/);
});

test("voice settings are dedicated, local-first, fail-visible and do not silently use a paid provider", async () => {
  const [settingsPage, settings, route, broker] = await Promise.all([
    source("src/app/jarvis/settings/page.tsx"),
    source("src/app/jarvis/settings/GoriqVoiceSettings.tsx"),
    source("src/app/api/jarvis/voice/route.ts"),
    source("scripts/jarvis-broker.ts"),
  ]);
  assert.match(settingsPage, /<GoriqVoiceSettings \/>/);
  assert.match(settings, /<h2>声<\/h2>/);
  assert.match(settings, /AivisSpeech Engine/);
  assert.match(settings, /VOICEVOX Engine/);
  assert.match(settings, /有料APIへ自動で切り替えません/);
  assert.match(settings, /試し聞き/);
  assert.match(route, /jarvisBrokerFetch\("\/api\/jarvis\/admin\/voice"/);
  assert.match(broker, /discoverLocalTts/);
  assert.match(broker, /synthesizeLocalTts/);
});
