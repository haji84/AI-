import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("native GORIQ opens on the Daily Driver home and preserves Owner security tools", async () => {
  const app = await source("apps/ios-owner/Sources/JarvisIOSOwnerApp.swift");
  const info = await source("apps/ios-owner/Info.plist");
  assert.match(app, /TabView/);
  assert.match(app, /DailyDriverView/);
  assert.match(app, /Label\("ホーム"/);
  assert.match(app, /OwnerCredentialView/);
  assert.match(info, /<key>CFBundleDisplayName<\/key><string>GORIQ<\/string>/);
});

test("native Daily Driver uses one composer and durable Goal polling", async () => {
  const app = await source("apps/ios-owner/Sources/JarvisIOSOwnerApp.swift");
  const runtime = await source("apps/ios-owner/Sources/DailyDriverRuntime.swift");
  assert.match(app, /GORIQに何をしてほしい？/);
  assert.match(runtime, /path: "\/api\/jarvis\/work"/);
  assert.ok(runtime.includes('path: "/api/jarvis/work/\\(goalId)"'));
  assert.match(runtime, /goriq-native-last-goal-id/);
  assert.match(runtime, /HUMAN_GATE/);
  assert.match(runtime, /DEVICE_ACTION_PROTECTED/);
  assert.match(runtime, /if result\.statusCode == 401 \{[\s\S]*ensureOwnerSession[\s\S]*ownerAPIRequest/);
});

test("native Daily Driver reuses trusted-device proof instead of embedding owner secrets", async () => {
  const owner = await source("apps/ios-owner/Sources/OwnerCredentialRuntime.swift");
  const runtime = await source("apps/ios-owner/Sources/DailyDriverRuntime.swift");
  assert.match(owner, /ensureOwnerSession/);
  assert.match(owner, /verifyTrustedDeviceProof/);
  assert.match(owner, /SecureEnclave\.P256\.Signing\.PrivateKey/);
  assert.match(owner, /ownerAPIRequest/);
  assert.match(runtime, /try await owner\.ensureOwnerSession\(extendIdle: true\)/);
  assert.doesNotMatch(runtime, /JARVIS_OWNER_SECRET|AI_COMPANY_OWNER_SECRET|Authorization:\s*Bearer/);
});
