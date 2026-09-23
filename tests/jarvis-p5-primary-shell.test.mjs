import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("P5 primary shell exposes the five frozen top-level operating screens", async () => {
  const shell = await source("src/app/jarvis/JarvisPrimaryShell.tsx");
  const layout = await source("src/app/jarvis/layout.tsx");

  for (const [href, label] of [
    ["/jarvis", "ホーム"],
    ["/jarvis/devices", "デバイス"],
    ["/jarvis/tasks", "タスク"],
    ["/jarvis/research", "リサーチ"],
    ["/jarvis/settings", "設定"],
  ]) {
    assert.ok(shell.includes(`href: "${href}"`), `missing ${href}`);
    assert.ok(shell.includes(`label: "${label}"`), `missing ${label}`);
  }

  assert.match(shell, /aria-label="GORIQ メインナビゲーション"/);
  assert.match(shell, /pathname\.startsWith\("\/jarvis\/login"\)/);
  assert.match(layout, /<JarvisPrimaryShell>\{children\}<\/JarvisPrimaryShell>/);
});

test("P5 tasks screen reads owner-protected state and fails visibly on authentication errors", async () => {
  const tasks = await source("src/app/jarvis/tasks/TaskBoard.tsx");
  assert.match(tasks, /fetch\("\/api\/jarvis\/state"/);
  assert.match(tasks, /response\.status === 401/);
  assert.match(tasks, /オーナー認証が必要/);
  assert.match(tasks, /\/jarvis\/login\?next=\/jarvis\/tasks/);
  assert.match(tasks, /権限変更、認証回避、Human Gateの承認処理は行わない/);
});

test("P5 research screen keeps product completion separate from R1-R20 and AGI claims", async () => {
  const research = await source("src/app/jarvis/research/page.tsx");
  assert.match(research, /Research Ops R1-R20/);
  assert.match(research, /製品完成とは別/);
  assert.match(research, /AGI達成とは扱わない/);
  assert.match(research, /正式なR20 Exit Ruleと独立検証が終わるまでAGI claimを行わない/);
});

test("P5 settings are local display preferences only and do not mutate protected settings", async () => {
  const settings = await source("src/app/jarvis/settings/JarvisLocalSettings.tsx");
  const preferences = await source("src/app/jarvis/ui-preferences.ts");
  const accessibility = await source("src/app/jarvis/JarvisAccessibilityControls.tsx");
  const accessibilityPreferences = await source("src/app/jarvis/accessibility-preferences.ts");
  const page = await source("src/app/jarvis/settings/page.tsx");

  assert.match(settings, /readJarvisPreferences/);
  assert.match(settings, /writeJarvisPreferences/);
  assert.match(preferences, /localStorage\.getItem\(JARVIS_PREFERENCE_KEY\)/);
  assert.match(preferences, /localStorage\.setItem\(JARVIS_PREFERENCE_KEY/);
  assert.doesNotMatch(settings, /fetch\(/);
  assert.doesNotMatch(preferences, /fetch\(/);
  assert.doesNotMatch(accessibility, /fetch\(/);
  assert.doesNotMatch(accessibilityPreferences, /fetch\(/);
  assert.match(settings, /端末権限、認証、秘密情報、課金設定には触れない/);
  assert.match(page, /認証情報、端末権限、ネットワーク公開範囲、課金、破壊的操作、Human Gateルール/);
  assert.match(page, /Widget編集[\s\S]*アクセシビリティ表示設定は実装済み/);
  assert.match(page, /音声runtimeの字幕や実機操作性は別途検証する/);
});
