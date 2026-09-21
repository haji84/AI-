import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { serviceSpecs } from "../scripts/jarvis-managed-process.mjs";
import { inspectPrivateIngress } from "../scripts/jarvis-remote-access-lib.mjs";
import { windowsStartupTaskReadiness } from "../scripts/jarvis-power-recovery-lib.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function readyWindowsStartupTask() {
  return {
    State: "Ready",
    Settings: {
      Enabled: true,
      DisallowStartIfOnBatteries: false,
      StopIfGoingOnBatteries: false,
      RunOnlyIfNetworkAvailable: false,
      RestartInterval: "PT1M",
      RestartCount: 20,
      StartWhenAvailable: true,
      ExecutionTimeLimit: "PT0S",
      MultipleInstances: "IgnoreNew",
    },
    Principal: {
      IdentityPresent: true,
      MatchesCurrentIdentity: true,
      LogonType: "Password",
      RunLevel: "Limited",
    },
    Triggers: [{ Type: "MSFT_TaskBootTrigger", Enabled: true }],
    Actions: [{
      Execute: "C:\\Program Files\\nodejs\\node.exe",
      Arguments: "scripts\\jarvis-remote-host.mjs",
      WorkingDirectory: "C:\\JARVIS",
    }],
  };
}

const expectedWindowsAction = {
  repoRoot: "C:\\JARVIS",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
};

test("ACC-004 keeps the supported Windows autostart path explicit and boot-triggered", async () => {
  const installer = await source("scripts/install-jarvis-remote-autostart-windows.ps1");

  assert.match(installer, /\[switch\]\$AtStartup/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(installer, /AtStartup mode requires an elevated PowerShell/);
  assert.match(installer, /-RestartCount 20 -RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /pnpm jarvis:remote:host/);
  assert.match(installer, /an AtStartup trigger alone does not prove pre-logon unattended execution/);
});

test("ACC-004 startup readiness fails closed unless unattended host requirements are all present", () => {
  const ready = windowsStartupTaskReadiness(readyWindowsStartupTask(), expectedWindowsAction);
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.failed, []);
  assert.equal(ready.physicalRecoveryVerified, false);

  const interactive = readyWindowsStartupTask();
  interactive.Principal.LogonType = "Interactive";
  const interactiveVerdict = windowsStartupTaskReadiness(interactive, expectedWindowsAction);
  assert.equal(interactiveVerdict.ok, false);
  assert.ok(interactiveVerdict.failed.includes("logon-type"));

  const noBoot = readyWindowsStartupTask();
  noBoot.Triggers = [];
  const noBootVerdict = windowsStartupTaskReadiness(noBoot, expectedWindowsAction);
  assert.equal(noBootVerdict.ok, false);
  assert.ok(noBootVerdict.failed.includes("boot-trigger"));
});

test("ACC-004 host supervisor contract includes Broker, Gateway and loopback Dashboard", async () => {
  const specs = serviceSpecs("C:\\JARVIS", "node", "3000");
  assert.deepEqual(specs.map((spec) => spec.name), ["broker", "remote-gateway", "dashboard"]);
  assert.match(specs.find((spec) => spec.name === "broker").args[0], /jarvis-broker\.ts$/);
  assert.match(specs.find((spec) => spec.name === "remote-gateway").args[0], /jarvis-remote-gateway\.ts$/);
  assert.deepEqual(specs.find((spec) => spec.name === "dashboard").args.slice(-4), ["start", "-H", "127.0.0.1", "-p", "3000"].slice(-4));

  const host = await source("scripts/jarvis-remote-host.mjs");
  const managed = await source("scripts/jarvis-managed-process.mjs");
  assert.match(host, /for \(const spec of specs\) startManaged\(spec\)/);
  assert.match(host, /onExhausted: \(\) => shutdown\('restart-budget-exhausted', 2\)/);
  assert.match(managed, /const maxFailures = options\.maxFailures \?\? 20/);
  assert.match(managed, /const delay = restartDelayMs\(failures\)/);
  assert.match(managed, /timer = schedule\(start, delay\)/);
});

test("ACC-004 reconnect exposure remains private-only and unknown/public ingress fails closed", () => {
  const privateConfig = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {
      "jarvis.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } },
      },
    },
    AllowFunnel: { "jarvis.example.ts.net:443": false },
  });
  const privateVerdict = inspectPrivateIngress(privateConfig, { dnsName: "jarvis.example.ts.net", dashboardPort: 3000 });
  assert.equal(privateVerdict.ready, true);
  assert.equal(privateVerdict.state, "private");

  const publicVerdict = inspectPrivateIngress(JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {},
    AllowFunnel: { "jarvis.example.ts.net:443": true },
  }), { dnsName: "jarvis.example.ts.net", dashboardPort: 3000 });
  assert.equal(publicVerdict.ready, false);
  assert.equal(publicVerdict.state, "public");

  const unknownVerdict = inspectPrivateIngress("not-json", { dnsName: "jarvis.example.ts.net", dashboardPort: 3000 });
  assert.equal(unknownVerdict.ready, false);
  assert.equal(unknownVerdict.state, "unknown");
});
