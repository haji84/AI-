import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const utilityPath = path.resolve('scripts/owner-code-windows.ps1');
const source = readFileSync(utilityPath, 'utf8');
const readerSource = readFileSync(path.resolve('scripts/read-jarvis-production-config.ps1'), 'utf8');
const ownerLoginSource = readFileSync(path.resolve('src/app/jarvis/OwnerLogin.tsx'), 'utf8');

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
  assert.doesNotMatch(source, /ConvertFrom-Json|JARVIS_OWNER_TOKEN|JARVIS_REMOTE_GATEWAY_TOKEN/);
  assert.doesNotMatch(source, /Write-(?:Output|Host).*ownerCode/i);
  assert.match(source, /\$consumeOwnerCode = \{/);
  assert.match(source, /\}\.GetNewClosure\(\)/);
  assert.match(source, /& \$reader -Path \$configPath -OwnerLoginCode -OwnerLoginCodeConsumer \$consumeOwnerCode/);
  assert.match(readerSource, /\[switch\]\$OwnerLoginCode/);
  assert.match(readerSource, /\[scriptblock\]\$OwnerLoginCodeConsumer/);
  assert.match(readerSource, /configuration\.environment\.JARVIS_OWNER_SECRET/);
  assert.doesNotMatch(readerSource, /configuration\.environment\.JARVIS_OWNER_TOKEN/);
  assert.doesNotMatch(readerSource, /configuration\.environment\.JARVIS_REMOTE_GATEWAY_TOKEN/);
  assert.match(readerSource, /if \(\$OwnerLoginCode\) \{ throw 'Protected configuration unavailable/);
  assert.doesNotMatch(readerSource, /Write-Output[^\r\n]*\$ownerCode/i);
  assert.match(readerSource, /& \$OwnerLoginCodeConsumer \$ownerCode \| Out-Null/);
  assert.doesNotMatch(source, /ProcessStartInfo|EncodedCommand|Start-Process/);
});

test('malformed configuration fails closed before reveal or clipboard access', () => {
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(readerSource, /\$configuration -isnot \[pscustomobject\]/);
  assert.match(readerSource, /\$configuration\.environment -isnot \[pscustomobject\]/);
  assert.match(readerSource, /JARVIS_OWNER_SECRET -isnot \[string\]/);
  assert.match(source, /throw 'unavailable'/);
  assert.ok(readerSource.indexOf('$ownerCode = $configuration.environment.JARVIS_OWNER_SECRET') <
    readerSource.indexOf('& $OwnerLoginCodeConsumer $ownerCode'));
});

test('wrong-identity errors fail closed without secret output or artifacts', () => {
  assert.match(readerSource, /Protected configuration unavailable for this Windows identity\./);
  assert.match(source, /Owner login code unavailable for this Windows identity\./);
  assert.doesNotMatch(source, /\$_(?:\.|\s|\))/);
  assert.doesNotMatch(source, /Write-(?:Output|Host)|Out-File|Set-Content|Add-Content|Export-/i);
  assert.doesNotMatch(source, /Console\]::(?:Write|WriteLine)\([^)]*\$ownerCode/i);
  assert.doesNotMatch(source, /Console\]::Error\.WriteLine\([^)]*\$_/i);
  assert.doesNotMatch(source, /Start-Transcript|Tee-Object/i);
  assert.doesNotMatch(source, /New-Item|Copy-Item|Move-Item/i);
});

test('owner login explains same-owner local recovery without rotation or re-enrollment', () => {
  assert.match(ownerLoginSource, /Production PCで同じWindowsオーナーとして/);
  assert.match(ownerLoginSource, /scripts\/owner-code-windows\.ps1/);
  assert.match(ownerLoginSource, /-Reveal/);
  assert.match(ownerLoginSource, /-Copy/);
  assert.match(ownerLoginSource, /コードの再発行やWorkerの再登録は不要です/);
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
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(create.error, undefined);
    assert.equal(create.status, 0, create.stderr);
    writeFileSync(fixturePath, create.stdout.trim() + '\r\n');
    const filesBefore = readdirSync(directory);

    const result = spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', utilityPath,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, JARVIS_PRODUCTION_CONFIG: fixturePath },
      timeout: 45000,
    });
    assert.equal(result.error, undefined);
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /Owner login code unavailable for this Windows identity\./);
    assert.equal(output.includes(plaintext), false);
    assert.deepEqual(readFileSync(fixturePath, 'utf8').includes(plaintext), false);
    assert.deepEqual(readdirSync(directory), filesBefore);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
