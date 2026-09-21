import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { buildJarvisSelfDiagnostics } from "../src/jarvis/self-diagnostics.ts";

function byCode(report: ReturnType<typeof buildJarvisSelfDiagnostics>) {
  return new Map(report.items.map((entry) => [entry.code, entry]));
}

test("OPS-008 reports concrete blockers and preserves Human/Firmware gates as pending", () => {
  const report = buildJarvisSelfDiagnostics({
    ownerAuthConfigured: false,
    brokerAuthConfigured: false,
    gatewayAuthConfigured: false,
    productionBuildPresent: false,
    tailscale: "stopped",
    hostObserved: false,
    broker: "unreachable",
    gateway: "auth-missing",
    workerTotal: 0,
    workerReady: 0,
    workerOffline: 0,
    devicePermissionBlockers: ["Android 001: 自動操作権限を確認してください"],
    firmwareGate: "manual-required",
    humanGateCount: 2,
  });
  const items = byCode(report);

  assert.equal(report.overall, "blocked");
  for (const code of ["AUTH", "BUILD", "TAILSCALE", "HOST", "BROKER", "GATEWAY", "WORKER", "DEVICE_PERMISSION"] as const) {
    assert.equal(items.get(code)?.state, "blocked", code);
  }
  assert.equal(items.get("FIRMWARE_GATE")?.state, "pending");
  assert.equal(items.get("HUMAN_GATE")?.state, "pending");
  assert.match(items.get("HUMAN_GATE")?.detail ?? "", /2件/);
});

test("OPS-008 refuses to invent Tailscale or host root causes when evidence is ambiguous", () => {
  const report = buildJarvisSelfDiagnostics({
    ownerAuthConfigured: true,
    brokerAuthConfigured: true,
    gatewayAuthConfigured: true,
    productionBuildPresent: undefined,
    tailscale: "unknown",
    hostObserved: undefined,
    broker: "unreachable",
    gateway: "unknown",
    workerTotal: undefined,
    devicePermissionBlockers: undefined,
    firmwareGate: "unknown",
    humanGateCount: undefined,
  });
  const items = byCode(report);

  assert.equal(items.get("BROKER")?.state, "blocked");
  assert.equal(items.get("TAILSCALE")?.state, "unknown");
  assert.equal(items.get("HOST")?.state, "unknown");
  assert.match(items.get("TAILSCALE")?.detail ?? "", /原因を決めつけません/);
  assert.match(items.get("HOST")?.detail ?? "", /区別できる証拠がありません/);
});

test("OPS-008 reaches ready only when every observable software diagnostic is ready or not applicable", () => {
  const report = buildJarvisSelfDiagnostics({
    ownerAuthConfigured: true,
    brokerAuthConfigured: true,
    gatewayAuthConfigured: true,
    productionBuildPresent: true,
    tailscale: "running",
    hostObserved: true,
    broker: "ready",
    gateway: "ready",
    workerTotal: 3,
    workerReady: 2,
    workerOffline: 1,
    devicePermissionBlockers: [],
    firmwareGate: "not-applicable",
    humanGateCount: 0,
  });

  assert.equal(report.overall, "ready");
  assert.equal(report.items.length, 10);
  assert.equal(report.items.every((entry) => entry.state === "ready"), true);
});

test("OPS-008 diagnostics API is owner-gated, read-only, no-store and uses only read probes", async () => {
  const routeSource = await readFile(new URL("../src/app/api/jarvis/diagnostics/route.ts", import.meta.url), "utf8");

  assert.match(routeSource, /requireJarvisOwner\(\)/);
  assert.match(routeSource, /Cache-Control.*no-store/);
  assert.match(routeSource, /execFileSync\(command, \["status", "--json"\]/);
  assert.match(routeSource, /jarvisBrokerFetch\("\/api\/jarvis\/admin\/state"/);
  assert.match(routeSource, /jarvisRemoteGatewayFetch\("\/api\/remote\/devices"/);
  assert.doesNotMatch(routeSource, /tailscale[^\n]*serve[^\n]*--bg/i);
  assert.doesNotMatch(routeSource, /Set-ScheduledTask|Register-ScheduledTask|schtasks(?:\.exe)?[^\n]*\/Create/i);
  assert.doesNotMatch(routeSource, /pmset[^\n]*-a|netsh[^\n]*firewall/i);
});

test("OPS-008 has an owner-facing page linked from the primary JARVIS page", async () => {
  const diagnosticsPage = await readFile(new URL("../src/app/jarvis/diagnostics/page.tsx", import.meta.url), "utf8");
  const jarvisPage = await readFile(new URL("../src/app/jarvis/page.tsx", import.meta.url), "utf8");

  assert.match(diagnosticsPage, /fetch\("\/api\/jarvis\/diagnostics", \{ cache: "no-store" \}\)/);
  assert.match(diagnosticsPage, /JARVIS SELF DIAGNOSTICS/);
  assert.match(diagnosticsPage, /分からないものは「未確認」のまま/);
  assert.match(jarvisPage, /href="\/jarvis\/diagnostics">自己診断/);
});
