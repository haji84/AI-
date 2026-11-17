import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import process from 'node:process';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
import { createHash } from 'node:crypto';

const workflow = readFileSync('.github/workflows/goriq-pc-private-network-probe.yml', 'utf8').replaceAll('\r\n', '\n');
const job = workflow.split('\n  zbook_owner_probe:')[1]?.split('\n  observe:')[0];
const root = mkdtempSync(join(tmpdir(), 'owner-probe-workflow-'));
after(() => rmSync(root, { recursive: true, force: true }));
const files = ['scripts/goriq-owner-probe/observe-private-owner.ps1', 'scripts/goriq-owner-probe/goriq-private-owner-probe.cs'];
const sha = 'a'.repeat(40), quote = s => "'" + s.replaceAll("'", "''") + "'";
const object = v => `(ConvertFrom-Json -InputObject ${quote(JSON.stringify(v))})`;
const context = { GITHUB_REPOSITORY: 'haji84/AI-', GITHUB_ACTOR: 'haji84', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_NAME: 'ZBook', RUNNER_OS: 'Windows', OS: 'Windows_NT', GITHUB_SHA: sha, GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GORIQ_ZBOOK_OWNER_PROBE_ONLY: 'true', GORIQ_ZBOOK_BRIDGE_ORIGINAL_ONLY: 'false', GORIQ_ZBOOK_NATIVE_ONLY: 'false', GORIQ_ZBOOK_RUNNER_ONLY: 'false' };
const scenarios = ['valid', ...Object.keys(context).map(k => k.toLowerCase().replaceAll('_', '-')), 'main', 'partial-ci', 'bad-job', 'source-0', 'source-1', 'extra-output', 'raw-target', 'raw-owner', 'bad-authority', 'source-path'];
let run;

// An enabled acquisition job during owner-only inspection would mutate private storage.
test('owner-only mode excludes all existing native/acquisition jobs and conflicting modes', () => {
  assert.ok(job, 'fixed owner observation mode is required');
  const expr = name => workflow.split('\n  ' + name + ':')[1].match(/ {4}if: (.*)/)[1];
  for (const owner of [false, true]) for (const native of [false, true]) for (const bridge of [false, true]) for (const runner of [false, true]) {
    const scope = { github: { repository: 'haji84/AI-', ref: 'refs/heads/main', actor: 'haji84', event_name: 'workflow_dispatch' }, inputs: { zbook_owner_probe_only: owner, zbook_native_only: native, zbook_bridge_original_only: bridge, zbook_runner_only: runner } };
    assert.equal(runInNewContext(expr('zbook_owner_probe'), scope), owner && !native && !bridge && !runner);
    if (owner) for (const name of ['observe', 'zbook_bridge_original', 'zbook_native']) assert.equal(runInNewContext(expr(name), scope), false, name);
  }
});

