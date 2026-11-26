import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { createPowerShellFixtureBatch, parsePowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';

const shell = process.platform === 'win32'
  ? join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'pwsh';

test('PowerShell fixture batches retain exit codes and every error/output stream in fresh case scopes', () => {
  const root = mkdtempSync(join(tmpdir(), 'powershell-batch-contract-'));
  try {
    const fixture = join(root, 'fixture.ps1');
    writeFileSync(fixture, `param([string]$Scenario)
switch ($Scenario) {
 'first' { $global:PreviousCase='must-not-leak'; function global:PreviousFunction {} ; '{"value":1}'; exit 0 }
 'second' { if (Get-Variable PreviousCase -ErrorAction SilentlyContinue) {throw 'CASE_VARIABLE_LEAK'}; if (Get-Command PreviousFunction -ErrorAction SilentlyContinue) {throw 'CASE_FUNCTION_LEAK'}; '{"value":2}' }
 'exit' { '{"value":3}'; exit 7 }
 'throw' { throw 'FIXTURE_THROW' }
 'error' { Write-Error 'FIXTURE_ERROR'; '{"value":4}' }
 'warning' { Write-Warning 'FIXTURE_WARNING'; '{"value":5}' }
 'host' { Write-Host 'FIXTURE_HOST'; '{"value":6}' }
 'multiple' { 'first-line'; 'second-line' }
 'closure' { $script:called=0; function Invoke-FixtureCallback {$script:called++}; $callback={Invoke-FixtureCallback}.GetNewClosure(); & $callback; @{value=$script:called}|ConvertTo-Json -Compress }
 'environment' { $env:GORIQ_FIXTURE_BATCH_LEAK='must-not-leak'; '{}' }
 'after' { if([Environment]::GetEnvironmentVariables().Contains('GORIQ_FIXTURE_BATCH_LEAK')){throw 'CASE_ENVIRONMENT_LEAK'}; '{"value":8}' }
}
`);
    const scenarios = ['first', 'second', 'exit', 'throw', 'error', 'warning', 'host', 'multiple', 'closure', 'environment', 'after'];
    const run = createPowerShellFixtureBatch({ shell, fixture, scenarios });
    assert.deepEqual(JSON.parse(run('first').stdout), { value: 1 });
    assert.equal(run('first').status, 0);
    assert.deepEqual(JSON.parse(run('second').stdout), { value: 2 });
    assert.equal(run('second').status, 0);
    assert.equal(run('exit').status, 7);
    assert.match(run('throw').stderr, /FIXTURE_THROW/);
    assert.notEqual(run('throw').status, 0);
    assert.match(run('error').stderr, /FIXTURE_ERROR/);
    assert.notEqual(run('error').status, 0);
    assert.match(run('warning').stderr, /FIXTURE_WARNING/);
    assert.match(run('host').stderr, /FIXTURE_HOST/);
    assert.equal(run('multiple').stdout.trim(), 'first-line\nsecond-line');
    assert.equal(run('closure').status, 0);
    assert.deepEqual(JSON.parse(run('closure').stdout), { value: 1 });
    assert.notEqual(run('environment').status, 0);
    assert.match(run('environment').stderr, /PS_FIXTURE_PROCESS_STATE_CHANGED/);
    assert.equal(run('after').status, 0, run('after').stderr);
    assert.equal(run('after').stderr, '');
    assert.deepEqual(JSON.parse(run('after').stdout), { value: 8 });
    assert.throws(() => run('unregistered'), /PS_FIXTURE_CASE_UNKNOWN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('PowerShell fixture batch refuses incomplete, duplicate, foreign and malformed case records', () => {
  const valid = { version: 1, cases: [
    { scenario: 'a', status: 0, stdout: '{}\n', stderr: '' },
    { scenario: 'b', status: 3, stdout: '', stderr: 'failure' },
  ] };
  assert.equal(parsePowerShellFixtureBatch(JSON.stringify(valid), ['a', 'b']).get('b').status, 3);
  for (const wire of [
    '', '{}', 'not-json', JSON.stringify({ ...valid, cases: valid.cases.slice(0, 1) }),
    JSON.stringify({ ...valid, cases: [valid.cases[0], valid.cases[0]] }),
    JSON.stringify({ ...valid, cases: [valid.cases[0], { ...valid.cases[1], scenario: 'c' }] }),
    JSON.stringify({ ...valid, cases: [valid.cases[0], { ...valid.cases[1], status: '0' }] }),
    JSON.stringify({ ...valid, cases: [valid.cases[0], { ...valid.cases[1], stdout: {} }] }),
    JSON.stringify({ ...valid, extra: true }),
  ]) assert.throws(() => parsePowerShellFixtureBatch(wire, ['a', 'b']), /PS_FIXTURE_BATCH_INVALID/);
});

test('PowerShell fixture batch stops a hung case within the existing process bound', () => {
  const root = mkdtempSync(join(tmpdir(), 'powershell-batch-timeout-'));
  try {
    const fixture = join(root, 'hang.ps1'), marker = join(root, 'started.txt');
    writeFileSync(fixture, `param([string]$Scenario,[string]$Marker)\n[IO.File]::WriteAllText($Marker,[string]$PID)\nwhile($true){Start-Sleep -Milliseconds 50}\n`);
    const run = createPowerShellFixtureBatch({ shell, fixture, scenarios: ['hang'], parameters: { Marker: marker }, timeoutMs: 2500 });
    const started = performance.now();
    assert.throws(() => run('hang'), /PS_FIXTURE_BATCH_TIMEOUT/);
    assert.ok(performance.now() - started < 10000, 'bounded worker termination');
    const pid = Number(readFileSync(marker, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
