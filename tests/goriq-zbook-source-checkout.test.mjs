import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('every ZBook diagnosis isolates checkout and refuses to erase existing source or original state', () => {
  const workflow = readFileSync('.github/workflows/goriq-zbook-fleet-liveness.yml', 'utf8');
  const precheck = workflow.match(/      - name: Require unused per-run source directory\n([\s\S]*?)(?=      - uses: actions\/checkout@v5)/)?.[1];
  assert.ok(precheck, 'all modes must preserve the original workspace before checkout');
  assert.doesNotMatch(precheck, /\n {8}if:|Remove-Item|Test-Path|\.Exists\(/);
  assert.match(precheck, /id: source_precheck/);
  const source = precheck.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1].split('\n').map(line => line.slice(10)).join('\n');
  assert.ok(source);
  const fresh = 'goriq-zbook-source-${{ github.run_id }}-${{ github.run_attempt }}';
  const checkout = workflow.split('      - uses: actions/checkout@v5')[1].split('      - name:')[0];
  assert.ok(checkout.includes('path: ' + fresh));
  assert.match(checkout, /id: source_checkout/);
  assert.ok(workflow.includes('path: ' + fresh + '/.gai-results/zbook-fleet-liveness.json'));
  assert.ok(workflow.includes('path: ' + fresh + '/.gai-results/zbook-original-location-'));
  const oldUpload = workflow.split('- name: Upload sanitized diagnosis')[1].split('- name:')[0];
  for (const step of ['source_precheck', 'source_checkout', 'fleet']) assert.ok(oldUpload.includes('steps.' + step + '.outcome'));
  const uploadCondition = oldUpload.match(/if: \$\{\{ (.*) \}\}/)?.[1];
  assert.ok(uploadCondition);
  for (const precheck of ['success', 'failure', 'skipped']) for (const checkout of ['success', 'failure', 'skipped']) for (const fleet of ['success', 'failure', 'cancelled', 'skipped']) for (const original of [true, false]) {
    const actual = runInNewContext(uploadCondition, { always: () => true, inputs: { original_state_only: original }, steps: { source_precheck: { outcome: precheck }, source_checkout: { outcome: checkout }, fleet: { outcome: fleet } } }, { timeout: 100 });
    assert.equal(actual, !original && precheck === 'success' && checkout === 'success' && fleet !== 'skipped');
  }
  const locator = readFileSync('scripts/goriq-zbook-original-state-locator.ps1', 'utf8');
  assert.match(locator, /-CheckoutPath \$env:GITHUB_WORKSPACE/);
  assert.doesNotMatch(locator, /-CheckoutPath \(Get-Location\)/);
  const root = mkdtempSync(join(tmpdir(), 'goriq-workspace-preserve-'));
  try {
    mkdirSync(join(root, '.jarvis'));
    const original = join(root, '.jarvis', 'compass.db');
    writeFileSync(original, 'PRIVATE_ORIGINAL_CANARY');
    mkdirSync(join(root, 'goriq-zbook-source-42-2'));
    const oldSource = join(root, 'goriq-zbook-source-42-2', 'retained.txt');
    writeFileSync(oldSource, 'PRIVATE_EXISTING_SOURCE');
    writeFileSync(join(root, 'goriq-zbook-source-42-3'), 'PRIVATE_EXISTING_FILE');
    const cases = ['1', '2', '3'];
    if (process.platform !== 'win32') {
      symlinkSync(join(root, 'missing-target'), join(root, 'goriq-zbook-source-42-4'));
      cases.push('4');
    }
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const command = `
      $ErrorActionPreference='Stop';$env:GITHUB_WORKSPACE=${quote(root)};$env:GITHUB_RUN_ID='42'
      $guard=[ScriptBlock]::Create(${quote(source)})
      $outcomes=@()
      foreach($attempt in @(${cases.map(quote).join(',')})) {
        $env:GITHUB_RUN_ATTEMPT=$attempt
        try { & $guard; $outcomes+=@{attempt=$attempt;status='FRESH'} }
        catch { if($_.Exception.Message -ne 'ZBOOK_SOURCE_DIRECTORY_NOT_FRESH'){throw};$outcomes+=@{attempt=$attempt;status='REFUSED'} }
      }
      foreach($field in @('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKSPACE')) {
        $before=[Environment]::GetEnvironmentVariable($field);[Environment]::SetEnvironmentVariable($field,'../../unsafe')
        try { & $guard;throw 'TEST_INVALID_CONTEXT_ACCEPTED' } catch { if($_.Exception.Message -ne 'ZBOOK_SOURCE_CONTEXT_INVALID'){throw} }
        finally { [Environment]::SetEnvironmentVariable($field,$before) }
      }
      @{outcomes=$outcomes;invalidContextRefused=$true}|ConvertTo-Json -Depth 5 -Compress
    `;
    const shell = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';
    const run = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.replace(/^\uFEFF/, ''));
    assert.deepEqual(out.outcomes, cases.map(attempt => ({ attempt, status: attempt === '1' ? 'FRESH' : 'REFUSED' })));
    assert.equal(out.invalidContextRefused, true);
    assert.equal(readFileSync(original, 'utf8'), 'PRIVATE_ORIGINAL_CANARY');
    assert.equal(readFileSync(oldSource, 'utf8'), 'PRIVATE_EXISTING_SOURCE');
    assert.equal(readFileSync(join(root, 'goriq-zbook-source-42-3'), 'utf8'), 'PRIVATE_EXISTING_FILE');
    assert.doesNotMatch(run.stdout, /PRIVATE_|goriq-workspace-preserve/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
