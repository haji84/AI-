import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const installer = resolve('scripts/install-owner-code-windows.ps1');
const fixture = resolve('tests/install-owner-code-windows.fixture.ps1');
const shell = process.platform === 'win32'
  ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
const probe = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {encoding:'utf8', timeout:15000});
const unavailable = probe.error?.code === 'ENOENT';

function run(args) {
  assert.equal(existsSync(installer), true, 'The public-only Owner installer is required');
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', ...args], {encoding:'utf8', timeout:30000, windowsHide:true});
  assert.equal(result.error, undefined);
  return result;
}

test('Owner installer defaults to an inert plan without installation inputs', {skip:unavailable}, () => {
  const result = run([installer]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PLAN ONLY/);
  assert.equal(result.stderr, '');
});

for (const scenario of ['install', 'existing-package', 'existing-launcher', 'missing-reader', 'invalid-version', 'unsafe-paths', 'reparse-source', 'reparse-desktop', 'overlap']) {
  test(`public Owner package filesystem contract: ${scenario}`, {skip:unavailable}, () => {
    const result = run([fixture, '-InstallerPath', installer, '-Case', scenario]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    const value = JSON.parse(result.stdout.trim());
    assert.equal(value.case, scenario);
    assert.equal(value.passed, true);
    assert.equal(value.utilityExecuted, false);
    assert.equal(value.actualProductionUsed, false);
  });
}

test('production Apply rejects arbitrary destination and Desktop overrides', {skip:unavailable}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'owner-installer-cli-'));
  try {
    const result = run([installer, '-Apply', '-Version', 'a'.repeat(40), '-DestinationRoot', directory, '-DesktopPath', directory]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /parameter.*DestinationRoot|DestinationRoot.*parameter/i);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, {recursive:true, force:true}); }
});
