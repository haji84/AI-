import assert from 'node:assert/strict';
import test from 'node:test';
import {
  macAutoRestartEnabled,
  macSystemDaemonLoaded,
  recoveryVerdict,
  windowsStartupTaskReady,
  windowsTailscaleServiceReady,
} from './jarvis-power-recovery-lib.mjs';

test('macOS recovery requires autorestart and a system daemon', () => {
  assert.equal(macAutoRestartEnabled(' autorestart 1\n powernap 1'), true);
  assert.equal(macAutoRestartEnabled(' autorestart 0\n'), false);
  assert.equal(macSystemDaemonLoaded('system/ai.jarvis.remote-host = { state = running; }'), true);
  assert.equal(macSystemDaemonLoaded('Could not find service "ai.jarvis.remote-host" in domain for system'), false);
});

test('Windows recovery requires unattended AtStartup task with laptop-safe battery settings', () => {
  const ready = {
    State: 'Ready',
    Trigger: 'MSFT_TaskBootTrigger',
    UserId: 'SYSTEM',
    LogonType: 'ServiceAccount',
    StartWhenAvailable: true,
    DisallowStartIfOnBatteries: false,
    StopIfGoingOnBatteries: false,
  };
  assert.equal(windowsStartupTaskReady(ready), true);
  assert.equal(windowsStartupTaskReady({ ...ready, Trigger: 'MSFT_TaskLogonTrigger' }), false);
  assert.equal(windowsStartupTaskReady({ ...ready, LogonType: 'InteractiveToken' }), false);
  assert.equal(windowsStartupTaskReady({ ...ready, UserId: '' }), false);
  assert.equal(windowsStartupTaskReady({ ...ready, StartWhenAvailable: false }), false);
  assert.equal(windowsStartupTaskReady({ ...ready, DisallowStartIfOnBatteries: true }), false);
  assert.equal(windowsStartupTaskReady({ ...ready, StopIfGoingOnBatteries: true }), false);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Running', StartType: 'Automatic' }), true);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Stopped', StartType: 'Automatic' }), false);
});

test('Windows unattended readiness accepts explicit S4U/password principals', () => {
  const base = {
    State: 'Running',
    Trigger: 'MSFT_TaskBootTrigger',
    UserId: 'DESKTOP\\haji',
    StartWhenAvailable: true,
    DisallowStartIfOnBatteries: false,
    StopIfGoingOnBatteries: false,
  };
  assert.equal(windowsStartupTaskReady({ ...base, LogonType: 'S4U' }), true);
  assert.equal(windowsStartupTaskReady({ ...base, LogonType: 'Password' }), true);
});

test('optional firmware checks do not fail software readiness verdict', () => {
  assert.deepEqual(recoveryVerdict({
    build: { ok: true },
    tailscale: { ok: true },
    firmware: { ok: false, required: false },
  }), { ok: true, failed: [] });
  assert.deepEqual(recoveryVerdict({ build: { ok: false }, tailscale: { ok: true } }), { ok: false, failed: ['build'] });
});
