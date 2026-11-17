import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
import { runInNewContext } from 'node:vm';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const workflow=readFileSync('.github/workflows/goriq-pc-private-network-probe.yml','utf8');
const pin='a7ca4f50c60a6da54feab92f14f50308899858ff7e932b85d6eb971707748590';
const locator=readFileSync('scripts/goriq-zbook-original-state-locator.ps1');
const sha='a'.repeat(40);
const context={GITHUB_REPOSITORY:'haji84/AI-',GITHUB_ACTOR:'haji84',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  RUNNER_NAME:'ZBook',RUNNER_OS:'Windows',OS:'Windows_NT',GITHUB_SHA:sha,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'2',GORIQ_ZBOOK_NATIVE_ONLY:'true',GORIQ_ZBOOK_RUNNER_ONLY:'false'};
function body() {
  const job=workflow.split('\n  zbook_native:')[1];assert.ok(job,'separate action-free native job required');
  const inline=job.match(/ {8}run: \|\n([\s\S]*)$/)?.[1];assert.ok(inline);
  return inline.split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const object=value=>`(ConvertFrom-Json -InputObject ${quote(JSON.stringify(value))})`;
const validReport={version:1,mode:'ORIGINAL_LOCATION_METADATA_ONLY',readOnly:true,contentsRead:false,goalId:'goal-fcc81c97e09153f7',jobId:'rotation-recovery-37',
  sourceRevision:sha,runId:'42',checkedAt:'2026-11-16T00:00:00.0000000Z',originalGoalRecovered:false,originalMatch:'NOT_INSPECTED',originalAbsent:'NOT_ESTABLISHED',
  configuredProductionPath:'UNAVAILABLE_WITHOUT_DECRYPTION',coverage:'READY_LOCAL_DRIVE_LETTERS_AND_FIXED_KNOWN_PATHS_ONLY',directoryMountedVolumes:'NOT_ENUMERATED',recursiveSearch:false,
  maxVolumes:32,maxCandidates:512,budgetSeconds:45,budgetScope:'CANDIDATE_METADATA',hardJobTimeoutMinutes:5,candidateLimitReached:false,volumeLimitReached:false,status:'METADATA_ONLY_COMPLETE',
  volumes:[{id:'volume-01',driveLetter:'C',driveType:'Fixed',ready:true,mediaType:'UNKNOWN'}],candidates:[{label:'checkout-default-jobs',status:'FILE',bytes:14}]};
function fixtureProgram({env={},main=sha,runs,jobs,source,queryError=false,processes=['Runner.Listener','Runner.Worker','Runner.Worker.extra'],native=false,transport=true,report=validReport,httpError=false,sourceThrows=false,sourceError=false}={}) {
  let script=body();
  const platform="[Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT";
  assert.equal(script.split(platform).length,2,'exact native boundary must remain testable');
  if(!native)script=script.replace(platform,'$false');
  if(!transport)script=script.replace("$env:OS -cne 'Windows_NT'",'$false');
  // Only the actual native locator execution boundary is substituted. API decode/hash and all production validation run unchanged.
  const invocation='& ([ScriptBlock]::Create($text))';
  assert.equal(script.split(invocation).length,2);
  if(transport)script=script.replace(invocation,`& { [Console]::Error.WriteLine('FIXTURE_SOURCE'); ${sourceError?"Write-Error 'PRIVATE_NONTERMINATING_SOURCE_ERROR' -ErrorAction Continue;":''} ${sourceThrows?"throw 'PRIVATE_SOURCE_EXCEPTION'":quote(JSON.stringify(report))} }`);
  const ci=runs??[{id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success'}];
  const ciJobs=jobs??['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map((name,id)=>({id:id+1,name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
  const responses=[{object:{sha:main}},{workflow_runs:ci},{total_count:ciJobs.length,jobs:ciJobs},source??{type:'file',encoding:'base64',size:locator.length,content:locator.toString('base64')}];
  const paths=['git/ref/heads/main',`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,'actions/runs/71/jobs?filter=latest&per_page=100',`contents/scripts/goriq-zbook-original-state-locator.ps1?ref=${sha}`];
  const prefix=`$script:httpCalls=0
$script:fixtureResponses=@(${responses.map(object).join(',')})
function Invoke-RestMethod { [CmdletBinding()] param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection)
  [Console]::Error.WriteLine('FIXTURE_HTTP')
  if ($Method -ne 'Get' -or $TimeoutSec -gt 10 -or $TimeoutSec -le 0 -or $MaximumRedirection -ne 0 -or $Headers.Count -ne 2 -or $Headers['User-Agent'] -cne 'goriq-zbook-actionfree-readonly' -or $Headers['Accept'] -cne 'application/vnd.github+json') { throw 'PRIVATE_HTTP_OPTIONS' }
  $paths=@(${paths.map(p=>quote('https://api.github.com/repos/haji84/AI-/'+p)).join(',')})
  if ($Uri -cne $paths[$script:httpCalls]) { throw 'PRIVATE_URI' }
  $answers=$script:fixtureResponses
  ${httpError?"throw 'PRIVATE_API_BODY'":'$answer=$answers[$script:httpCalls]; $script:httpCalls++; return $answer'}
}
function Get-Process { [CmdletBinding()] param()
  [Console]::Error.WriteLine('FIXTURE_PROCESS')
  ${queryError?"Write-Error 'PRIVATE_PROCESS_FAILURE'":processes.map(name=>`[pscustomobject]@{ProcessName=${quote(name)}}`).join(';')}
}
`;
  return {text:prefix+script,environment:{...context,...(!transport?{OS:process.env.OS??'Linux'}:{}),...env}};
}
// These 60 fixed inert options match the original per-process cases. Unknown
// options refuse rather than adding unreviewed runspace/process contracts.
const declaredRun={id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success'};
const declaredJobs=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map((name,id)=>({id:id+1,name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
const caseOptions=[
  ...Object.keys(context).map(key=>({env:{[key]:'untrusted'}})),
  ...['0','-1','1.2','1/2','1\n','9'.repeat(21)].map(value=>({env:{GITHUB_RUN_ID:value}})),
  ...['GITHUB_SHA','GITHUB_RUN_ATTEMPT'].map(key=>({env:{[key]:context[key]+'\n'}})),
  {env:{GORIQ_ZBOOK_RUNNER_ONLY:'true'}},{native:true},{main:'b'.repeat(40)},{httpError:true},
  ...[{head_sha:'b'.repeat(40)},{name:'other'},{path:'.github/workflows/other.yml'},{event:'workflow_dispatch'},{head_branch:'other'},{status:'in_progress'},{conclusion:'failure'}].map(change=>({runs:[{...declaredRun,...change}]})),
  ...[declaredJobs.slice(0,3),[...declaredJobs,declaredJobs[0]],...[
    {conclusion:'failure'},{status:'in_progress'},{head_sha:'b'.repeat(40)},{name:'other'},{run_id:72},{name:declaredJobs[1].name},
  ].map(change=>declaredJobs.map((job,index)=>index?job:{...job,...change}))].map(jobs=>({jobs})),
  {queryError:true},{processes:Array(65).fill('Runner.Worker')},
  ...[{encoding:'utf8',content:'PRIVATE',size:4,type:'file'},{encoding:'base64',content:'!!!!',size:3,type:'file'},
    {encoding:'base64',content:Buffer.from('PRIVATE_WRONG_SOURCE').toString('base64'),size:20,type:'file'},
    {encoding:'base64',content:Buffer.alloc(65537).toString('base64'),size:65537,type:'file'},
    {encoding:'base64',content:'A'.repeat(90001),size:65536,type:'file'},
    {encoding:'base64',content:locator.toString('base64'),size:locator.length+1,type:'file'}].map(source=>({source})),
  {},{processes:[]},{transport:false},{sourceThrows:true},{sourceError:true},
  ...[null,'PRIVATE_MALFORMED',{...validReport,originalGoalRecovered:true},{...validReport,sourceRevision:'b'.repeat(40)},
    {...validReport,candidates:[{label:'PRIVATE_PATH',status:'FILE',bytes:2}]},{...validReport,candidates:[{label:'checkout',status:'FILE',bytes:-1}]},
    {...validReport,volumes:[{...validReport.volumes[0],driveLetter:'PRIVATE'}]},{...validReport,extra:'PRIVATE'}].map(report=>({report})),
];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const caseKey=value=>JSON.stringify(canonical(value));
const batchEnabled=['linux','darwin'].includes(process.platform);
let batchRoot,batchRun,batchCases;
after(()=>{if(batchRoot)rmSync(batchRoot,{recursive:true,force:true});});
function ensureBatch() {
  if(batchRun)return;
  assert.equal(caseOptions.length,60);assert.equal(new Set(caseOptions.map(caseKey)).size,60);
  batchRoot=mkdtempSync(join(tmpdir(),'actionfree-fixture-batch-'));
  batchCases=new Map();
  // Identical inert programs share parser/cache bytes, while every scenario
  // still has a fresh runspace, environment and original-file canary.
  const manifest=[],programFiles=new Map();
  for(const [index,options] of caseOptions.entries()) {
    const scenario='case-'+String(index).padStart(2,'0');
    const root=mkdtempSync(join(batchRoot,'case-')),canary=join(root,'original.db');
    const program=fixtureProgram(options),key=createHash('sha256').update(program.text).digest('hex');
    let file=programFiles.get(key);
    if(!file){file=join(batchRoot,'program-'+key+'.ps1');writeFileSync(file,program.text);programFiles.set(key,file);}
    else assert.equal(readFileSync(file,'utf8'),program.text);
    writeFileSync(canary,'PRIVATE_ORIGINAL_BYTES');
    manifest.push({scenario,root,file,environment:{...program.environment,GITHUB_WORKSPACE:root}});
    batchCases.set(caseKey(options),{scenario,root,file,canary});
  }
  const manifestFile=join(batchRoot,'cases.json');writeFileSync(manifestFile,JSON.stringify(manifest));
  // Parse only this case's immutable input; retain the complete manifest too.
  for(const row of manifest)writeFileSync(manifestFile+'.'+row.scenario+'.json',JSON.stringify(row));
  const wrapper=join(batchRoot,'batch.ps1');
  writeFileSync(wrapper,`param([string]$Scenario,[string]$Manifest)
$ErrorActionPreference='Stop'
$case=Get-Content -LiteralPath ($Manifest+'.'+$Scenario+'.json') -Raw|ConvertFrom-Json
if($null -eq $case -or $case.scenario -cne $Scenario) { throw 'PS_FIXTURE_CASE_UNKNOWN' }
$initialEnvironment=[Environment]::GetEnvironmentVariables()
$initialDirectory=[Environment]::CurrentDirectory
$initialLocation=Get-Location
$initialError=[Console]::Error
$privateError=[IO.StringWriter]::new()
$output=@();$exitStatus=0
try {
  foreach($property in $case.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value) }
  [Environment]::CurrentDirectory=$case.root
  Set-Location -LiteralPath $case.root
  [Console]::SetError($privateError)
  $caseError=[Console]::Error
  $caseEnvironment=[Environment]::GetEnvironmentVariables()
  $output=@(& $case.file)
  if($null -ne $LASTEXITCODE) { $exitStatus=[int]$LASTEXITCODE }
  $currentEnvironment=[Environment]::GetEnvironmentVariables()
  $changed=$currentEnvironment.Count -ne $caseEnvironment.Count -or [Environment]::CurrentDirectory -cne $case.root -or
    (Get-Location).Path -cne $case.root -or -not [object]::ReferenceEquals([Console]::Error,$caseError)
  foreach($key in $caseEnvironment.Keys) {
    if(-not $currentEnvironment.Contains($key) -or $currentEnvironment[$key] -cne $caseEnvironment[$key]) { $changed=$true }
  }
  if($changed) { throw 'PS_FIXTURE_CASE_STATE_CHANGED' }
} finally {
  [Console]::SetError($initialError)
  foreach($key in @([Environment]::GetEnvironmentVariables().Keys)) {
    if(-not $initialEnvironment.Contains($key)) { [Environment]::SetEnvironmentVariable([string]$key,[NullString]::Value) }
  }
  foreach($key in $initialEnvironment.Keys) { [Environment]::SetEnvironmentVariable([string]$key,[string]$initialEnvironment[$key]) }
  Set-Location -LiteralPath $initialLocation.Path
  [Environment]::CurrentDirectory=$initialDirectory
}
$stdout=($output -join "\`n");if($output.Count -gt 0){$stdout+="\`n"}
$stderr=$privateError.ToString();$privateError.Dispose()
# The envelope preserves the child script's exit/result; the wrapper itself
# succeeds only after restoring the process state checked by the generic helper.
$LASTEXITCODE=0
[ordered]@{status=$exitStatus;stdout=$stdout;stderr=$stderr}|ConvertTo-Json -Compress
`);
  batchRun=createPowerShellFixtureBatch({shell:'pwsh',fixture:wrapper,scenarios:manifest.map(row=>row.scenario),parameters:{Manifest:manifestFile},timeoutMs:10000});
}
function fixture(options={}) {
  let root,file,canary,result;
  if(batchEnabled) {
    ensureBatch();
    const entry=batchCases.get(caseKey(options));assert.ok(entry,'PS_FIXTURE_CASE_UNKNOWN');
    ({root,file,canary}=entry);
    const wire=batchRun(entry.scenario);assert.equal(wire.status,0,wire.stdout+wire.stderr);assert.equal(wire.stderr,'');
    result=JSON.parse(wire.stdout);assert.deepEqual(Object.keys(result),['status','stdout','stderr']);
    assert.ok(Number.isInteger(result.status));assert.equal(typeof result.stdout,'string');assert.equal(typeof result.stderr,'string');
  } else {
    // Native Windows contracts keep the original fresh-process boundary.
    root=mkdtempSync(join(tmpdir(),'actionfree-fixture-'));file=join(root,'fixture.ps1');canary=join(root,'original.db');
    const program=fixtureProgram(options);writeFileSync(file,program.text);writeFileSync(canary,'PRIVATE_ORIGINAL_BYTES');
    result=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',file],
      {encoding:'utf8',timeout:10000,maxBuffer:262144,cwd:root,env:{...process.env,GITHUB_WORKSPACE:root,...program.environment}});
  }
  try {
    assert.equal(result.error,undefined);assert.equal(readFileSync(canary,'utf8'),'PRIVATE_ORIGINAL_BYTES');
    assert.doesNotMatch(result.stdout,/PRIVATE|actionfree-fixture|api\.github|original\.db|Get-Process/);
    return {...result,http:(result.stderr.match(/FIXTURE_HTTP/g)||[]).length,process:(result.stderr.match(/FIXTURE_PROCESS/g)||[]).length,source:(result.stderr.match(/FIXTURE_SOURCE/g)||[]).length};
  }finally{if(!batchEnabled)rmSync(root,{recursive:true,force:true});}
}
function refused(result,{http,process:queries=0,source=0,counts=false}={}) {
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.match(result.stdout,/GORIQ_ZBOOK_NATIVE_STARTED/);assert.match(result.stdout,/GORIQ_ZBOOK_NATIVE_REFUSED [A-Z_]+/);
  assert.doesNotMatch(result.stdout,/GORIQ_ZBOOK_ORIGINAL_LOCATION /);
  assert.equal(result.stdout.includes('GORIQ_ZBOOK_PROCESS_OBSERVATION '),counts);
  if(http!==undefined)assert.equal(result.http,http);assert.equal(result.process,queries);assert.equal(result.source,source);
  assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE/);
}

test('native route is false-default, mutually exclusive and has no external action preparation',()=>{
  assert.match(workflow,/zbook_native_only:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
  const observe=workflow.split('\n  observe:')[1].split('\n  zbook_native:')[0];
  const job=workflow.split('\n  zbook_native:')[1];assert.ok(job);assert.doesNotMatch(job,/\buses:|actions\/checkout|setup-node|upload-artifact|container:|services:/);
  assert.match(job,/runs-on: \[self-hosted, Windows, X64\]/);assert.match(job,/timeout-minutes: 3/);assert.match(job,/shell: powershell/);
  assert.match(job,/GORIQ_ZBOOK_NATIVE_ONLY: \$\{\{ inputs.zbook_native_only \}\}/);assert.match(job,/GORIQ_ZBOOK_RUNNER_ONLY: \$\{\{ inputs.zbook_runner_only \}\}/);
  const normal=observe.match(/ {4}if: (.*)/)[1],native=job.match(/ {4}if: (.*)/)[1];
  for(const zbook_native_only of [false,true])for(const zbook_runner_only of [false,true]) {
    const values={github:{repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84',event_name:'workflow_dispatch'},inputs:{zbook_native_only,zbook_runner_only}};
    assert.equal(runInNewContext(normal,values),!zbook_native_only);assert.equal(runInNewContext(native,values),zbook_native_only);
    for(const key of ['repository','ref','actor','event_name'])assert.equal(runInNewContext(native,{...values,github:{...values.github,[key]:'untrusted'}}),false);
  }
  assert.equal(createHash('sha256').update(locator).digest('hex'),pin);assert.ok(body().includes(pin));
  assert.equal((body().match(/Get-Process/g)||[]).length,1);assert.match(body(),/Get-Process -ErrorAction Stop/);
  assert.doesNotMatch(body(),/\$env:(GITHUB_WORKSPACE|GITHUB_SHA|GITHUB_ACTOR|GITHUB_REPOSITORY|RUNNER_NAME|OS)\s*=/i);
  assert.doesNotMatch(body(),/Set-Content|Out-File|WriteAll|Remove-Item|Start-Process|Stop-Process|Invoke-Expression|GITHUB_TOKEN|Authorization|https:\/\/(?!api\.github\.com)/i);
});
test('native context and both-flags refusal precede every network/process/source boundary',()=>{
  for(const key of Object.keys(context))refused(fixture({env:{[key]:'untrusted'}}),{http:0});
  for(const value of ['0','-1','1.2','1/2','1\n','9'.repeat(21)])refused(fixture({env:{GITHUB_RUN_ID:value}}),{http:0});
  for(const key of ['GITHUB_SHA','GITHUB_RUN_ATTEMPT'])refused(fixture({env:{[key]:context[key]+'\n'}}),{http:0});
  refused(fixture({env:{GORIQ_ZBOOK_RUNNER_ONLY:'true'}}),{http:0});
  refused(fixture({native:true}),{http:0});
});
test('noncurrent, unsuccessful or partial exact-main CI refuses before process/source',()=>{
  refused(fixture({main:'b'.repeat(40)}),{http:1});refused(fixture({httpError:true}),{http:1});
  const valid={id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success'};
  for(const mutation of [{head_sha:'b'.repeat(40)},{name:'other'},{path:'.github/workflows/other.yml'},{event:'workflow_dispatch'},{head_branch:'other'},{status:'in_progress'},{conclusion:'failure'}])refused(fixture({runs:[{...valid,...mutation}]}),{http:2});
  const good=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map((name,id)=>({id:id+1,name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
  for(const jobs of [good.slice(0,3),[...good,good[0]],good.map((j,i)=>i?j:{...j,conclusion:'failure'}),good.map((j,i)=>i?j:{...j,status:'in_progress'}),good.map((j,i)=>i?j:{...j,head_sha:'b'.repeat(40)}),good.map((j,i)=>i?j:{...j,name:'other'}),good.map((j,i)=>i?j:{...j,run_id:72}),good.map((j,i)=>i?j:{...j,name:good[1].name})])refused(fixture({jobs}),{http:3});
});
test('process query errors cannot be reported as verified absence',()=>{
  refused(fixture({queryError:true}),{http:3,process:1});
  refused(fixture({processes:Array(65).fill('Runner.Worker')}),{http:3,process:1});
});
test('encoding, source hash and source size refuse before locator execution',()=>{
  for(const source of [{encoding:'utf8',content:'PRIVATE',size:4,type:'file'},{encoding:'base64',content:'!!!!',size:3,type:'file'},
    {encoding:'base64',content:Buffer.from('PRIVATE_WRONG_SOURCE').toString('base64'),size:20,type:'file'},
    {encoding:'base64',content:Buffer.alloc(65537).toString('base64'),size:65537,type:'file'},
    {encoding:'base64',content:'A'.repeat(90001),size:65536,type:'file'},
    {encoding:'base64',content:locator.toString('base64'),size:locator.length+1,type:'file'}])refused(fixture({source}),{http:4,process:1,counts:true});
});
test('modelled valid transport fixture verifies exact process names and sanitized metadata; no native proof',()=>{
  const result=fixture();assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.http,4);assert.equal(result.process,1);assert.equal(result.source,1);
  const counts=JSON.parse(result.stdout.split('GORIQ_ZBOOK_PROCESS_OBSERVATION ')[1].split('\n')[0]);
  assert.equal(counts.sourceRevision,sha);assert.equal(counts.runId,'42');assert.equal(counts.runAttempt,'2');assert.equal(counts.processObservationVerified,true);assert.equal(counts.listenerCount,1);assert.equal(counts.workerCount,1);assert.equal(counts.originalGoalRecovered,false);
  const metadata=JSON.parse(result.stdout.split('GORIQ_ZBOOK_ORIGINAL_LOCATION ')[1].split('\n')[0]);assert.deepEqual(metadata,validReport);
  const absence=fixture({processes:[]});assert.equal(absence.status,0,absence.stderr);assert.match(absence.stdout,/"listenerCount":0/);assert.match(absence.stdout,/"workerCount":0/);
});
test('unchanged pinned locator native guard and malformed metadata remain refusals after verified counts',()=>{
  // Outer native fixture boundary only; original locator sees Linux and refuses, without any guard rewrite.
  const result=fixture({transport:false});refused(result,{http:4,process:1,counts:true});
  refused(fixture({sourceThrows:true}),{http:4,process:1,source:1,counts:true});
  refused(fixture({sourceError:true}),{http:4,process:1,source:1,counts:true});
  for(const report of [null,'PRIVATE_MALFORMED',{...validReport,originalGoalRecovered:true},{...validReport,sourceRevision:'b'.repeat(40)},
    {...validReport,candidates:[{label:'PRIVATE_PATH',status:'FILE',bytes:2}]},{...validReport,candidates:[{label:'checkout',status:'FILE',bytes:-1}]},
    {...validReport,volumes:[{...validReport.volumes[0],driveLetter:'PRIVATE'}]},{...validReport,extra:'PRIVATE'}])refused(fixture({report}),{http:4,process:1,source:1,counts:true});
});
