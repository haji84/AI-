import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
const workflow=readFileSync('.github/workflows/goriq-source-private-acl-repair-1219.yml','utf8');
const job=workflow.split('\n  source_private_acl:')[1];
const root=mkdtempSync(join(tmpdir(),'source-repair-gates-'));after(()=>rmSync(root,{recursive:true,force:true}));
const files=['scripts/goriq-source-private-acl-repair.ps1','scripts/goriq-zbook-bridge-capture.cs','scripts/goriq-source-private-acl-repair.cs'];
const sha='a'.repeat(40),quote=s=>"'"+s.replaceAll("'","''")+"'",object=v=>`(ConvertFrom-Json -InputObject ${quote(JSON.stringify(v))})`;
const context={GITHUB_REPOSITORY:'haji84/AI-',GITHUB_ACTOR:'haji84',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',RUNNER_NAME:'ZBook',RUNNER_OS:'Windows',OS:'Windows_NT',GITHUB_SHA:sha,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1',GORIQ_SOURCE_REPAIR_PHASE:'plan'};
const scenarios=['valid-plan','valid-apply','clock-old-expiry','clock-before-expiry','clock-at-expiry','clock-after-expiry','clock-before-notbefore','actor','ref','event','phase','main','ci-incomplete','ci-wrong-head','runner-id','runner-name','source-0','source-1','source-2','source-path','source-encoding','native-extra','native-private','native-plan-write','native-apply-plan'];
let execute;
test('approved Source repair has one owner/main-only plan/apply job',()=>{
 const expression=job.match(/^ {4}if: (.*)$/m)[1];
 for(const phase of ['plan','apply','unsafe']){
  const values={github:{repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84',event_name:'workflow_dispatch'},inputs:{phase}};
  assert.equal(runInNewContext(expression,values),phase!=='unsafe');
  values.github.actor='other';assert.equal(runInNewContext(expression,values),false);
 }
});
function prepare(){
 const raw=job.split('      - name: Read the fixed candidate after verified repair')[0];
 const body=raw.match(/ {8}run: \|\n([\s\S]*)$/)[1].split('\n').map(x=>x.replace(/^ {10}/,'')).join('\n').replace('[Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT','$false').replace('[datetimeoffset]::UtcNow',"[datetimeoffset]::Parse('2026-11-18T15:00:00Z')").replace('Invoke-GoriqSourcePrivateAclRepair -CaptureSource','Invoke-SourceRepairFixture -CaptureSource');
 const manifest=[];
 const clocks={'clock-old-expiry':'2026-11-18T16:58:55.2553670Z','clock-before-expiry':'2026-11-20T05:59:59.9999999Z','clock-at-expiry':'2026-11-20T06:00:00.0000000Z','clock-after-expiry':'2026-11-20T06:00:00.0000001Z','clock-before-notbefore':'2026-11-18T14:33:59.9999999Z'};
 for(const [i,scenario]of scenarios.entries()){
  const clockBody=body.replace("'2026-11-18T15:00:00Z'",quote(clocks[scenario]??'2026-11-18T15:00:00Z'));
  const ci=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map(name=>({name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
  if(scenario==='ci-incomplete')ci.pop();if(scenario==='ci-wrong-head')ci[0].head_sha='b'.repeat(40);
  const current={name:'source_private_acl',run_id:42,head_sha:sha,status:'in_progress',runner_id:scenario==='runner-id'?22:21,runner_name:scenario==='runner-name'?'Other':'ZBook'};
  const responses=[{object:{sha:scenario==='main'?'b'.repeat(40):sha}},{workflow_runs:[{id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success'}]},{total_count:ci.length,jobs:ci},{total_count:1,jobs:[current]},...files.map((f,n)=>{const bytes=readFileSync(f);return {path:scenario==='source-path'?'PRIVATE':f,type:'file',encoding:scenario==='source-encoding'?'utf8':'base64',size:bytes.length,content:scenario==='source-'+n?'UFJJVkFURQ==':bytes.toString('base64')};})];
  const paths=['git/ref/heads/main',`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,'actions/runs/71/jobs?filter=latest&per_page=100','actions/runs/42/jobs?filter=latest&per_page=100',...files.map(f=>`contents/${f}?ref=${sha}`)];
  const program=`$global:repairGateHttp=0;$global:repairGateOutputs=@();$global:repairGateResponses=$null
function Invoke-RestMethod { [CmdletBinding()] param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection)
 if($Method -cne 'Get' -or $TimeoutSec -ne 10 -or $MaximumRedirection -ne 0 -or $Headers.Count -ne 2){throw 'PRIVATE_HTTP'}
 $paths=@(${paths.map(p=>quote('https://api.github.com/repos/haji84/AI-/'+p)).join(',')});if($Uri -cne $paths[$global:repairGateHttp]){throw 'PRIVATE_URI'}
 if($null -eq $global:repairGateResponses){$global:repairGateResponses=@(${responses.map(object).join(',')})};$r=$global:repairGateResponses[$global:repairGateHttp];$global:repairGateHttp++;return $r
}
function Add-Content {param($LiteralPath,$Value,$Encoding);$global:repairGateOutputs+=,$Value}
function Invoke-SourceRepairFixture {param([string]$CaptureSource,[string]$RepairSource,[bool]$Apply)
 $r=[ordered]@{status=$(if($Apply){'APPLIED'}else{'PLANNED'});reason=$(if($Apply){'VERIFIED_SAMPLE'}else{'METADATA_ONLY'});plannedObjects=2;changedObjects=$(if($Apply){2}else{0});restoredObjects=0;scopeSha256='477f156730cab88b3a27588ef4bee6af52dcb88a2594d7978c4b57aa935b5599';planSha256=('b'*64);implementationSha256=$env:GORIQ_SOURCE_ACL_IMPLEMENTATION_SHA256;backupId=$(if($Apply){'1219-source-acl-42-1'}else{''});consistency='LIVE_SAMPLED';manualRecovery=$false;globalRestoreComplete=$false;originalDataPreservationVerified=$false}
 ${scenario==='native-extra'?"Write-Output 'PRIVATE'":''}
 ${scenario==='native-private'?"$r.private='PRIVATE'":''}
 ${scenario==='native-plan-write'?"$r.status='APPLIED';$r.reason='VERIFIED_SAMPLE';$r.changedObjects=2;$r.backupId='1219-source-acl-42-1'":''}
 ${scenario==='native-apply-plan'?"$r.status='PLANNED';$r.reason='METADATA_ONLY';$r.changedObjects=0;$r.backupId=''":''}
 return ($r|ConvertTo-Json -Compress)
}
`;
  const env={...context};if(['valid-apply','native-apply-plan'].includes(scenario))env.GORIQ_SOURCE_REPAIR_PHASE='apply';
  for(const[k,s]of [['GITHUB_ACTOR','actor'],['GITHUB_REF','ref'],['GITHUB_EVENT_NAME','event'],['GORIQ_SOURCE_REPAIR_PHASE','phase']])if(scenario===s)env[k]='untrusted';
  const file=join(root,`${i}.ps1`);writeFileSync(file,program+clockBody);manifest.push({scenario,file,env});
 }
 const path=join(root,'manifest.json');writeFileSync(path,JSON.stringify(manifest));for(const row of manifest)writeFileSync(path+'.'+row.scenario+'.json',JSON.stringify(row));
 const wrapper=join(root,'wrapper.ps1');writeFileSync(wrapper,`param([string]$Scenario,[string]$Manifest)
$initial=[Environment]::GetEnvironmentVariables();$case=Get-Content -LiteralPath ($Manifest+'.'+$Scenario+'.json') -Raw|ConvertFrom-Json
foreach($p in $case.env.PSObject.Properties){[Environment]::SetEnvironmentVariable($p.Name,[string]$p.Value)}
$output=@(& $case.file);$status=0;if($null -ne $LASTEXITCODE){$status=$LASTEXITCODE};$LASTEXITCODE=0
foreach($key in @([Environment]::GetEnvironmentVariables().Keys)){if(-not $initial.Contains($key)){[Environment]::SetEnvironmentVariable([string]$key,[NullString]::Value)}}
foreach($key in $initial.Keys){[Environment]::SetEnvironmentVariable([string]$key,[string]$initial[$key])}
[ordered]@{output=@($output);status=$status;http=$global:repairGateHttp;flags=@($global:repairGateOutputs)}|ConvertTo-Json -Depth 6 -Compress
`);
 execute=createPowerShellFixtureBatch({shell:'pwsh',fixture:wrapper,scenarios,parameters:{Manifest:path},timeoutMs:15000});
}
for(const scenario of scenarios)test('fixed Source repair workflow gate '+scenario,()=>{
 if(!execute)prepare();const record=execute(scenario);assert.equal(record.status,0,record.stderr);assert.equal(record.stderr,'');assert.doesNotMatch(record.stdout,/PRIVATE(?!_ACL)/);const r=JSON.parse(record.stdout);
 if(['valid-plan','valid-apply','clock-old-expiry','clock-before-expiry'].includes(scenario)){
  assert.equal(r.status,0);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_SOURCE_PRIVATE_ACL_REPAIR /);const value=JSON.parse(r.output[0].split('GORIQ_SOURCE_PRIVATE_ACL_REPAIR ')[1]);assert.equal(value.status,scenario==='valid-apply'?'APPLIED':'PLANNED');assert.equal(value.originalDataPreservationVerified,false);assert.deepEqual(r.flags,[scenario==='valid-apply'?'read=true':'read=false']);
 }else{assert.equal(r.status,1);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_SOURCE_PRIVATE_ACL_REFUSED [A-Z_]+$/);assert.equal(r.flags.length,0);if(scenario.startsWith('clock-'))assert.equal(r.http,0);}
});
