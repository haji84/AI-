import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createPowerShellFixtureBatch } from './helpers/powershell-fixture-batch.mjs';
const workflowPath='.github/workflows/goriq-jarvis-registration-read-1219.yml';
const workflow=existsSync(workflowPath)?readFileSync(workflowPath,'utf8'):'';
const job=workflow.split('\n  jarvis_registrations:')[1];
const root=mkdtempSync(join(tmpdir(),'source-repair-gates-'));after(()=>rmSync(root,{recursive:true,force:true}));
const files=['scripts/goriq-zbook-bridge-original-read.ps1','scripts/goriq-jarvis-registration-read.ps1','scripts/goriq-jarvis-registration-read.mjs','scripts/goriq-g1-backup-inventory.mjs','scripts/goriq-zbook-bridge-capture.cs'];
const sha='a'.repeat(40),quote=s=>"'"+s.replaceAll("'","''")+"'",object=v=>`(ConvertFrom-Json -InputObject ${quote(JSON.stringify(v))})`;
const context={GITHUB_REPOSITORY:'haji84/AI-',GITHUB_ACTOR:'haji84',GITHUB_TRIGGERING_ACTOR:'haji84',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',RUNNER_NAME:'ZBook',RUNNER_OS:'Windows',OS:'Windows_NT',GITHUB_SHA:sha,GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_NUMBER:'1',GORIQ_ZBOOK_BRIDGE_ORIGINAL_ONLY:'true',GORIQ_ZBOOK_NATIVE_ONLY:'false',GORIQ_ZBOOK_RUNNER_ONLY:'false',GORIQ_ZBOOK_OWNER_PROBE_ONLY:'false'};
const scenarios=['valid','clock-before-expiry','clock-at-expiry','clock-after-expiry','clock-before-notbefore','actor','ref','event','trigger-actor','attempt-two','attempt-zero','run-number-two','run-number-zero','main','ci-incomplete','ci-wrong-head','main-moved-during-bootstrap','newer-ci-incomplete','newer-ci-failed','ci-moved-during-bootstrap','ci-replaced-during-bootstrap','ci-attempt-moved','runner-id','runner-name','source-0','source-1','source-2','source-3','source-4','source-path','source-encoding','native-extra','native-private','native-count','native-true','native-duplicate'];
let execute;
test('JARVIS registration metadata is manual owner/main only',()=>{
 assert.ok(workflow,'missing read-only registration workflow');
 const expression=job.match(/^ {4}if: (.*)$/m)[1];
 const values={github:{repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84',triggering_actor:'haji84',run_attempt:1,run_number:1,event_name:'workflow_dispatch'}};
 assert.equal(runInNewContext(expression,values),true);
 for(const key of ['actor','repository','ref','event_name','triggering_actor']){const bad={github:{...values.github}};bad.github[key]='other';assert.equal(runInNewContext(expression,bad),false);}
 for(const attempt of [0,2]){const bad={github:{...values.github,run_attempt:attempt}};assert.equal(runInNewContext(expression,bad),false);}
 for(const number of [0,2]){const bad={github:{...values.github,run_number:number}};assert.equal(runInNewContext(expression,bad),false);}
});
function prepare(){
 assert.ok(workflow,'missing read-only registration workflow');
 const body=job.match(/ {8}run: \|\n([\s\S]*)$/)[1].split('\n').map(x=>x.replace(/^ {10}/,'')).join('\n').replace('[Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT','$false').replace('[datetimeoffset]::UtcNow',"[datetimeoffset]::Parse('2026-11-20T04:00:00Z')").replace('Invoke-GoriqJarvisRegistrationRead','Invoke-JarvisRegistrationFixture');
 const manifest=[];
 const clocks={'clock-before-expiry':'2026-11-20T05:59:59.9999999Z','clock-at-expiry':'2026-11-20T06:00:00.0000000Z','clock-after-expiry':'2026-11-20T06:00:00.0000001Z','clock-before-notbefore':'2026-11-20T02:59:59.9999999Z'};
 for(const [i,scenario]of scenarios.entries()){
  const clockBody=body.replace("'2026-11-20T04:00:00Z'",quote(clocks[scenario]??'2026-11-20T04:00:00Z'));
  const ci=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].map(name=>({name,run_id:71,head_sha:sha,status:'completed',conclusion:'success'}));
  if(scenario==='ci-incomplete')ci.pop();if(scenario==='ci-wrong-head')ci[0].head_sha='b'.repeat(40);
  const current={name:'jarvis_registrations',run_id:42,head_sha:sha,status:'in_progress',runner_id:scenario==='runner-id'?22:21,runner_name:scenario==='runner-name'?'Other':'ZBook'};
  const successful={id:71,name:'CI',path:'.github/workflows/ci.yml',event:'push',head_branch:'main',head_sha:sha,status:'completed',conclusion:'success',run_attempt:1};
  const initialRuns=scenario==='newer-ci-incomplete'?[{...successful,id:72,status:'in_progress',conclusion:null},successful]:scenario==='newer-ci-failed'?[{...successful,id:72,conclusion:'failure'},successful]:[successful];
  const finalRun={...successful};
  if(scenario==='ci-moved-during-bootstrap'){finalRun.status='in_progress';finalRun.conclusion=null;finalRun.run_attempt=2;}
  if(scenario==='ci-replaced-during-bootstrap')finalRun.id=72;
  if(scenario==='ci-attempt-moved')finalRun.run_attempt=2;
  const finalJobs=ci.map(job=>({...job,run_id:finalRun.id}));
  const responses=[{object:{sha:scenario==='main'?'b'.repeat(40):sha}},{workflow_runs:initialRuns},{total_count:ci.length,jobs:ci},{total_count:1,jobs:[current]},...files.map((f,n)=>{const bytes=readFileSync(f);return {path:scenario==='source-path'?'PRIVATE':f,type:'file',encoding:scenario==='source-encoding'?'utf8':'base64',size:bytes.length,content:scenario==='source-'+n?'UFJJVkFURQ==':bytes.toString('base64')};}),{workflow_runs:[finalRun]},{total_count:finalJobs.length,jobs:finalJobs},{object:{sha:scenario==='main-moved-during-bootstrap'?'b'.repeat(40):sha}}];
  const paths=['git/ref/heads/main',`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,'actions/runs/71/jobs?filter=latest&per_page=100','actions/runs/42/jobs?filter=latest&per_page=100',...files.map(f=>`contents/${f}?ref=${sha}`),`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,`actions/runs/${finalRun.id}/jobs?filter=latest&per_page=100`,'git/ref/heads/main'];
  const program=`$global:repairGateHttp=0;$global:repairGateOutputs=@();$global:repairGateResponses=$null
function Invoke-RestMethod { [CmdletBinding()] param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection)
 if($Method -cne 'Get' -or $TimeoutSec -ne 10 -or $MaximumRedirection -ne 0 -or $Headers.Count -ne 2){throw 'PRIVATE_HTTP'}
 $paths=@(${paths.map(p=>quote('https://api.github.com/repos/haji84/AI-/'+p)).join(',')});if($Uri -cne $paths[$global:repairGateHttp]){throw 'PRIVATE_URI'}
 if($null -eq $global:repairGateResponses){$global:repairGateResponses=@(${responses.map(object).join(',')})};$r=$global:repairGateResponses[$global:repairGateHttp];$global:repairGateHttp++;return $r
}
function Add-Content {param($LiteralPath,$Value,$Encoding);$global:repairGateOutputs+=,$Value}
function Invoke-JarvisRegistrationFixture {
 param([byte[]]$QuerySource,[byte[]]$InventorySource,[string]$NativeSource)
 if([Convert]::ToBase64String($QuerySource) -cne ${quote(readFileSync(files[2]).toString('base64'))} -or [Convert]::ToBase64String($InventorySource) -cne ${quote(readFileSync(files[3]).toString('base64'))} -or [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${quote(readFileSync(files[4]).toString('base64'))})) -cne $NativeSource){throw 'PRIVATE_ARGUMENTS'}
 $r=[ordered]@{version=1;mode='FIXED_JARVIS_REGISTRATION_METADATA';status='READ';failureCode='NONE';readOnly=$true;preserved=$true;preservationMode='OBSERVED_STABLE_SHARED';queryVerified=$true;currentGoalPresent=$true;currentGoalId='goal-0af48e9d681db91a';currentGoalMentionsJarvis=$true;ownerRequirementCount=3;ownerRequirementsForOriginalGoal=1;ownerRequirementsMentioningJarvis=2;ownerRequirementsWithoutGoal=1;workRunCount=2;workRunsForOriginalGoal=1;detailsOmitted=$true;authorityComplete=$false;originalGoalRecovered=$false;g1='HOLD'}
 ${scenario==='native-extra'?"Write-Output 'PRIVATE'":''}
 ${scenario==='native-private'?"$r.private='PRIVATE'":''}
 ${scenario==='native-count'?"$r.ownerRequirementCount=0":''}
 ${scenario==='native-true'?"$r.readOnly=$false":''}
 $json=$r|ConvertTo-Json -Depth 5 -Compress
 ${scenario==='native-duplicate'?`$json=$json.Replace('"version":1','"version":1,"version":1')`:''}
 return $json
}
`;
  const env={...context};
  if(scenario==='trigger-actor')env.GITHUB_TRIGGERING_ACTOR='other';if(scenario==='attempt-two')env.GITHUB_RUN_ATTEMPT='2';if(scenario==='attempt-zero')env.GITHUB_RUN_ATTEMPT='0';
  if(scenario==='run-number-two')env.GITHUB_RUN_NUMBER='2';if(scenario==='run-number-zero')env.GITHUB_RUN_NUMBER='0';
  for(const[k,s]of [['GITHUB_ACTOR','actor'],['GITHUB_REF','ref'],['GITHUB_EVENT_NAME','event']])if(scenario===s)env[k]='untrusted';
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
for(const scenario of scenarios)test('fixed JARVIS registration workflow gate '+scenario,()=>{
 if(!execute)prepare();const record=execute(scenario);assert.equal(record.status,0,record.stderr);assert.equal(record.stderr,'');assert.doesNotMatch(record.stdout,/PRIVATE/);const r=JSON.parse(record.stdout);
 if(['valid','clock-before-expiry'].includes(scenario)){
  assert.equal(r.status,0);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_JARVIS_REGISTRATION_METADATA /);const value=JSON.parse(r.output[0].split('GORIQ_JARVIS_REGISTRATION_METADATA ')[1]);assert.equal(value.status,'READ');assert.equal(value.readOnly,true);assert.equal(value.preserved,true);assert.equal(value.ownerRequirementCount,3);assert.equal(value.currentGoalMentionsJarvis,true);assert.equal(r.http,12);assert.deepEqual(r.flags,[]);
 }else{assert.equal(r.status,1);assert.equal(r.output.length,1);assert.match(r.output[0],/^GORIQ_JARVIS_REGISTRATION_REFUSED [A-Z_]+$/);assert.equal(r.flags.length,0);if(scenario.startsWith('clock-')||scenario.startsWith('run-number-'))assert.equal(r.http,0);}
});