function prepare() {
  assert.ok(job, 'fixed owner observation mode is required');
  let body = job.match(/ {8}run: \|\n([\s\S]*)$/)[1].split('\n').map(l => l.replace(/^ {10}/, '')).join('\n');
  body = body.replace('[Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT', '$false');
  assert.equal(body.split('Invoke-OwnerProbeObservation -NativeSource').length, 2);
  body = body.replace('Invoke-OwnerProbeObservation -NativeSource', 'Invoke-OwnerProbeFixtureObservation -NativeSource');
  const manifest = [], programs = new Map();
  for (const [i, scenario] of scenarios.entries()) {
    const jobs = ['repository-guard', 'project-checks', 'independent-verifier-container', 'windows-runtime-byte-fixtures'].map(name => ({ name, run_id: 71, head_sha: sha, status: 'completed', conclusion: 'success' }));
    if (scenario === 'partial-ci') jobs.pop();
    if (scenario === 'bad-job') jobs[0].head_sha = 'b'.repeat(40);
    const paths = ['git/ref/heads/main', `actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`, 'actions/runs/71/jobs?filter=latest&per_page=100', ...files.map(f => `contents/${f}?ref=${sha}`)];
    const responses = [{ object: { sha: scenario === 'main' ? 'b'.repeat(40) : sha } }, { workflow_runs: [{ id: 71, name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success' }] }, { total_count: jobs.length, jobs }, ...files.map((f, n) => ({ path: scenario === 'source-path' ? 'PRIVATE_PATH' : f, type: 'file', encoding: 'base64', size: readFileSync(f).length, content: scenario === 'source-' + n ? 'UFJJVkFURQ==' : readFileSync(f).toString('base64') }))];
    const fixture = `$global:ownerProbeHttp=0
$global:ownerProbeFixtureResponses=$null
function Invoke-RestMethod { [CmdletBinding()] param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection)
 if($Method -cne 'Get' -or $TimeoutSec -ne 10 -or $MaximumRedirection -ne 0 -or $Headers.Count -ne 2){throw 'PRIVATE_HTTP'}
 $paths=@(${paths.map(p => quote('https://api.github.com/repos/haji84/AI-/' + p)).join(',')})
 if($Uri -cne $paths[$global:ownerProbeHttp]){throw 'PRIVATE_URI'}
 if($null -eq $global:ownerProbeFixtureResponses){$global:ownerProbeFixtureResponses=@(${responses.map(object).join(',')})}
 $response=$global:ownerProbeFixtureResponses[$global:ownerProbeHttp];$global:ownerProbeHttp++;return $response
}
function Invoke-OwnerProbeFixtureObservation { param([string]$NativeSource)
 if($NativeSource.Length -lt 100){throw 'PRIVATE_SOURCE'}
 ${scenario === 'extra-output' ? "Write-Output 'PRIVATE_EXTRA'" : ''}
 $r=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'|ConvertFrom-Json
 $r.target='HANDOFF';$r.reason='PRIVATE_OWNER_UNVERIFIED'
 $r.observations=@()
 foreach($name in @('IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT','ANCESTOR_01','PROFILE')){
  $native=$name -notin @('IDENTITY','PROFILE_ENVIRONMENT');$private=$name -ceq 'PROFILE'
  $r.observations+=@{target=$name;reason='OBSERVED_POLICY_MATCH';storageVerified=$native;attributesVerified=$native;finalPathVerified=$native;owner=$(if(-not $native){'UNOBSERVED'}elseif($private){'CURRENT_USER'}else{'OTHER'});dacl=$(if(-not $native){'UNOBSERVED'}elseif($private){'PRIVATE_POLICY_MATCH'}else{'ANCESTOR_METADATA_ONLY'})}
 }
 $r.observations+=@{target='HANDOFF';reason='PRIVATE_OWNER_UNVERIFIED';storageVerified=$true;attributesVerified=$true;finalPathVerified=$true;owner='OTHER';dacl='UNOBSERVED'}
 ${scenario === 'raw-target' ? "$r.target='PRIVATE_PATH'" : ''}
 ${scenario === 'raw-owner' ? "$r.observations[0].owner='S-1-5-21-PRIVATE'" : ''}
 ${scenario === 'bad-authority' ? "$r.recovered=$true" : ''}
 $r|ConvertTo-Json -Depth 5 -Compress
}
`;
    const key = scenario.toUpperCase().replaceAll('-', '_');
    const env = { ...context, ...(key in context ? { [key]: 'untrusted' } : {}) };
    const text = fixture + body, digest = createHash('sha256').update(text).digest('hex');
    let file = programs.get(digest);
    if (!file) { file = join(root, 'case-' + i + '.ps1'); writeFileSync(file, text); programs.set(digest, file); }
    else assert.equal(readFileSync(file, 'utf8'), text);
    manifest.push({ scenario, file, env });
  }
  const manifestFile = join(root, 'manifest.json'); writeFileSync(manifestFile, JSON.stringify(manifest));
  for (const row of manifest) writeFileSync(manifestFile + '.' + row.scenario + '.json', JSON.stringify(row));
  const wrapper = join(root, 'wrapper.ps1');
  writeFileSync(wrapper, `param([string]$Scenario,[string]$Manifest)
$initial=[Environment]::GetEnvironmentVariables()
$case=@(Get-Content -LiteralPath ($Manifest+'.'+$Scenario+'.json') -Raw|ConvertFrom-Json)[0]
if($case.scenario -cne $Scenario){throw 'PS_FIXTURE_CASE_UNKNOWN'}
foreach($p in $case.env.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value)}
$output=@(& $case.file);$status=0;if($null -ne $LASTEXITCODE){$status=$LASTEXITCODE};$LASTEXITCODE=0
foreach($key in @([Environment]::GetEnvironmentVariables().Keys)){if(-not $initial.Contains($key)){[Environment]::SetEnvironmentVariable([string]$key,[NullString]::Value)}}
foreach($key in $initial.Keys){[Environment]::SetEnvironmentVariable([string]$key,[string]$initial[$key])}
[ordered]@{output=@($output);status=$status;http=$global:ownerProbeHttp}|ConvertTo-Json -Depth 6 -Compress
`);
  // Keep all25 cases and each process's10s bound. Smaller owned batches leave
  // room for Windows parsing/startup while every case retains a fresh runspace.
  assert.equal(scenarios.length, 25);
  const runners = new Map();
  for (let offset = 0; offset < scenarios.length; offset += 9) {
    const group = scenarios.slice(offset, offset + 9);
    const execute = createPowerShellFixtureBatch({ shell: 'pwsh', fixture: wrapper, scenarios: group, parameters: { Manifest: manifestFile }, timeoutMs: 10000 });
    for (const scenario of group) runners.set(scenario, execute);
  }
  run = scenario => {
    const execute = runners.get(scenario);
    assert.ok(execute, 'PS_FIXTURE_CASE_UNKNOWN');
    return execute(scenario);
  };
}

for (const scenario of scenarios) test('owner observation workflow refuses unsafe boundary: ' + scenario, () => {
  if (!run) prepare();
  const result = run(scenario); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); assert.doesNotMatch(result.stdout, /PRIVATE_PATH|PRIVATE_EXTRA|S-1-5|PRIVATE_SOURCE/);
  const value = JSON.parse(result.stdout); assert.equal(value.output.length, 1);
  if (scenario === 'valid') {
    assert.equal(value.status, 0); assert.match(value.output[0], /^GORIQ_ZBOOK_OWNER_OBSERVATION /);
    const report = JSON.parse(value.output[0].slice('GORIQ_ZBOOK_OWNER_OBSERVATION '.length));
    assert.equal(report.target, 'HANDOFF'); assert.equal(report.reason, 'PRIVATE_OWNER_UNVERIFIED');
    assert.equal(report.observations.at(-1).owner, 'OTHER'); assert.equal(report.recovered, false); assert.equal(report.historicalStateProven, false);
  } else {
    assert.equal(value.status, 1); assert.match(value.output[0], /^GORIQ_ZBOOK_OWNER_REFUSED [A-Z_]+$/);
    const key = scenario.toUpperCase().replaceAll('-', '_');
    if (key in context) assert.equal(value.http, 0);
    if (['main', 'partial-ci', 'bad-job'].includes(scenario)) assert.match(value.output[0], /CURRENT_MAIN_CI_UNVERIFIED$/);
  }
});

// Exercise actual C#5 reducers, output reconstruction and a native Windows child
// with inert C# only. The inert child never opens private observation targets.
test('owner probe pure suite and in-memory supervised child fixtures', { timeout: 60000 }, () => {
  const file = resolve('scripts/goriq-owner-probe/test-owner-probe.ps1');
  assert.ok(existsSync(file), 'reviewed metadata probe and executable tests are required');
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', file], { encoding: 'utf8', timeout: 55000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout.slice(-6000)); assert.equal(result.stderr, ''); assert.match(result.stdout, /TOTAL_PASS=\d+/);
});

test('owned observer timeout has its own bounded inert process fixture', { timeout: 60000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('scripts/goriq-owner-probe/test-owner-probe-timeout.ps1')], { encoding: 'utf8', timeout: 55000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout.slice(-6000));
  assert.equal(result.stderr, ''); assert.match(result.stdout, /TOTAL_PASS=1/);
});

test('embedded owner bootstrap preserves closed failure phases before observation', { timeout: 15000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('scripts/goriq-owner-probe/test-owner-probe-bootstrap.ps1')], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /TOTAL_PASS=14/);
  assert.match(result.stdout, /SOURCE_STREAM_PASS=16/);
});

test('approved SYSTEM owner exception is confined to the verified profile root', { timeout: 20000 }, () => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('scripts/goriq-owner-probe/test-profile-system-owner.ps1')], { encoding: 'utf8', timeout: 17000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /PROFILE_POLICY_PASS=\d+/);
  assert.match(result.stdout, /PROFILE_CAPABILITY_PASS=\d+/);
  if (process.platform === 'win32') {
    assert.match(result.stdout, /CAPTURE_CAPABILITY_BOUNDARY_PASS=16/);
    assert.match(result.stdout, /OBSERVER_CAPABILITY_BOUNDARY_PASS=7/);
  }
  assert.match(result.stdout, /SECURITY_CASES_PASS=11/);
  if (process.platform === 'win32') assert.match(result.stdout, /SECURITY_BOUNDARY_PASS=11/);
});
