import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const shell = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const script = resolve('scripts/owner-code-windows.ps1');
test('loading the dialog functions does not consume protected configuration', () => {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', `. ${quote(script)}; if (-not (Get-Command Show-OwnerCodeDialog -ErrorAction SilentlyContinue) -or -not (Get-Command Set-OwnerLocalClipboard -ErrorAction SilentlyContinue)) { throw 'dialog unavailable' }; 'loaded'`], {encoding:'utf8', timeout:15000, env:{...process.env, JARVIS_PRODUCTION_CONFIG:resolve('deliberately-missing-public-fixture.dpapi')}});
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'loaded');
});
test('real Windows dialog masks then reveals, hides and copies from one click without output', {skip:process.platform !== 'win32'}, () => {
  const result = spawnSync(shell, ['-NoProfile', '-STA', '-File', resolve('tests/owner-code-dialog.fixture.ps1')], {encoding:'utf8', timeout:30000});
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {masked:true,revealed:true,hiddenAgain:true,copied:true,confirmed:true,localClipboardOnly:true,clearedOnClose:true});
  assert.equal((result.stdout+result.stderr).includes('PUBLIC-DUMMY-OWNER-CODE-1234567890'), false);
});
