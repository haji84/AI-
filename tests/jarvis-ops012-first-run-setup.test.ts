import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { buildJarvisFirstRunSetup } from "../src/jarvis/first-run-setup.ts";
import type {
  JarvisDiagnosticCode,
  JarvisDiagnosticItem,
  JarvisDiagnosticState,
} from "../src/jarvis/self-diagnostics.ts";

function diagnostic(
  code: JarvisDiagnosticCode,
  state: JarvisDiagnosticState = "ready",
  action?: string,
): JarvisDiagnosticItem {
  return {
    code,
    label: code,
    state,
    detail: `${code} ${state}`,
    ...(action ? { action } : {}),
  };
}

function completeDiagnostics(): JarvisDiagnosticItem[] {
  return [
    diagnostic("AUTH"),
    diagnostic("BUILD"),
    diagnostic("TAILSCALE"),
    diagnostic("HOST"),
    diagnostic("BROKER"),
    diagnostic("GATEWAY"),
    diagnostic("WORKER"),
    diagnostic("DEVICE_PERMISSION"),
    diagnostic("FIRMWARE_GATE"),
    diagnostic("HUMAN_GATE"),
  ];
}

test("OPS-012 groups existing diagnostics into host, connection, and permissions in setup order", () => {
  const setup = buildJarvisFirstRunSetup(completeDiagnostics());

  assert.equal(setup.overall, "ready");
  assert.deepEqual(setup.steps.map((step) => step.id), ["host", "connection", "permissions"]);
  assert.deepEqual(setup.steps[0]?.diagnostics.map((entry) => entry.code), ["BUILD", "HOST", "FIRMWARE_GATE"]);
  assert.deepEqual(setup.steps[1]?.diagnostics.map((entry) => entry.code), ["TAILSCALE", "BROKER", "GATEWAY", "WORKER"]);
  assert.deepEqual(setup.steps[2]?.diagnostics.map((entry) => entry.code), ["AUTH", "DEVICE_PERMISSION"]);
  assert.equal(setup.steps.every((step) => step.state === "ready"), true);
});

test("OPS-012 preserves known blockers and never upgrades incomplete evidence to ready", () => {
  const items = completeDiagnostics().filter((entry) => entry.code !== "HOST" && entry.code !== "GATEWAY");
  const broker = items.find((entry) => entry.code === "BROKER");
  assert.ok(broker);
  broker.state = "blocked";
  broker.action = "Brokerを確認してください";

  const setup = buildJarvisFirstRunSetup(items);
  const host = setup.steps.find((step) => step.id === "host");
  const connection = setup.steps.find((step) => step.id === "connection");

  assert.equal(host?.state, "unknown");
  assert.match(host?.detail ?? "", /診断結果が不足/);
  assert.equal(connection?.state, "blocked");
  assert.deepEqual(connection?.actions, ["Brokerを確認してください"]);
  assert.equal(setup.overall, "blocked");
});

test("OPS-012 keeps firmware physical evidence pending instead of presenting first-run as complete", () => {
  const items = completeDiagnostics();
  const firmware = items.find((entry) => entry.code === "FIRMWARE_GATE");
  assert.ok(firmware);
  firmware.state = "pending";
  firmware.action = "実機で確認してください";

  const setup = buildJarvisFirstRunSetup(items);
  const host = setup.steps.find((step) => step.id === "host");

  assert.equal(host?.state, "pending");
  assert.equal(setup.overall, "pending");
  assert.deepEqual(host?.actions, ["実機で確認してください"]);
});

test("OPS-012 page is owner-gated and the wizard only reads the authenticated diagnostics endpoint", async () => {
  const page = await readFile(new URL("../src/app/jarvis/setup/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../src/app/jarvis/setup/SetupWizardClient.tsx", import.meta.url), "utf8");
  const jarvisPage = await readFile(new URL("../src/app/jarvis/page.tsx", import.meta.url), "utf8");

  assert.match(page, /requireJarvisOwner\(\)/);
  assert.match(client, /fetch\("\/api\/jarvis\/diagnostics", \{ cache: "no-store" \}\)/);
  assert.match(client, /ホスト、接続、権限を順番に確認/);
  assert.match(client, /設定を自動変更しません/);
  assert.match(jarvisPage, /href="\/jarvis\/setup">初回セットアップ/);

  assert.doesNotMatch(client, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(client, /\/api\/jarvis\/(?:enroll|takeover|resume|task|command)/i);
  assert.doesNotMatch(client, /tailscale[^\n]*(?:up|serve|funnel)|netsh|Set-ScheduledTask|Register-ScheduledTask/i);
});
