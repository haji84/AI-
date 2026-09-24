import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const utilityPath = path.resolve('scripts/owner-code-windows.ps1');
const source = readFileSync(utilityPath, 'utf8');

test('owner-code utility is masked by default and gates reveal and clipboard copy', () => {
  assert.match(source, /\[switch\]\$Reveal/);
  assert.match(source, /\[switch\]\$Copy/);
  assert.match(source, /if \(\$Reveal\)/);
  assert.match(source, /\[string\]::new\(\[char\]0x2022/);
  assert.match(source, /MessageBoxButtons\]::YesNo/);
  assert.match(source, /MessageBoxDefaultButton\]::Button2/);
  assert.match(source, /if \(\$choice -eq \[System\.Windows\.Forms\.DialogResult\]::Yes\)/);
  assert.match(source, /\[System\.Windows\.Forms\.Clipboard\]::SetText\(\$ownerCode\)/);
});

test('owner-code utility reuses the production reader and selects only the owner login code', () => {
  assert.match(source, /read-jarvis-production-config\.ps1/);
  assert.match(source, /JARVIS_PRODUCTION_CONFIG/);
  assert.match(source, /JARVIS\\production\\config\.dpapi/);
  assert.match(source, /configuration\.environment\.JARVIS_OWNER_SECRET/);
  assert.doesNotMatch(source, /configuration\.environment\.JARVIS_OWNER_TOKEN/);
  assert.doesNotMatch(source, /configuration\.environment\.JARVIS_REMOTE_GATEWAY_TOKEN/);
  assert.doesNotMatch(source, /Write-(?:Output|Host).*ownerCode/i);
});

test('DPAPI-incompatible identity fails closed without disclosing plaintext', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jarvis-owner-code-'));
  const fixturePath = path.join(directory, 'wrong-identity.dpapi');
  const plaintext = 'must-not-appear-in-output-or-artifacts';
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    const create = spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-Command',
      `$key=New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($key); ` +
      `${JSON.stringify(plaintext)} | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString -Key $key`,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(create.status, 0, create.stderr);
    writeFileSync(fixturePath, create.stdout.trim() + '\r\n');

    const result = spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', utilityPath,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, JARVIS_PRODUCTION_CONFIG: fixturePath },
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /Owner login code unavailable for this Windows identity\./);
    assert.equal(output.includes(plaintext), false);
    assert.deepEqual(readFileSync(fixturePath, 'utf8').includes(plaintext), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
