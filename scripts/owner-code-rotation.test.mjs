import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(new URL('./rotate-jarvis-owner-code-windows.ps1', import.meta.url), 'utf8');

test('rotation requires a separate exact owner receipt and keeps dry run inert', () => {
  assert.match(source, /if \(-not \$Apply\) \{/);
  assert.match(source, /scopeId -ne 'issue:1218'/);
  assert.match(source, /ownerSid -ne \$identity\.User\.Value/);
  assert.match(source, /credentialRotationApproval -ne \$true/);
  assert.match(source, /configSha256/);
  assert.match(source, /configuration changed since approval/);
  assert.match(source, /\[IO\.File\]::Replace\(\$candidatePath, \$configPath, \$backupPath/);
  assert.match(source, /\[IO\.File\]::Replace\(\$backupPath, \$configPath, \$failedPath/);
  assert.match(source, /Test-LocalOwnerLogin \$newCode/);
  assert.match(source, /Test-LocalOwnerLogin \$originalCode/);
  assert.doesNotMatch(source, /Write-(Output|Host)\s+\$newCode/);
});

test('Windows rotation defaults to plan only without reading Production configuration', { skip: process.platform !== 'win32' }, () => {
  const powershell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', fileURLToPath(new URL('./rotate-jarvis-owner-code-windows.ps1', import.meta.url))], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PLAN ONLY/);
});

test('Windows DPAPI configuration consumer handles a fixture without stdout disclosure', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'owner-rotation-fixture-'));
  const plaintext = join(directory, 'fixture.json');
  const encrypted = join(directory, 'fixture.dpapi');
  const marker = join(directory, 'consumed');
  const powershell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const reader = fileURLToPath(new URL('./read-jarvis-production-config.ps1', import.meta.url));
  try {
    writeFileSync(plaintext, JSON.stringify({ environment: { JARVIS_OWNER_SECRET: 'fixture-owner-code-with-32-bytes-123', JARVIS_OWNER_TOKEN: 'other-private-fixture' } }));
    const create = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      `$env:PSModulePath=Join-Path $PSHOME 'Modules'; (Get-Content -LiteralPath ${quote(plaintext)} -Raw) | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath ${quote(encrypted)}`], { encoding: 'utf8', windowsHide: true });
    assert.equal(create.status, 0, create.stderr);
    const consume = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command',
      `$env:PSModulePath=Join-Path $PSHOME 'Modules'; & ${quote(reader)} -Path ${quote(encrypted)} -ConfigurationConsumer { param($config) if ($config.environment.JARVIS_OWNER_SECRET -ne 'fixture-owner-code-with-32-bytes-123') { throw 'invalid' }; Set-Content -LiteralPath ${quote(marker)} -Value 'ok' }`], { encoding: 'utf8', windowsHide: true });
    assert.equal(consume.status, 0, consume.stderr);
    assert.equal(consume.stdout, '');
    assert.equal(existsSync(marker), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Windows atomic replacement preserves and restores an encrypted fixture backup', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'owner-rotation-rollback-'));
  const config = join(directory, 'config.dpapi');
  const candidate = join(directory, 'candidate.dpapi');
  const backup = join(directory, 'backup.dpapi');
  const failed = join(directory, 'failed.dpapi');
  const powershell = `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  try {
    writeFileSync(config, 'encrypted-old-fixture');
    writeFileSync(candidate, 'encrypted-new-fixture');
    const command = `[IO.File]::Replace(${quote(candidate)},${quote(config)},${quote(backup)},$true); [IO.File]::Replace(${quote(backup)},${quote(config)},${quote(failed)},$true)`;
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(config, 'utf8'), 'encrypted-old-fixture');
    assert.equal(readFileSync(failed, 'utf8'), 'encrypted-new-fixture');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
