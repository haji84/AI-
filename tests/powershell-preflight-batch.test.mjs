import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { runPreflightPowerShellBatch } from './helpers/powershell-preflight-batch.mjs';

const shell = process.platform === 'win32'
  ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';

test('preflight batching preserves exact script bytes and isolates variables, closures and type data', () => {
  const sources = [
    '\ufeff' + `$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$global:FixturePreflightValue='must-not-leak'
$script:called=0;function Invoke-FixturePreflightCallback {$script:called++}
$callback={Invoke-FixturePreflightCallback}.GetNewClosure();& $callback
Update-TypeData -TypeName System.String -MemberType ScriptProperty -MemberName FixturePreflightProperty -Value {'must-not-leak'} -Force
$hash=[Security.Cryptography.SHA256]::Create()
try {$digest=([BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($PSCommandPath)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
@{digest=$digest;value='日本語';called=$script:called}|ConvertTo-Json -Compress
`,
    `$ErrorActionPreference='Stop'
@{variable=(Test-Path Variable:FixturePreflightValue);function=(Test-Path Function:Invoke-FixturePreflightCallback);typeMember=([bool]('value'.PSObject.Properties['FixturePreflightProperty']))}|ConvertTo-Json -Compress
`,
  ];
  const results = runPreflightPowerShellBatch({ shell, sources });
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(JSON.parse(results[0].stdout), {
    digest: createHash('sha256').update(sources[0]).digest('hex'), value: '日本語', called: 1,
  });
  assert.deepEqual(JSON.parse(results[1].stdout), { variable: false, function: false, typeMember: false });
});

test('preflight batching preserves exit and error records and refuses unexpected environment mutation', () => {
  const results = runPreflightPowerShellBatch({ shell, sources: [
    "$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');'before-exit';exit 7",
    "$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');throw 'PUBLIC_TERMINATING_ERROR'",
    "$ErrorActionPreference='Continue';Write-Output 'first';Write-Error 'PUBLIC_ERROR_ONE';Write-Error 'PUBLIC_ERROR_TWO';Write-Output 'last'",
    "$env:PSModulePath='PUBLIC_UNEXPECTED_MODULE_PATH';'{}';throw 'PUBLIC_ORIGINAL_FAILURE'",
    "$env:GORIQ_PREFLIGHT_BATCH_LEAK='PUBLIC_LEAK';'{}'",
    "@{environmentClean=([Environment]::GetEnvironmentVariable('GORIQ_PREFLIGHT_BATCH_LEAK') -eq $null);modulePathClean=($env:PSModulePath -cne 'PUBLIC_UNEXPECTED_MODULE_PATH')}|ConvertTo-Json -Compress",
  ] });
  assert.equal(results[0].status, 7);
  assert.match(results[0].stdout, /before-exit/);
  assert.equal(results[1].status, 1);
  assert.match(results[1].stderr, /PUBLIC_TERMINATING_ERROR/);
  assert.equal(results[2].status, 1);
  assert.equal(results[2].stdout, 'first\nlast\n');
  assert.match(results[2].stderr, /PUBLIC_ERROR_ONE/);
  assert.match(results[2].stderr, /PUBLIC_ERROR_TWO/);
  assert.equal(results[3].status, 1);
  assert.match(results[3].stderr, /PS_PREFLIGHT_MODULE_PATH_CHANGED/);
  assert.match(results[3].stderr, /PUBLIC_ORIGINAL_FAILURE/);
  assert.equal(results[4].status, 1);
  assert.match(results[4].stderr, /PS_FIXTURE_PROCESS_STATE_CHANGED/);
  assert.equal(results[5].status, 0, results[5].stderr);
  assert.equal(results[5].stderr, '');
  assert.deepEqual(JSON.parse(results[5].stdout), { environmentClean: true, modulePathClean: true });
});

test('preflight source batches reject unbounded inputs before launching PowerShell', () => {
  for (const change of [
    { sources: [] }, { sources: Array(9).fill("'{}'") },
    { sources: ['x'.repeat(131073)] }, { sources: [42] },
    { timeoutMs: 25001 }, { timeoutMs: 0 },
  ]) assert.throws(() => runPreflightPowerShellBatch({ shell: 'must-not-launch', sources: ["'{}'"], ...change }), /PS_PREFLIGHT_BATCH_ARGUMENTS/);
});
