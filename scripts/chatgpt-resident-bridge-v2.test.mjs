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

test("resident bridge routes repair metadata to Chat or Work", () => {
  assert.match(source, /repairSurfaceFromPending/);
  assert.match(source, /repair-surface:\(chat\|work\)/);
  assert.match(source, /submitPromptAndReadAnswer\(prompt, surface\)/);
});

test("Work repair fails closed when the Work selector cannot be found", () => {
  assert.match(source, /async function selectExperience/);
  assert.match(source, /CHATGPT_WORK_SELECTOR_NOT_FOUND/);
  assert.match(source, /CHATGPT_WORK_OPTION_NOT_FOUND/);
});

test("macOS installer detaches resident bridge from the GitHub Actions runner workspace", () => {
  assert.match(installer, /RUNTIME_DIR="\$STATE_DIR\/runtime"/);
  assert.match(installer, /cp "\$REPO_DIR\/scripts\/chatgpt-resident-bridge-v2\.mjs" "\$BRIDGE_SCRIPT"/);
  assert.match(installer, /cp "\$REPO_DIR\/scripts\/chatgpt-resident-bridge-lib\.mjs" "\$BRIDGE_LIB"/);
  assert.match(installer, /unset RUNNER_TRACKING_ID/);
  assert.match(installer, /RUNNER_TRACKING_ID<\/key>[\s\S]*?<string><\/string>/);
  assert.match(installer, /ProgramArguments[\s\S]*?LAUNCHER_XML/);
});
