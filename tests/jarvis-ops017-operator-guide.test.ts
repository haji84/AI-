import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const settingsPageUrl = new URL("../src/app/jarvis/settings/page.tsx", import.meta.url);
const guideComponentUrl = new URL("../src/app/jarvis/settings/JarvisOperatorGuide.tsx", import.meta.url);
const guideDocUrl = new URL("../docs/JARVIS_OPERATOR_GUIDE.md", import.meta.url);
const primaryShellUrl = new URL("../src/app/jarvis/JarvisPrimaryShell.tsx", import.meta.url);

async function sources() {
  const [settingsPage, guideComponent, guideDoc, primaryShell] = await Promise.all([
    readFile(settingsPageUrl, "utf8"),
    readFile(guideComponentUrl, "utf8"),
    readFile(guideDocUrl, "utf8"),
    readFile(primaryShellUrl, "utf8"),
  ]);
  return { settingsPage, guideComponent, guideDoc, primaryShell };
}

test("OPS-017 exposes the owner guide from Settings without adding a sixth primary screen", async () => {
  const { settingsPage, guideComponent, primaryShell } = await sources();

  assert.match(settingsPage, /import JarvisOperatorGuide from "\.\/JarvisOperatorGuide"/);
  assert.match(settingsPage, /<JarvisOperatorGuide \/>/);
  assert.match(guideComponent, /日常操作ガイド/);
  assert.doesNotMatch(primaryShell, /\/jarvis\/guide|Operator Guide/);

  for (const href of [
    "/jarvis",
    "/jarvis/tasks",
    "/jarvis/devices",
    "/jarvis/diagnostics",
    "/jarvis/recovery",
    "/jarvis/setup",
  ]) {
    assert.match(guideComponent, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`));
  }
});

test("OPS-017 routine guide keeps Human Gate, physical acceptance and unknown states fail-closed", async () => {
  const { guideComponent, guideDoc } = await sources();
  const combined = `${guideComponent}\n${guideDoc}`;

  assert.match(combined, /Human Gate/);
  assert.match(combined, /physical acceptance/);
  assert.match(combined, /unknown/);
  assert.match(combined, /成功扱い.*しない|成功.*ではありません/);
  assert.match(combined, /Gate.*解除.*しない|Gate解除.*行わない/);
  assert.match(combined, /復旧.*強制実行.*行わない/);
});

test("OPS-017 routine owner path contains no developer command procedure or privileged mutation instructions", async () => {
  const { guideComponent, guideDoc } = await sources();
  const combined = `${guideComponent}\n${guideDoc}`;

  assert.doesNotMatch(combined, /(?:^|\s)(?:pnpm|npm|yarn|node)\s+(?:run|scripts?\/)/im);
  assert.doesNotMatch(combined, /powershell|cmd\.exe|Set-ScheduledTask|Register-ScheduledTask|schtasks|tailscale\s+(?:serve|funnel)/i);
  assert.doesNotMatch(combined, /curl\s+https?:\/\//i);
  assert.doesNotMatch(combined, /sk-[a-z0-9_-]+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i);

  assert.match(guideDoc, /端末の再登録/);
  assert.match(guideDoc, /permission \/ token scope/);
  assert.match(guideDoc, /firewall \/ network公開範囲/);
  assert.match(guideDoc, /billing/);
  assert.match(guideDoc, /既存Gateと承認条件/);
});

test("OPS-017 documents a bounded no-command incident-check sequence", async () => {
  const { guideDoc } = await sources();

  const home = guideDoc.indexOf("Homeで全体状態を確認する");
  const diagnostics = guideDoc.indexOf("Diagnosticsで");
  const recovery = guideDoc.indexOf("Recoveryでblocker");
  const stop = guideDoc.indexOf("そこで止める");

  assert.ok(home >= 0);
  assert.ok(diagnostics > home);
  assert.ok(recovery > diagnostics);
  assert.ok(stop > recovery);
});
