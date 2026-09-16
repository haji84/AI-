import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  macAutoRestartEnabled,
  macSystemDaemonLoaded,
  recoveryVerdict,
  windowsStartupTaskReadiness,
  windowsTailscaleServiceReady,
} from './jarvis-power-recovery-lib.mjs';
import { inspectPrivateIngress, tailscaleBackendIsRunning } from './jarvis-remote-access-lib.mjs';

const root = process.cwd();
const checks = {};

function run(command, args = [], options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout ?? 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (options.allowFailure) return String(error?.stdout || error?.stderr || error?.message || '').trim();
    throw error;
  }
}

function add(name, ok, detail, required = true) {
  checks[name] = { ok: Boolean(ok), detail, required };
  console.log(`${ok ? 'PASS' : required ? 'FAIL' : 'WARN'} ${name}: ${detail}`);
}

add('production-build', fs.existsSync(path.join(root, '.next', 'BUILD_ID')), 'Next production build exists (.next/BUILD_ID)');

const tailscale = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
let tsStatus;
try {
  tsStatus = JSON.parse(run(tailscale, ['status', '--json']));
  add('tailscale-connected', tailscaleBackendIsRunning(tsStatus), `BackendState=${tsStatus?.BackendState || 'unknown'}`);
} catch (error) {
  add('tailscale-connected', false, `Tailscale status unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

let ingress = { ready: false, reason: 'Tailscale configuration could not be read' };
try {
  ingress = inspectPrivateIngress(run(tailscale, ['serve', 'status', '--json']), { dashboardPort: Number(process.env.JARVIS_DASHBOARD_PORT || 3000), dnsName: tsStatus?.Self?.DNSName });
} catch { /* Unknown is a failed check, never a private-ingress PASS. */ }
add('private-ingress-only', ingress.ready, ingress.reason);

if (process.platform === 'darwin') {
  const pmset = run('/usr/bin/pmset', ['-g', 'custom'], { allowFailure: true });
  add('mac-power-restore', macAutoRestartEnabled(pmset), 'pmset autorestart=1 is required for AC power restoration');
  const daemon = run('/bin/launchctl', ['print', 'system/ai.jarvis.remote-host'], { allowFailure: true });
  add('mac-system-autostart', macSystemDaemonLoaded(daemon), 'system LaunchDaemon ai.jarvis.remote-host is loaded');
} else if (process.platform === 'win32') {
  const taskJson = run('powershell.exe', ['-NoProfile', '-File', path.join(root, 'scripts/inspect-jarvis-startup-windows.ps1')], { allowFailure: true });
  let task = null;
  try { task = taskJson ? JSON.parse(taskJson) : null; } catch {}
  const startup = windowsStartupTaskReadiness(task, { repoRoot: root, nodePath: process.execPath });
  for (const [name, check] of Object.entries(startup.checks)) add(`windows-startup-${name}`, check.ok, check.detail);

  const svcJson = run('powershell.exe', ['-NoProfile', '-Command', "$s=Get-CimInstance Win32_Service -Filter \"Name='Tailscale'\" -ErrorAction SilentlyContinue; if($s){[pscustomobject]@{Status=$s.State;StartType=$s.StartMode}|ConvertTo-Json -Compress}"], { allowFailure: true });
  let svc = null;
  try { svc = svcJson ? JSON.parse(svcJson) : null; } catch {}
  add('windows-tailscale-autostart', windowsTailscaleServiceReady(svc), `Tailscale service=${svcJson || 'missing'}`);

  add('firmware-ac-restore', false, 'BIOS/UEFI AC power restore cannot be safely verified generically; verify Restore on AC Power Loss / After Power Loss manually', false);
} else {
  add('platform-autostart', false, `Unsupported recovery host platform: ${os.platform()}`);
}

const verdict = recoveryVerdict(checks);
console.log(JSON.stringify({ platform: process.platform, ok: verdict.ok, failed: verdict.failed, checks }, null, 2));
process.exitCode = verdict.ok ? 0 : 2;
