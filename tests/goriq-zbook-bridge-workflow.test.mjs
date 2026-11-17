import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
const workflow=readFileSync('.github/workflows/goriq-pc-private-network-probe.yml','utf8');
const job=workflow.split('\n  zbook_bridge_original:')[1]?.split('\n  zbook_native:')[0];
const root=mkdtempSync(join(tmpdir(),'bridge-workflow-'));after(()=>rmSync(root,{recursive:true,force:true}));
const files=['scripts/goriq-zbook-bridge-original-read.ps1','scripts/goriq-zbook-bridge-original-read.mjs','scripts/goriq-g1-backup-inventory.mjs','scripts/goriq-zbook-bridge-capture.cs'];
const sha='a'.repeat(40),quote=s=>"'"+s.replaceAll("'","''")+"'",object=v=>`(ConvertFrom-Json -InputObject ${quote(JSON.stringify(v))})`;
const context={GITHUB_REPOSITORY:'haji84/AI-',GITHUB_ACTOR:'haji84',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',RUNNER_NAME:'ZBook',RUNNER_OS:'Windows',OS:'Windows_NT',GITHUB_SHA:sha,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'2',GORIQ_ZBOOK_BRIDGE_ORIGINAL_ONLY:'true',GORIQ_ZBOOK_NATIVE_ONLY:'false',GORIQ_ZBOOK_RUNNER_ONLY:'false'};
const scenarios=['valid',...Object.keys(context).map(k=>k.toLowerCase().replaceAll('_','-')),...files.map((_,i)=>'source-'+i),'main','partial-ci','bad-job','extra-output','raw-phase','invalid-json','source-path','source-encoding'];
let run;
function prepare() {
 assert.ok(job,'fixed reader job required');const body=job.match(/ {8}run: \|\n([\s\S]*)$/)[1].split('\n').map(l=>l.replace(/^ {10}/,'')).join('\n');
 const manifest=[];
 for(const [index,scenario] of scenarios.entries()) {
  let script=body.replace('[Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT','$false');
  const invocation='Invoke-GoriqBridgeRead -QuerySource';assert.equal(script.split(invocation).length,2);script=script.replace(invocation,'Invoke-BridgeFixtureRead -QuerySource');
  const ciJobs=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map(name=>({name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
  if(scenario==='partial-ci')ciJobs.pop();if(scenario==='bad-job')ciJobs[0].head_sha='b'.repeat(40);
  const responses=[{object:{sha:scenario==='main'?'b'.repeat(40):sha}},{workflow_runs:[{id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success'}]},{total_count:ciJobs.length,jobs:ciJobs},...files.map((f,i)=>{const bytes=readFileSync(f);return {path:scenario==='source-path'?'PRIVATE_PATH':f,type:'file',encoding:scenario==='source-encoding'?'utf8':'base64',size:bytes.length,content:scenario==='source-'+i?'UFJJVkFURV9CQURfU09VUkNF':bytes.toString('base64')};})];
  const paths=['git/ref/heads/main',`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,'actions/runs/71/jobs?filter=latest&per_page=100',...files.map(f=>`contents/${f}?ref=${sha}`)];
 // Initialize mock response data once in each fresh case, before the unchanged
 // workflow body; API call counters, replies and assertions remain identical.
 const prefix=`$script:http=0
$script:fixtureResponses=$null
function Invoke-RestMethod { [CmdletBinding()] param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection)
 if($Method -cne 'Get' -or $TimeoutSec -ne 10 -or $MaximumRedirection -ne 0 -or $Headers.Count -ne 2){throw 'PRIVATE_HTTP'}
 $paths=@(${paths.map(p=>quote('https://api.github.com/repos/haji84/AI-/'+p)).join(',')});if($Uri -cne $paths[$script:http]){throw 'PRIVATE_URI'}
 if($null -eq $script:fixtureResponses){$script:fixtureResponses=@(${responses.map(object).join(',')})}
 $r=$script:fixtureResponses[$script:http];$script:http++;return $r
}
function Invoke-BridgeFixtureRead { param([byte[]]$QuerySource,[byte[]]$InventorySource,[string]$NativeSource)
 if($QuerySource.Length -lt 100 -or $InventorySource.Length -lt 100 -or $NativeSource.Length -lt 100){throw 'PRIVATE_SOURCE'}
 ${scenario==='extra-output'?"Write-Output 'PRIVATE_EXTRA'":''}
 ${scenario==='invalid-json'?"throw 'PRIVATE_JSON'":''}
 $r=New-GoriqBridgeSummary;$r.status='COPIED_STATE_READ';$r.queryVerified=$true;$r.failureCode='NONE';$r.preserved=$true;$r.preservationMode='OBSERVED_STABLE_SHARED'
 ${scenario==='raw-phase'?"$r.workRunPhase='PRIVATE_PHASE'":''}
 return $r
}
`;
  const envKey=scenario.toUpperCase().replaceAll('-','_');const env={...context,...(context[envKey]?{[envKey]:'untrusted'}:{})};
  const file=join(root,'case-'+index+'.ps1');writeFileSync(file,prefix+script);manifest.push({scenario,file,env});
 }
 const manifestFile=join(root,'manifest.json');writeFileSync(manifestFile,JSON.stringify(manifest));
 for(const row of manifest)writeFileSync(manifestFile+'.'+row.scenario+'.json',JSON.stringify(row));
 const wrapper=join(root,'wrapper.ps1');writeFileSync(wrapper,`param([string]$Scenario,[string]$Manifest)
$case=@(Get-Content -LiteralPath ($Manifest+'.'+$Scenario+'.json') -Raw|ConvertFrom-Json)[0]
if($case.scenario -cne $Scenario){throw 'PS_FIXTURE_CASE_UNKNOWN'}
foreach($p in $case.env.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value)}
$output=@(& $case.file);$status=0;if($null -ne $LASTEXITCODE){$status=$LASTEXITCODE};$LASTEXITCODE=0
[ordered]@{output=@($output);status=$status;http=$script:http}|ConvertTo-Json -Depth 6 -Compress
`);
 // This wrapper mutates env intentionally; generic helper checks restoration.
 // Each fresh runspace restores all env values before returning.
 const old=readFileSync(wrapper,'utf8');writeFileSync(wrapper,old.replace('$case=@(',"$initial=[Environment]::GetEnvironmentVariables()\n$case=@(").replace('[ordered]@{output=',`foreach($key in @([Environment]::GetEnvironmentVariables().Keys)){if(-not $initial.Contains($key)){[Environment]::SetEnvironmentVariable([string]$key,[NullString]::Value)}}
foreach($key in $initial.Keys){[Environment]::SetEnvironmentVariable([string]$key,[string]$initial[$key])}
[ordered]@{output=`));
 run=createPowerShellFixtureBatch({shell:'pwsh',fixture:wrapper,scenarios,parameters:{Manifest:manifestFile},timeoutMs:10000});
}
for(const scenario of scenarios)test('fixed bridge workflow '+scenario+' validates gates and all pinned public sources',()=>{
 if(!run)prepare();const record=run(scenario);assert.equal(record.status,0,record.stderr);assert.equal(record.stderr,'');assert.doesNotMatch(record.stdout,/PRIVATE/);const r=JSON.parse(record.stdout);
 if(scenario==='valid'){assert.equal(r.status,0);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_ZBOOK_BRIDGE_ORIGINAL /);assert.equal(JSON.parse(r.output[0].split('GORIQ_ZBOOK_BRIDGE_ORIGINAL ')[1]).originalGoalRecovered,false);}
 else {assert.equal(r.status,1);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_ZBOOK_BRIDGE_REFUSED [A-Z_]+$/);}
});
test('each selected mode excludes new fixed reader and all source pins exactly match local public bytes',()=>{
 assert.ok(job);
 for(const f of files)assert.ok(job.includes(createHash('sha256').update(readFileSync(f)).digest('hex')),f);
 const expr=name=>workflow.split('\n  '+name+':')[1].match(/ {4}if: (.*)/)[1];
 for(const native of [false,true])for(const runner of [false,true])for(const bridge of [false,true]){
  const values={github:{repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84',event_name:'workflow_dispatch'},inputs:{zbook_native_only:native,zbook_runner_only:runner,zbook_bridge_original_only:bridge}};
  assert.equal(runInNewContext(expr('zbook_bridge_original'),values),bridge&&!native&&!runner);
  if(bridge){assert.equal(runInNewContext(expr('observe'),values),false);assert.equal(runInNewContext(expr('zbook_native'),values),false);}
 }
});
