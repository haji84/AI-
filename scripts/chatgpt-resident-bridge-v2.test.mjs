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

test("resident bridge v2 excludes pre-existing assistant output by exact phase boundary", () => {
  assert.match(source, /markPhaseCopyBaseline/);
  assert.match(source, /newPhaseCopyReady/);
  assert.match(source, /markPhaseCopyBaseline\(client\)/);
  assert.doesNotMatch(source, /baselineFingerprints/);
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
  assert.match(source, /submitPromptAndReadAnswer\(prompt, surface, isRepairIssue\(issue\)\)/);
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
  assert.match(source, /completionReady/);
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

test("normal conversations may reuse surfaces but repair turns are isolated", () => {
  assert.match(source, /async function prepareProjectSurface\(client, mode, fresh = false\)/);
  assert.match(source, /if \(!fresh && savedUrl\)/);
  assert.match(source, /startFreshProjectConversation/);
  assert.match(source, /CHATGPT_FRESH_PROJECT_SURFACE_ESCAPED/);
  assert.match(source, /if \(!fresh\)[\s\S]*?writeProjectSurface\(mode/);
});

test("isolated repair completion uses final-state controls and one native Copy extraction", () => {
  assert.match(source, /snapshotExecutionUiState/);
  assert.match(source, /completionReady/);
  assert.match(source, /readAloudReady/);
  assert.match(source, /regenerateReady/);
  assert.match(source, /copyAssistantAnswerFromUi/);
  assert.doesNotMatch(source, /snapshotAssistantActionFallback/);
});

test("resident bridge binds initial submission and later outputs to bounded phase identities", () => {
  assert.match(source, /GORIQ_BRIDGE_REQUEST_ID=/);
  assert.match(source, /submittedPrompt/);
  assert.match(source, /CHATGPT_SUBMITTED_TURN_NOT_FOUND/);
  assert.match(source, /message\.role === "user" && message\.text\.includes\(requestMarker\)/);
  assert.match(source, /GORIQ_BRIDGE_PHASE_ID=/);
  assert.match(source, /markPhaseCopyBaseline/);
  assert.doesNotMatch(source, /newMessages = messages\.filter\(\(message\) => !baselineFingerprints\.has/);
});

test("fresh repair may correlate by verified empty baseline when user turn DOM is absent", () => {
  assert.match(source, /const preSubmissionTurns = await snapshotConversationMessages\(client\)/);
  assert.match(source, /const freshBaselineEmpty = fresh && Array\.isArray\(preSubmissionTurns\) && preSubmissionTurns\.length === 0/);
  assert.match(source, /if \(!freshBaselineEmpty\)[\s\S]*CHATGPT_SUBMITTED_TURN_NOT_FOUND/);
  assert.match(source, /markerUserIndex = -1/);
});


test("fresh Chat repair accepts only a newly completed phase response", () => {
  assert.match(source, /if \(!fresh && savedUrl\)/);
  assert.match(source, /startFreshProjectConversation/);
  assert.match(source, /newPhaseCopyReady/);
  assert.match(source, /completionReady/);
  assert.match(source, /copyAssistantAnswerFromUi\(client, phaseMarker\)/);
});


test("fresh repair can recover the final assistant answer through one stable native Copy", () => {
  assert.match(source, /async function copyAssistantAnswerFromUi/);
  assert.match(source, /pbpaste/);
  assert.match(source, /pbcopy/);
  assert.match(source, /GORIQ_CLIPBOARD_SENTINEL_/);
  assert.match(source, /completionReady/);
  assert.match(source, /COMPLETION_STABLE_MS = 1_500/);
  assert.match(source, /newPhaseCopyReady/);
});

test("clipboard fallback restores the prior clipboard and never logs copied answer text", () => {
  assert.match(source, /const previousClipboard = await readMacClipboardText\(\)/);
  assert.match(source, /finally \{[\s\S]*writeMacClipboardText\(previousClipboard\)/);
  assert.doesNotMatch(source, /console\.(?:log|error).*clipboardText/);
  assert.doesNotMatch(source, /setHealth\([^\n]*clipboardText/);
});

test("Chat repair uses one-minute bounded micro-phases before Work escalation", () => {
  assert.match(source, /CHAT_PHASE_BUDGET_MS = 60_000/);
  assert.match(source, /CHAT_MAX_PHASES = 4/);
  assert.match(source, /buildChatRecoveryPhasePrompt/);
  assert.match(source, /Micro-Phase 2: DIAGNOSIS ONLY/);
  assert.match(source, /Micro-Phase 3: MINIMAL CHANGE CONSTRUCTION/);
  assert.match(source, /Micro-Phase 4: FINAL DIFF ONLY/);
  assert.match(source, /one-minute-budget/);
  assert.match(source, /CHAT_REPAIR_PHASES_EXHAUSTED/);
});

test("Retry immediately advances Chat to the next bounded phase", () => {
  assert.match(source, /state\.retryVisible \|\| phaseExpired/);
  assert.match(source, /const reason = state\.retryVisible \? "retry-visible" : "one-minute-budget"/);
  assert.match(source, /stopActiveGeneration/);
  assert.match(source, /submitFollowupPrompt/);
});

test("late phase output is rejected by assistant Copy generation count", () => {
  assert.match(source, /markPhaseCopyBaseline/);
  assert.match(source, /newPhaseCopyReady/);
  assert.match(source, /markPhaseCopyBaseline\(client\)/);
  assert.match(source, /GORIQ_BRIDGE_PHASE_ID=/);
});

test("long Chat repairs are pre-split before the first send", () => {
  assert.match(source, /function shouldPreSplitChatRepair/);
  assert.match(source, /value\.length >= 6000/);
  assert.match(source, /failureEvidenceLength >= 3500/);
  assert.match(source, /allowedCount >= 3/);
  assert.match(source, /GORIQ_CHAT_PRE_SPLIT=true/);
  assert.match(source, /Phase 1: DIAGNOSIS ONLY/);
});

test("every completed planned phase is copied and explicitly reflected into the next phase", () => {
  assert.match(source, /const phaseOutputs = \[\]/);
  assert.match(source, /phaseOutputs\.push\(copied\)/);
  assert.match(source, /boundedPhaseContext\(priorOutputs\)/);
  assert.match(source, /PriorPhase/);
  assert.match(source, /planned-phase-complete/);
});

test("pre-split repair returns only after final phase consolidates one unified diff", () => {
  assert.match(source, /FINALIZATION: consolidate the original goal plus every prior phase result into ONE smallest valid unified diff/);
  assert.match(source, /const finalPhase = phase >= CHAT_MAX_PHASES/);
  assert.match(source, /if \(looksLikeUnifiedDiff\(copied\)\)/);
  assert.match(source, /final-output-not-diff/);
  assert.match(source, /!preSplit && phase === 1 && looksLikeUnifiedDiff\(copied\)/);
});

test("assistant completion controls may live outside main while Retry stays conversation-scoped", () => {
  assert.match(source, /const allButtons = \[\.\.\.document\.querySelectorAll\('button'\)\]\.filter\(visible\)/);
  assert.match(source, /const mainButtons = \[\.\.\.document\.querySelectorAll\('main button'\)\]\.filter\(visible\)/);
  assert.match(source, /const assistantLabels = allLabels\.filter/);
  assert.match(source, /const retryVisible = mainLabels\.some/);
  assert.match(source, /const copyCount = assistantLabels\.filter/);
  assert.match(source, /const buttons = \[\.\.\.document\.querySelectorAll\('button'\)\]\.filter\(\(button\) =>/);
});

test("phase exhaustion diagnostics expose only bounded control metadata", () => {
  assert.match(source, /snapshotSafeControlDiagnostics/);
  assert.match(source, /visibleControlCount/);
  assert.match(source, /aria:/);
  assert.match(source, /testid:/);
  assert.match(source, /inMain:/);
  assert.match(source, /phase-exhausted-ui/);
  assert.doesNotMatch(source, /clipboardText.*phase-exhausted-ui/);
});

test("phase completion is correlated by exact assistant Copy action identity", () => {
  assert.match(source, /async function markPhaseCopyBaseline/);
  assert.match(source, /data-goriq-phase-baseline/);
  assert.match(source, /async function hasNewPhaseCopyAction/);
  assert.match(source, /const newPhaseCopyReady = state\.completionReady && await hasNewPhaseCopyAction\(client\)/);
  assert.match(source, /await markPhaseCopyBaseline\(client\)/);
  assert.doesNotMatch(source, /phaseBaselineCopyCount/);
});

test("temporary safe diagnostics are removed after physical DOM evidence is captured", () => {
  assert.doesNotMatch(source, /snapshotSafeControlDiagnostics/);
  assert.doesNotMatch(source, /phase-exhausted-ui/);
});
