import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, "chatgpt-resident-bridge-v2.mjs"), "utf8");
const installer = await readFile(join(here, "install-macos-chatgpt-bridge.sh"), "utf8");

test("resident bridge v2 opens ChatGPT only through the Automation project surface", () => {
  assert.match(source, /async function createChatGptTarget\(url = CHATGPT_URL\)/);
  assert.match(source, /PROJECT_NAME/);
  assert.match(source, /chatgpt-project-surfaces\.json/);
  assert.match(source, /openAutomationProject/);
  assert.match(source, /prepareProjectSurface/);
  assert.match(source, /CHATGPT_AUTOMATION_PROJECT_NOT_FOUND/);
  assert.match(source, /CHATGPT_PROJECT_SURFACE_ESCAPED/);
  assert.doesNotMatch(source, /createFreshChatGptTarget/);
});

test("resident bridge v2 excludes pre-existing assistant messages", () => {
  assert.match(source, /snapshotAssistantMessages/);
  assert.match(source, /baselineFingerprints/);
  assert.match(source, /newMessages = messages\.filter/);
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

test("repair issues are excluded from resident polling and supported by one-shot mode", () => {
  assert.match(source, /function isRepairIssue/);
  assert.match(source, /filter\(\(issue\) => !isRepairIssue\(issue\)\)/);
  assert.match(source, /AI_COMPANY_REPAIR_ONCE_ISSUE/);
  assert.match(source, /async function runOneShotRepair/);
  assert.match(source, /REPAIR_ISSUE_NOT_PENDING/);
});

test("project-scoped repair metadata accepts normal whitespace separators", () => {
  assert.match(source, /return \/\(\?:\^\|\\s\)repair-surface:\(chat\|work\)\(\?:\\s\|\$\)\/i\.test\(pendingMeta\)/);
  assert.match(source, /meta\.match\(\/\(\?:\^\|\\s\)repair-surface:\(chat\|work\)\(\?:\\s\|\$\)\/i\)/);
  assert.doesNotMatch(source, /\(\?:\^\|\\\\s\)repair-surface/);
});

test("fresh reply detection does not require ChatGPT URL transition", () => {
  assert.doesNotMatch(source, /conversationAdvanced/);
  assert.match(source, /if \(candidate\?\.text\)/);
});

test("prompt submission brings the tab forward and cascades mouse form and raw Enter submission", () => {
  assert.match(source, /Page\.bringToFront/);
  assert.match(source, /button\[data-testid="send-button"\]/);
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /mousePressed/);
  assert.match(source, /mouseReleased/);
  assert.match(source, /requestSubmit/);
  assert.match(source, /rawKeyDown/);
  assert.match(source, /windowsVirtualKeyCode: 13/);
  assert.match(source, /const submissionState = async/);
  assert.match(source, /const isSubmitted/);
  assert.match(source, /CHATGPT_SUBMIT_FAILED/);
});

test("fresh-turn timeout records bounded browser diagnostics", () => {
  assert.match(source, /assistantCount/);
  assert.match(source, /lastAssistant/);
  assert.match(source, /composerText/);
  assert.match(source, /diagnostic=/);
});

test("current ChatGPT DOM fallback detects assistant and user turns by action controls", () => {
  assert.match(source, /snapshotConversationMessages/);
  assert.match(source, /回答を再生成\|regenerate/);
  assert.match(source, /メッセージを編集\|edit message/);
  assert.match(source, /data-testid\^="conversation-turn"/);
});

test("assistant snapshot falls back to rendered markdown when role attributes disappear", () => {
  assert.match(source, /main \.markdown, main \[class\*="markdown"\]/);
  assert.match(source, /if \(assistants\.length\) return assistants/);
  assert.match(source, /role: 'assistant'/);
});

test("successful repair stores the project-scoped surface URL for reuse", () => {
  assert.match(source, /writeProjectSurface\(mode/);
  assert.match(source, /readProjectSurfaces/);
});

test("assistant snapshot can infer the answer container from response action controls", () => {
  assert.match(source, /const actionPattern = \/回答を再生成\|regenerate\|読み上げ\|read aloud\|リアクション\|reaction\|コピーする\|copy\/i/);
  assert.match(source, /depth < 10/);
  assert.match(source, /hasComposer/);
  assert.match(source, /hasSidebar/);
  assert.match(source, /text\.length > 12000/);
  assert.match(source, /if \(Array\.isArray\(markdown\) && markdown\.length\) return markdown/);
});

test("resident bridge binds a reply to the exact submitted user turn", () => {
  assert.match(source, /GORIQ_BRIDGE_REQUEST_ID=/);
  assert.match(source, /submittedPrompt/);
  assert.match(source, /CHATGPT_SUBMITTED_TURN_NOT_FOUND/);
  assert.match(source, /message\.role === "user" && message\.text\.includes\(requestMarker\)/);
  assert.match(source, /message\.role === "assistant" && message\.index > markerUserIndex/);
  assert.doesNotMatch(source, /newMessages = messages\.filter\(\(message\) => !baselineFingerprints\.has/);
});
