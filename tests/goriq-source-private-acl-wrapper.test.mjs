import process from 'node:process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
test('approved Source repair wrapper refuses malformed or overstated native reports', { timeout: 15000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'scripts/goriq-owner-probe/test-source-private-acl-wrapper.ps1'], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /SOURCE_REPAIR_WRAPPER_PASS=45/);
});
