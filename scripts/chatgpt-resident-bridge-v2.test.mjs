import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, "chatgpt-resident-bridge-v2.mjs"), "utf8");
const installer = await readFile(join(here, "install-macos-chatgpt-bridge.sh"), "utf8");

test("resident bridge v2 always creates a fresh ChatGPT target", () => {
  assert.match(source, /async function createFreshChatGptTarget\(\)/);
  assert.match(source, /\/json\/new\?/);
  assert.doesNotMatch(source, /targets\.find\(/);
});

test("resident bridge v2 excludes pre-existing assistant messages", () => {
  assert.match(source, /snapshotAssistantMessages/);
  assert.match(source, /baselineFingerprints/);
  assert.match(source, /newMessages = messages\.filter/);
});

test("resident bridge v2 requires a conversation advance before accepting answer", () => {
  assert.match(source, /conversationAdvanced/);
  assert.match(source, /candidate\?\.text && conversationAdvanced/);
});

test("resident bridge v2 closes its disposable target", () => {
  assert.match(source, /await closeTarget\(target\.id\)/);
});

test("macOS installer points launchd at bridge v2", () => {
  assert.match(installer, /chatgpt-resident-bridge-v2\.mjs/);
});
