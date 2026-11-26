import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('real registration adapter preserves native-copy evidence and rejects ambiguous metadata without plaintext egress', { timeout: 15000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'scripts/goriq-owner-probe/test-jarvis-registration-read.ps1'], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^JARVIS_REGISTRATION_READER_PASS=\d+\r?\n$/);
  assert.doesNotMatch(result.stdout, /PRIVATE|REFUSED|FIXTURE/);
});
