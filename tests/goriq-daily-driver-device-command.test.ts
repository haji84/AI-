import test from "node:test";
import assert from "node:assert/strict";
import { parseDailyDriverDeviceCommand } from "../src/jarvis/daily-driver-device-command.ts";

test("routes explicit app launch commands to a safe device task", () => {
  assert.deepEqual(parseDailyDriverDeviceCommand("Chrome開いて"), {
    kind: "device",
    task: { type: "open-app", payload: { packageName: "com.android.chrome" } },
  });
});

test("routes explicit device status while leaving generic status for GORIQ work", () => {
  assert.equal(parseDailyDriverDeviceCommand("スマホの状態確認して").kind, "device");
  assert.equal(parseDailyDriverDeviceCommand("GORIQの状態確認して").kind, "not-device");
});

test("requires an execution verb before routing settings and URLs", () => {
  assert.equal(parseDailyDriverDeviceCommand("Wi-Fiについて調べて").kind, "not-device");
  assert.equal(parseDailyDriverDeviceCommand("https://example.com を調査して").kind, "not-device");
  assert.equal(parseDailyDriverDeviceCommand("Wi-Fi設定開いて").kind, "device");
  assert.equal(parseDailyDriverDeviceCommand("https://example.com 開いて").kind, "device");
});

test("protected device commands are never auto-routed", () => {
  const result = parseDailyDriverDeviceCommand("端末を再起動して");
  assert.equal(result.kind, "protected");
});

test("ordinary development and research commands remain in unified work intake", () => {
  assert.equal(parseDailyDriverDeviceCommand("GitHubのバグ直して").kind, "not-device");
  assert.equal(parseDailyDriverDeviceCommand("ホルムズ海峡について調べて").kind, "not-device");
});
