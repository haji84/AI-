import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('fixed Source metadata classifies Broker files while hiding unknown names and preserving source bytes', { timeout: 15000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'scripts/goriq-owner-probe/test-source-layout-observer.ps1'], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /SOURCE_LAYOUT_OBSERVER_PASS=\d+/);
  assert.doesNotMatch(result.stdout, /PRIVATE|abcdef|SOURCE_LAYOUT_REFUSED/);
});
