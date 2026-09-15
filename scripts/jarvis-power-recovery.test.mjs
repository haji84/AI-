import assert from 'node:assert/strict';
import test from 'node:test';
import {
  macAutoRestartEnabled,
  macSystemDaemonLoaded,
  recoveryVerdict,
  windowsStartupTaskReady,
  windowsStartupTaskReadiness,
  windowsTailscaleServiceReady,
} from './jarvis-power-recovery-lib.mjs';

test('macOS recovery requires autorestart and a system daemon', () => {
  assert.equal(macAutoRestartEnabled(' autorestart 1\n powernap 1'), true);
  assert.equal(macAutoRestartEnabled(' autorestart 0\n'), false);
  assert.equal(macSystemDaemonLoaded('system/ai.jarvis.remote-host = { state = running; }'), true);
  assert.equal(macSystemDaemonLoaded('Could not find service "ai.jarvis.remote-host" in domain for system'), false);
});

test('Windows recovery requires AtStartup task and automatic running Tailscale service', () => {
  assert.equal(windowsStartupTaskReady({ State: 'Ready', Trigger: 'MSFT_TaskBootTrigger' }), false);
  assert.equal(windowsStartupTaskReady({ State: 'Ready', Trigger: 'MSFT_TaskLogonTrigger' }), false);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Running', StartType: 'Automatic' }), true);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Stopped', StartType: 'Automatic' }), false);
});

const expected = { repoRoot: 'C:\\JARVIS Home', nodePath: 'C:\\Program Files\\nodejs\\node.exe' };
function readyTask() {
  return {
    State: 'Ready',
    Settings: { Enabled: true, DisallowStartIfOnBatteries: false, StopIfGoingOnBatteries: false, RunOnlyIfNetworkAvailable: false, StartWhenAvailable: true, RestartCount: 20, RestartInterval: 'PT1M', ExecutionTimeLimit: 'PT0S', MultipleInstances: 'IgnoreNew' },
    Principal: { IdentityPresent: true, MatchesCurrentIdentity: true, LogonType: 'Password', RunLevel: 'Limited' },
    Triggers: [{ Type: 'MSFT_TaskBootTrigger', Enabled: true }],
    Actions: [{ Execute: expected.nodePath, Arguments: '"C:\\JARVIS Home\\scripts\\jarvis-remote-host.mjs"', WorkingDirectory: expected.repoRoot }],
  };
}

test('complete unattended owner task configuration passes without claiming physical recovery', () => {
  const result = windowsStartupTaskReadiness(readyTask(), expected);
  assert.equal(result.ok, true);
  assert.equal(result.physicalRecoveryVerified, false);
  assert.equal(windowsStartupTaskReady(readyTask()), false);
});

test('interactive, S4U, unknown or elevated principals cannot pass unattended readiness', () => {
  for (const logon of ['Interactive', 'InteractiveOrPassword', 'S4U', 'ServiceAccount', '', undefined]) {
    const task = readyTask(); task.Principal.LogonType = logon;
    assert.equal(windowsStartupTaskReadiness(task, expected).checks['logon-type'].ok, false);
  }
  const task = readyTask(); task.Principal.RunLevel = 'Highest';
  assert.equal(windowsStartupTaskReady(task, expected), false);
  task.Principal.RunLevel = 'Limited'; task.Principal.MatchesCurrentIdentity = false;
  assert.equal(windowsStartupTaskReady(task, expected), false);
});

test('missing, disabled or shell-substituted task actions fail with safe diagnostics', () => {
  for (const mutate of [
    task => { task.Settings.Enabled = false; },
    task => { task.Triggers[0].Enabled = false; },
    task => { task.Triggers[0].Type = 'MSFT_TaskLogonTrigger'; },
    task => { task.Actions = []; },
    task => { task.Actions.push(task.Actions[0]); },
    task => { task.Actions[0].Execute = 'powershell.exe'; },
    task => { task.Actions[0].Arguments += ' --token=SECRET_SENTINEL'; },
    task => { task.Actions[0].WorkingDirectory = 'C:\\Other'; },
  ]) {
    const task = readyTask(); mutate(task);
    const result = windowsStartupTaskReadiness(task, expected);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('SECRET_SENTINEL'), false);
  }
  assert.equal(windowsStartupTaskReady(null, expected), false);
});

test('battery, network, retry and duplicate-instance restrictions cannot silently pass', () => {
  for (const [key, value] of [['StopIfGoingOnBatteries', true], ['DisallowStartIfOnBatteries', true], ['RunOnlyIfNetworkAvailable', true], ['RestartCount', 0], ['RestartCount', 21], ['RestartInterval', 'PT0S'], ['RestartInterval', 'PT1H'], ['StartWhenAvailable', false], ['ExecutionTimeLimit', 'PT72H'], ['MultipleInstances', 'Parallel']]) {
    const task = readyTask(); task.Settings[key] = value;
    assert.equal(windowsStartupTaskReady(task, expected), false, key);
  }
  const task = readyTask(); delete task.Settings.StopIfGoingOnBatteries;
  assert.equal(windowsStartupTaskReady(task, expected), false);
});

test('optional firmware checks do not fail software readiness verdict', () => {
  assert.deepEqual(recoveryVerdict({
    build: { ok: true },
    tailscale: { ok: true },
    firmware: { ok: false, required: false },
  }), { ok: true, failed: [] });
  assert.deepEqual(recoveryVerdict({ build: { ok: false }, tailscale: { ok: true } }), { ok: false, failed: ['build'] });
});
