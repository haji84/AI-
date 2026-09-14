import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const accessibility = readFileSync('android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt', 'utf8');
const broker = readFileSync('android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt', 'utf8');
const executor = readFileSync('android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt', 'utf8');
const runtime = readFileSync('android/jarvis-worker/app/src/main/java/ai/jarvis/worker/WorkerRuntimeState.kt', 'utf8');
const commander = readFileSync('scripts/jarvis-direct-commander-v5-launcher.mjs', 'utf8');
const spec = readFileSync('docs/JARVIS_WORKER_STABLE_SPEC.md', 'utf8');

test('generic Worker owns mechanics while Commander owns business recipe', () => {
  assert.match(accessibility, /"open-sheet-cell-link"/);
  assert.match(accessibility, /"wait-outcome"/);
  assert.match(accessibility, /retries.*coerceIn\(0, 3\)/s);
  assert.doesNotMatch(accessibility, /stage\.lowercase\(\)/);
  assert.doesNotMatch(accessibility, /goldfishSuccessTexts|qrSuccessTexts|goldfishTexts|qrTexts/);
  assert.match(commander, /recipeId:'tiktok-lite-sheet-v1'/);
  assert.match(commander, /successTexts:\['イベント詳細','獲得履歴'\]/);
  assert.match(commander, /successTexts:\['受け取りしました','マイQRコードを表示'\]/);
  assert.match(commander, /task\('workflow-recipe'/);
});

test('Worker telemetry exposes fleet progress without enrollment secrets', () => {
  assert.match(broker, /"charging"/);
  assert.match(broker, /"network"/);
  assert.match(broker, /"screenInteractive"/);
  assert.match(broker, /"currentPackage"/);
  assert.match(broker, /"workerVersion"/);
  assert.match(broker, /WorkerRuntimeState\.snapshot\(\)/);
  assert.match(runtime, /"currentTaskId"/);
  assert.match(runtime, /"currentStepAction"/);
  assert.match(runtime, /"lastError"/);
  assert.doesNotMatch(runtime, /token|grant|secret/i);
});

test('recipe execution remains compatible and fail-stop', () => {
  assert.match(executor, /"ui-sequence", "workflow-recipe" -> uiSequence/);
  assert.match(executor, /Device is locked; human unlock is required/);
  assert.match(accessibility, /throw IllegalStateException\("UI action failed at step/);
  assert.match(accessibility, /swipeByRatio/);
});

test('stable specification freezes layer boundaries and physical-device evidence rule', () => {
  assert.match(spec, /Commander: chooses what to run/);
  assert.match(spec, /Android Worker: generic device execution engine/);
  assert.match(spec, /physical-device E2E/i);
});
