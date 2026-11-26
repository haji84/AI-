import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

const script = resolve('scripts/goriq-zbook-original-state-locator.ps1');
const quote = value => "'" + value.replaceAll("'", "''") + "'";

test('original locator executes metadata fixtures without reading or exposing original contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'goriq-locate-'));
  try {
    mkdirSync(join(root, '.jarvis'));
    writeFileSync(join(root, '.jarvis', 'compass.db'), 'PRIVATE_GOAL_BYTES');
    writeFileSync(join(root, 'not-directory'), 'private');
    if (process.platform !== 'win32') symlinkSync(join(root, '.jarvis'), join(root, 'junction'));
    const command = `
      $ErrorActionPreference='Stop'
      . ${quote(script)}
      $root=${quote(root)}
      $plan=@(New-GoriqOriginalLocationCandidates -ProfilePath $root -CheckoutPath $root -TaskWorkingDirectory '' -LocalAppData '' -DriveRoots @())
      $volumePlan=@(New-GoriqOriginalLocationCandidates -ProfilePath '' -CheckoutPath '' -TaskWorkingDirectory '' -LocalAppData '' -DriveRoots @('',$root))
      $boundedPlan=@(New-GoriqOriginalLocationCandidates -ProfilePath '' -CheckoutPath '' -TaskWorkingDirectory '' -LocalAppData '' -DriveRoots @((1..40|ForEach-Object{[IO.Path]::Combine($root,[string]$_)})))
      $found=Get-GoriqLocationMetadata -LiteralPath ([IO.Path]::Combine($root,'.jarvis','compass.db'))
      $missing=Get-GoriqLocationMetadata -LiteralPath ([IO.Path]::Combine($root,'missing','compass.db'))
      $fileParent=Get-GoriqLocationMetadata -LiteralPath ([IO.Path]::Combine($root,'not-directory','compass.db'))
      $link=if(Test-Path -LiteralPath ([IO.Path]::Combine($root,'junction'))){Get-GoriqLocationMetadata -LiteralPath ([IO.Path]::Combine($root,'junction','compass.db'))}else{@{status='NOT_TESTED_ON_WINDOWS'}}
      $report=New-GoriqOriginalLocationReport -Volumes @(@{id='volume-01';root='E:\\';driveType='Fixed';ready=$true;mediaType='UNKNOWN'}) -Candidates @(@{label='repo-compass';path=([IO.Path]::Combine($root,'.jarvis','compass.db'))}) -SourceRevision ('a'*40) -RunId '42'
      $unsafe=Get-GoriqLocationMetadata -LiteralPath '\\\\server\\share\\file'
      $context=@{OS='Windows_NT';GITHUB_REPOSITORY='haji84/AI-';GITHUB_ACTOR='haji84';GITHUB_EVENT_NAME='workflow_dispatch';GITHUB_REF='refs/heads/main';RUNNER_NAME='ZBook';GITHUB_SHA=('a'*40);GITHUB_RUN_ID='42'}
      $saved=@{};foreach($key in $context.Keys){$saved[$key]=[Environment]::GetEnvironmentVariable($key);[Environment]::SetEnvironmentVariable($key,$context[$key])}
      $refused=@()
      try{foreach($key in $context.Keys){[Environment]::SetEnvironmentVariable($key,'WRONG');try{Invoke-GoriqOriginalLocationInspection;throw 'TEST_CONTEXT_WAS_ACCEPTED'}catch{if($_.Exception.Message -ne 'ORIGINAL_LOCATION_CONTEXT_REFUSED'){throw};$refused+= $key};[Environment]::SetEnvironmentVariable($key,$context[$key])}}
      finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key])}}
      @{found=$found;missing=$missing;fileParent=$fileParent;link=$link;planCount=$plan.Count;planLabels=@($plan.label);volumeLabels=@($volumePlan.label);boundedCount=$boundedPlan.Count;boundedLabels=@($boundedPlan.label);unsafe=$unsafe;refused=$refused;report=$report}|ConvertTo-Json -Depth 12 -Compress
    `;
    const shell = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';
    const run = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.replace(/^\uFEFF/, ''));
    assert.equal(out.found.status, 'FILE');
    assert.equal(out.found.bytes, 18);
    assert.equal(out.missing.status, 'MISSING');
    assert.equal(out.fileParent.status, 'NOT_DIRECTORY');
    if (process.platform !== 'win32') assert.equal(out.link.status, 'REPARSE_REFUSED');
    assert.ok(out.planCount > 5 && out.planCount <= 512);
    assert.equal(new Set(out.planLabels).size, out.planLabels.length);
    assert.ok(out.planLabels.includes('profile-state-compass'));
    assert.ok(out.planLabels.includes('profile-bridge-compass'));
    assert.ok(out.volumeLabels.every(label => label.startsWith('volume-02-')));
    assert.equal(out.boundedCount, 512);
    assert.equal(new Set(out.boundedLabels).size, out.boundedLabels.length);
    for (let i=1; i<=32; i++) for (const suffix of ['goriq','jarvis','jarvis-ai-','ai-','hidden-goriq','hidden-goriq-handoff','workspace']) assert.ok(out.boundedLabels.includes(`volume-${String(i).padStart(2, '0')}-${suffix}`));
    assert.equal(out.unsafe.status, 'UNSAFE_PATH');
    assert.deepEqual(out.refused.sort(), ['OS','GITHUB_REPOSITORY','GITHUB_ACTOR','GITHUB_EVENT_NAME','GITHUB_REF','RUNNER_NAME','GITHUB_SHA','GITHUB_RUN_ID'].sort());
    assert.equal(out.report.originalGoalRecovered, false);
    assert.equal(out.report.contentsRead, false);
    assert.equal(out.report.goalId, 'goal-fcc81c97e09153f7');
    assert.equal(out.report.jobId, 'rotation-recovery-37');
    assert.equal(out.report.candidates[0].status, 'FILE');
    assert.equal(out.report.configuredProductionPath, 'UNAVAILABLE_WITHOUT_DECRYPTION');
    assert.ok(!run.stdout.includes(root));
    assert.ok(!run.stdout.includes('PRIVATE_GOAL_BYTES'));
    assert.ok(!run.stdout.includes('not-directory'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('manual original-location mode cannot execute Fleet scans or widen remote authority', () => {
  const workflow = readFileSync('.github/workflows/goriq-zbook-fleet-liveness.yml', 'utf8');
  assert.match(workflow, /original_state_only:\s*\n\s*description:.*\n\s*type: boolean\s*\n\s*default: false/);
  assert.match(workflow, /if:.*inputs.original_state_only/);
  assert.match(workflow, /GORIQ_PC_APPROVED_REVISION: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /node scripts\/goriq-pc-approved-source.mjs/);
  assert.match(workflow, /\(git rev-parse HEAD\) -ne \$env:GITHUB_SHA/);
  assert.match(workflow, /if:.*!inputs.original_state_only/);
  assert.match(workflow, /System32\\WindowsPowerShell\\v1.0\\powershell.exe/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write|secrets\.|inputs\.(?:path|command|url)|goriq-g1-backup-inventory/);
  const source = readFileSync(script, 'utf8');
  for (const required of ['haji84/AI-', 'haji84', 'refs/heads/main', 'ZBook', 'workflow_dispatch', 'REPARSE_REFUSED', 'INACCESSIBLE', 'BUDGET_EXHAUSTED']) assert.ok(source.includes(required), required);
  assert.doesNotMatch(source, /Get-Content|ReadAll|OpenRead|ConvertTo-SecureString|DatabaseSync|sqlite3|Invoke-Expression|Set-Acl|Start-Service|Stop-Service|Remove-Item/i);
  assert.match(source, /MaxVolumes = 32/);
  assert.match(source, /MaxCandidates = 512/);
  assert.match(source, /BudgetSeconds = 45/);
});
