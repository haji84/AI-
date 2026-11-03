import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseDailyDriverDeviceCommand } from "../src/jarvis/daily-driver-device-command.ts";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Daily Driver keeps one general command entry on the GORIQ home", async () => {
  const work = await source("src/app/jarvis/JarvisWorkShell.tsx");
  const home = await source("src/app/jarvis/page.tsx");
  const mobile = await source("src/app/jarvis/mobile/MobileCommander.tsx");

  assert.match(work, /GORIQに何をしてほしい？/);
  assert.match(work, /fetch\("\/api\/jarvis\/work"/);
  assert.doesNotMatch(home, /iPhone司令塔/);
  assert.match(mobile, /普段の指示はGORIQホームから/);
  assert.doesNotMatch(mobile, /JARVISに指示/);
});

test("safe explicit device commands route through the shared Work intake contract", async () => {
  const broker = await source("scripts/jarvis-broker.ts");
  assert.match(broker, /parseDailyDriverDeviceCommand\(text\)/);
  assert.match(broker, /action: "DEVICE_ACTION"/);
  assert.match(broker, /plane\.enqueueTask/);
  assert.equal(parseDailyDriverDeviceCommand("Chrome開いて").kind, "device");
  assert.equal(parseDailyDriverDeviceCommand("GitHubの続きを進めて").kind, "not-device");
});

test("protected device operations remain fail-closed and existing detailed routes remain reachable", async () => {
  const broker = await source("scripts/jarvis-broker.ts");
  const home = await source("src/app/jarvis/page.tsx");
  const parsed = parseDailyDriverDeviceCommand("端末を再起動して");
  assert.equal(parsed.kind, "protected");
  assert.match(broker, /DEVICE_ACTION_PROTECTED/);
  for (const route of ["/jarvis/mobile", "/jarvis/enroll", "/jarvis/setup", "/jarvis/diagnostics", "/jarvis/recovery", "/jarvis/recordings", "/jarvis/qa"]) {
    assert.ok(home.includes(route), `advanced route disappeared: ${route}`);
  }
});
