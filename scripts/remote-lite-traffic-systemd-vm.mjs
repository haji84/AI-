// Isolated GitHub-hosted Linux acceptance only. Starts no portal, TURN, listener or public service.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || !process.env.RUNNER_TEMP) throw new Error('HOSTED_LINUX_FIXTURE_REQUIRED');
const repository = process.cwd();
const root = mkdtempSync(join(process.env.RUNNER_TEMP, 'remote-lite-traffic-'));
const guardScript = join(repository, 'scripts/remote-lite-traffic-guard.mjs');
const unitText = name => readFileSync(join(repository, 'deploy/remote-lite', `${name}.service.example`), 'utf8');
const guardTemplate = unitText('goriq-remote-lite-traffic');
const properties = ['Type=notify', 'NotifyAccess=all', 'WatchdogSec=15s', 'WatchdogSignal=SIGKILL', 'TimeoutStartSec=10s', 'TimeoutStopSec=5s', 'Restart=no'];
for (const property of properties) assert.ok(guardTemplate.split(/\r?\n/).includes(property), `Guard property missing: ${property}`);
for (const name of ['goriq-remote-lite', 'goriq-remote-lite-turn']) {
  const text = unitText(name);
  assert.match(text, /^BindsTo=goriq-remote-lite-traffic.service$/m);
  assert.match(text, /^After=.*\bgoriq-remote-lite-traffic.service$/m);
  assert.match(text, /^TimeoutStopSec=5s?$/m);
}
const ownedUnits = [];
const sudo = (file, args, timeout = 25000) => execFileSync('sudo', ['-n', file, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const state = name => sudo('/usr/bin/systemctl', ['show', name, '--property=ActiveState', '--value']);
const waitForStopped = async units => {
  const end = Date.now() + 35000;
  while (Date.now() < end) {
    if (units.every(unit => ['inactive', 'failed'].includes(state(unit)))) return;
    await delay(400);
  }
  throw new Error('BOUND_UNITS_DID_NOT_STOP');
};
try {
  for (const scenario of ['period-expiry', 'watchdog']) {
    const identity = `remote-lite-traffic-${randomUUID()}`;
    const guard = `${identity}.service`;
    const dependents = ['portal', 'turn'].map(role => `${identity}-${role}.service`);
    ownedUnits.push(guard, ...dependents);
    const directory = join(root, scenario);
    const configPath = join(root, `${scenario}.json`);
    const now = Date.now();
    const policy = { stateDirectory: directory, periodStart: new Date(now - 60000).toISOString(), periodEnd: new Date(now + (scenario === 'period-expiry' ? 20000 : 120000)).toISOString(), limitBytes: '8000000000000', openingBytes: '0' };
    // Zero is solely this isolated test's baseline; production requires operator evidence.
    writeFileSync(configPath, JSON.stringify(policy), { mode: 0o600 });
    execFileSync(process.execPath, [guardScript, configPath, '--initialize'], { timeout: 5000, stdio: 'pipe' });
    const props = [...properties, `User=${userInfo().username}`, 'UMask=0077'];
    sudo('/usr/bin/systemd-run', ['--quiet', `--unit=${guard}`, ...props.map(value => `--property=${value}`), process.execPath, guardScript, configPath]);
    assert.equal(state(guard), 'active');
    for (const unit of dependents) {
      sudo('/usr/bin/systemd-run', ['--quiet', `--unit=${unit}`, `--property=BindsTo=${guard}`, `--property=After=${guard}`, '--property=TimeoutStopSec=5s', '/usr/bin/sleep', 'infinity']);
      assert.equal(state(unit), 'active');
    }
    const recorded = JSON.parse(readFileSync(join(directory, 'traffic.json'), 'utf8'));
    assert.equal(recorded.status, 'monitoring');
    assert.ok(Object.keys(recorded.counters).length > 0);
    if (scenario === 'watchdog') sudo('/usr/bin/systemctl', ['kill', '--signal=SIGSTOP', '--kill-whom=main', guard]);
    await waitForStopped([guard, ...dependents]);
    assert.ok(existsSync(join(directory, 'traffic.lock')), 'failure must retain operator-inspection lock');
    const result = sudo('/usr/bin/systemctl', ['show', guard, '--property=Result', '--value']);
    assert.equal(result, scenario === 'watchdog' ? 'watchdog' : 'exit-code');
    if (scenario === 'period-expiry') {
      const log = sudo('/usr/bin/journalctl', ['--unit', guard, '--no-pager', '--output=cat']);
      assert.match(log, /TRAFFIC_PERIOD_ENDED/);
    }
    const restart = spawnSync('sudo', ['-n', '/usr/bin/systemctl', 'start', guard], { timeout: 15000, encoding: 'utf8' });
    assert.notEqual(restart.status, 0, 'stale lock must prevent automatic resumption');
    assert.ok(dependents.every(unit => ['inactive', 'failed'].includes(state(unit))));
    console.log(JSON.stringify({ scenario, result, persistentUsage: recorded.usedBytes, dependentsStopped: true, restartRejected: true }));
  }
} finally {
  for (const unit of ownedUnits.reverse()) {
    spawnSync('sudo', ['-n', '/usr/bin/systemctl', 'stop', unit], { timeout: 15000, stdio: 'ignore' });
    spawnSync('sudo', ['-n', '/usr/bin/systemctl', 'reset-failed', unit], { timeout: 5000, stdio: 'ignore' });
  }
  const destination = resolve(root);
  assert.ok(destination.startsWith(resolve(process.env.RUNNER_TEMP) + sep));
  rmSync(destination, { recursive: true, force: true });
}
