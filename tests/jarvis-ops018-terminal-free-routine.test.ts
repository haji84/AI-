import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

async function routineSources() {
  const [
    shell,
    home,
    consoleSource,
    taskBoard,
    deviceFleet,
    settings,
    operatorGuide,
    diagnostics,
    recovery,
  ] = await Promise.all([
    source("../src/app/jarvis/JarvisPrimaryShell.tsx"),
    source("../src/app/jarvis/page.tsx"),
    source("../src/app/jarvis/JarvisConsole.tsx"),
    source("../src/app/jarvis/tasks/TaskBoard.tsx"),
    source("../src/app/jarvis/devices/PlatformRemoteAssistFleet.tsx"),
    source("../src/app/jarvis/settings/page.tsx"),
    source("../src/app/jarvis/settings/JarvisOperatorGuide.tsx"),
    source("../src/app/jarvis/diagnostics/page.tsx"),
    source("../src/app/jarvis/recovery/page.tsx"),
  ]);
  return { shell, home, consoleSource, taskBoard, deviceFleet, settings, operatorGuide, diagnostics, recovery };
}

test("OPS-018 keeps routine owner navigation entirely inside the JARVIS UI", async () => {
  const { shell, home, settings, operatorGuide } = await routineSources();

  for (const route of ["/jarvis", "/jarvis/devices", "/jarvis/tasks", "/jarvis/research", "/jarvis/settings"]) {
    assert.match(shell, new RegExp(`href: ["']${route.replaceAll("/", "\\/")}["']`));
  }

  for (const route of ["/jarvis/setup", "/jarvis/diagnostics", "/jarvis/recovery"]) {
    assert.match(home, new RegExp(`href=["']${route.replaceAll("/", "\\/")}["']`));
  }

  assert.match(settings, /<JarvisOperatorGuide \/>/);
  assert.match(operatorGuide, /日常操作ガイド/);
  assert.doesNotMatch(shell, /\/jarvis\/terminal|\/jarvis\/shell|\/jarvis\/guide/);
});

test("OPS-018 routine task, device, diagnostic and recovery flows are UI/API-backed", async () => {
  const { consoleSource, taskBoard, deviceFleet, diagnostics, recovery } = await routineSources();

  assert.match(consoleSource, /fetch\("\/api\/jarvis\/state"/);
  assert.match(consoleSource, /fetch\("\/api\/jarvis\/action"/);
  assert.match(consoleSource, /fetch\("\/api\/jarvis\/remote"/);
  assert.match(taskBoard, /fetch\("\/api\/jarvis\/state"/);
  assert.match(deviceFleet, /fetch\("\/api\/jarvis\/state"/);
  assert.match(diagnostics, /fetch\("\/api\/jarvis\/diagnostics"/);
  assert.match(recovery, /fetch\("\/api\/jarvis\/recovery"/);

  const ownerUi = [consoleSource, taskBoard, deviceFleet, diagnostics, recovery].join("\n");
  assert.doesNotMatch(ownerUi, /node:child_process|child_process|execFile|execSync|spawn\s*\(|powershell|cmd\.exe|Set-ScheduledTask|Register-ScheduledTask|schtasks/i);
  assert.doesNotMatch(ownerUi, /scripts\/jarvis-remote-preflight\.mjs|scripts\/jarvis-power-recovery-check\.mjs/);
});

test("OPS-018 routine UI preserves fail-closed Human Gate and unknown-state boundaries", async () => {
  const { taskBoard, operatorGuide, diagnostics, recovery } = await routineSources();

  assert.match(taskBoard, /Human Gate/);
  assert.match(taskBoard, /Human Gateの承認処理は行わない/);
  assert.match(operatorGuide, /physical acceptance/);
  assert.match(operatorGuide, /unknown.*成功扱いにせず/);
  assert.match(operatorGuide, /日常操作ガイドはGateを解除しない/);
  assert.match(diagnostics, /分からないものは「未確認」のままにします/);
  assert.match(recovery, /ここから復旧操作は実行しません/);
  assert.doesNotMatch(recovery, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
});

test("OPS-018 setup remains one-time and is not presented as permission to mutate gated state", async () => {
  const { operatorGuide } = await routineSources();

  assert.match(operatorGuide, /Setup.*初回構成や再確認が必要なときだけ使う/);
  assert.match(operatorGuide, /端末の再登録、権限・秘密情報・公開範囲の変更、実機受入はこのガイドから自動実行しない/);
});
