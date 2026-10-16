import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectNativeInventory, summarizeStatus } from '../scripts/goriq-pc-native-inventory.mjs';

test('health summaries retain only typed status, time and PID facts', () => {
  const value = summarizeStatus({ status: 'idle', pid: 42, updatedAt: '2026-10-12T10:00:00Z',
    token: 'SECRET', error: 'SECRET', command: 'SECRET' }, Date.parse('2026-10-12T10:00:30Z'));
  assert.equal(value.status, 'idle');
  assert.equal(value.fresh, true);
  assert.equal(value.pid, 42);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|token|error|command/);
  assert.equal(summarizeStatus({ status: 'SECRET', pid: '42', updatedAt: 'SECRET' }, 0).status, 'unknown');
  assert.equal(summarizeStatus({ status: 'idle', pid: 1, updatedAt: '2099-01-01T00:00:00Z' }, 0).fresh, false);
});

test('Mac inventory queries fixed launchd services without changing them or exposing output', async () => {
  const calls = [];
  const result = await collectNativeInventory({ platform: 'darwin', home: '/fixture', uid: 123,
    now: Date.parse('2026-10-12T10:00:30Z'),
    read: async path => path.endsWith('.json') ? '{"status":"idle","pid":42,"updatedAt":"2026-10-12T10:00:00Z","token":"SECRET"}'
      : '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>SECRET',
    metadata: async () => ({ present: true, sizeBytes: 100, updatedAt: '2026-10-12T10:00:00.000Z' }),
    run: async (command, args) => { calls.push([command, args]); return { ok: true, stdout: 'state = running\npid = 42\ntoken = SECRET' }; },
  });
  assert.equal(result.bridge.status, 'idle');
  assert.equal(result.startup.bridge.registered, true);
  assert.equal(result.startup.bridge.pid, 42);
  assert.equal(result.startup.bridge.runAtLoad, true);
  assert.equal(result.bridgeMatchesLaunchdPid, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([command, args]) => command === 'launchctl' && args[0] === 'print'));
  assert.doesNotMatch(JSON.stringify(result), /SECRET|fixture|token/);
});

test('Windows inventory sanitizes scheduled-task and malformed status output', async () => {
  let commandText;
  const result = await collectNativeInventory({ platform: 'win32', home: 'C:/fixture', localAppData: 'C:/fixture/local',
    read: async () => '{broken SECRET', metadata: async () => ({ present: false }),
    run: async (command, args) => { commandText = args.join(' '); return { ok: true,
      stdout: JSON.stringify([{ name: 'GAI-ZBook-Watchdog', querySucceeded: true, state: 'Ready', actionCount: 1, secret: 'SECRET' },
        { name: 'SECRET', state: 'Ready' }]) }; },
  });
  assert.equal(result.bridge.readable, false);
  assert.equal(result.startup.tasks[1].state, 'Ready');
  assert.equal(result.startup.tasks[0].available, null);
  assert.match(commandText, /Get-ScheduledTask/);
  assert.doesNotMatch(commandText, /Start-ScheduledTask|Stop-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|fixture/);
});

test('partial Windows query success preserves failed task lookup as unknown', async () => {
  const result = await collectNativeInventory({ platform: 'win32', home: 'C:/fixture', localAppData: 'C:/fixture/local',
    read: async () => { throw new Error('SECRET'); }, metadata: async () => ({ present: false }),
    run: async () => ({ ok: true, stdout: JSON.stringify([
      { name: 'GAI-ZBook-Watchdog', querySucceeded: true, state: 'Ready', actionCount: 1 },
      { name: 'JARVIS Remote Host', querySucceeded: false },
    ]) }) });
  assert.equal(result.startup.tasks[1].available, true);
  assert.equal(result.startup.tasks[3].available, null);
  assert.equal(result.startup.tasks[3].state, 'Unknown');
});

test('unsupported OS and missing Windows state root fail closed', async () => {
  await assert.rejects(collectNativeInventory({ platform: 'linux' }), /NATIVE_PC_REQUIRED/);
  await assert.rejects(collectNativeInventory({ platform: 'win32', localAppData: '' }), /LOCAL_STATE_ROOT_REQUIRED/);
});

test('failed task queries remain unknown rather than claiming tasks are absent', async () => {
  for (const response of [{ ok: false }, { ok: true, stdout: 'broken SECRET' }]) {
    const result = await collectNativeInventory({ platform: 'win32', home: 'C:/fixture', localAppData: 'C:/fixture/local',
      read: async () => { throw new Error('SECRET'); }, metadata: async () => ({ present: null }),
      run: async () => response });
    assert.ok(result.startup.tasks.every(task => task.available === null));
    assert.equal(result.logs.watchdog.present, null);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test('native reads reject symlinks and oversized status and inspect only the bounded log tail', async () => {
  const home = await mkdtemp(join(tmpdir(), 'goriq-readonly-test-'));
  try {
    const bridgeRoot = join(home, '.ai-company');
    const stateRoot = join(home, 'Library', 'Application Support', 'GAIWorker');
    await mkdir(bridgeRoot, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    const bridgePath = join(bridgeRoot, 'chatgpt-bridge-health.json');
    await writeFile(bridgePath, JSON.stringify({ status: 'idle', pid: 42, padding: 'x'.repeat(70000) }));
    const logPath = join(stateRoot, 'macbook-watchdog.log');
    await writeFile(logPath, 'EACCES\n' + 'x'.repeat(70000) + '\nECONNREFUSED\n');
    const result = await collectNativeInventory({ platform: 'darwin', home, run: async () => ({ ok: false }) });
    assert.equal(result.bridge.readable, false);
    assert.equal(result.logs.watchdog.readable, true);
    assert.deepEqual(result.logs.watchdog.errorCodes, ['ECONNREFUSED']);
    await rm(bridgePath);
    await symlink(logPath, bridgePath);
    const linked = await collectNativeInventory({ platform: 'darwin', home, run: async () => ({ ok: false }) });
    assert.equal(linked.bridge.readable, false);
    assert.doesNotMatch(JSON.stringify(linked), /goriq-readonly-test-/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
