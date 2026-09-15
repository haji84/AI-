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

test('Windows recovery requires AtStartup task and automatic running Tailscale service', () => {
  assert.equal(windowsStartupTaskReady({ State: 'Ready', Trigger: 'MSFT_TaskBootTrigger' }), true);
  assert.equal(windowsStartupTaskReady({ State: 'Ready', Trigger: 'MSFT_TaskLogonTrigger' }), false);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Running', StartType: 'Automatic' }), true);
  assert.equal(windowsTailscaleServiceReady({ Status: 'Stopped', StartType: 'Automatic' }), false);
});

test('optional firmware checks do not fail software readiness verdict', () => {
  assert.deepEqual(recoveryVerdict({
    build: { ok: true },
    tailscale: { ok: true },
    firmware: { ok: false, required: false },
  }), { ok: true, failed: [] });
  assert.deepEqual(recoveryVerdict({ build: { ok: false }, tailscale: { ok: true } }), { ok: false, failed: ['build'] });
});
