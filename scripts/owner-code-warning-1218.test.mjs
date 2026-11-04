import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const entry=resolve('scripts/owner-code-warning-1218.mjs'),worker=resolve('scripts/owner-code-warning-1218.ps1');
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const sourceFiles=['scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1'];
const now=Date.parse('2026-11-04T11:00:00.000Z');
const context={GITHUB_ACTOR:'haji84',GITHUB_REPOSITORY:'haji84/AI-',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345678',GITHUB_RUN_ATTEMPT:'1'};
function scope(){return {schemaVersion:1,scopeId:'issue:1218:owner-warning-only',authorityType:'TASK_SCOPED_ORDINARY_COMPLETION_DELEGATION',issuedBy:'task-delegated-operator',issue:1218,goalId:'goal-fcc81c97e09153f7',operation:'warning-render-and-cancel-only',ownerSid:'S-1-5-21-1-2-3-1004',sourceRevision:context.GITHUB_SHA,sourceHashes:Object.fromEntries(sourceFiles.map(name=>[name,'b'.repeat(64)])),workflowRunId:context.GITHUB_RUN_ID,workflowRunAttempt:1,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),maxAttempts:1,maxDurationSeconds:30,allowedUiAction:'OwnerRotationCancel',controlled:false};}
async function api(){return existsSync(entry)?import(pathToFileURL(entry).href):{};}
const evidenceBools=['sourceHashesVerified','actualWindowsOwnerContextVerified','originalFormShown','originalWarningVisible','warningBeforeAnyConfirmation','originalCancelControlObserved','defaultCancelObserved','cancelInvoked','cancelledWithoutConfirmation','formDisposed','deadlineRespected','childCleanupVerified'];
function success(){return {schemaVersion:1,issue:1218,operation:'warning-render-and-cancel-only',complete:true,failureCode:null,runtimeScopeSha256:'c'.repeat(64),sourceRevision:context.GITHUB_SHA,...Object.fromEntries(evidenceBools.map(key=>[key,true])),confirmEventObserved:false};}

test('warning Node entry defaults to inert PLAN ONLY without reading a scope',()=>{
 const run=spawnSync(process.execPath,[entry],{encoding:'utf8',timeout:10000,env:{...process.env,GORIQ_OWNER_WARNING_SCOPE_BASE64:'PRIVATE_SCOPE_MUST_NOT_ESCAPE'}});
 assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/^PLAN ONLY:/);assert.equal(run.stderr,'');assert.doesNotMatch(run.stdout,/PRIVATE_SCOPE/);
});
test('warning PowerShell entry defaults to inert PLAN ONLY without a Windows identity',()=>{
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File',worker],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/^PLAN ONLY:/);assert.equal(run.stderr,'');
});
test('ordinary warning scope binds a selector only to trusted current run and attempt one',async()=>{
 const a=await api();assert.equal(typeof a.bindWarningScope,'function');const descriptor={...scope(),workflowRunId:'BIND_CURRENT_GITHUB_RUN'};const bound=a.bindWarningScope(descriptor,context,now);assert.equal(bound.workflowRunId,context.GITHUB_RUN_ID);assert.equal(descriptor.workflowRunId,'BIND_CURRENT_GITHUB_RUN');
 for(const change of [{GITHUB_ACTOR:'other'},{GITHUB_REF:'refs/heads/other'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_SHA:'d'.repeat(40)}])assert.throws(()=>a.bindWarningScope(descriptor,{...context,...change},now));
});
test('warning scope rejects privileged flags, stale/replayed/overlong authority and unknown fields',async()=>{
 const a=await api();assert.equal(typeof a.validateWarningScope,'function');assert.equal(a.validateWarningScope(scope(),context,now).allowedUiAction,'OwnerRotationCancel');
 for(const mutate of [s=>s.credentialRotationApproval=true,s=>s.controlled=true,s=>s.allowedUiAction='OwnerRotationConfirm',s=>s.issuedBy='owner',s=>s.workflowRunAttempt=2,s=>s.maxAttempts=2,s=>s.maxDurationSeconds=31,s=>s.workflowRunId='BIND_CURRENT_GITHUB_RUN',s=>s.expiresAt=new Date(now).toISOString(),s=>s.issuedAt=new Date(now+1).toISOString(),s=>s.expiresAt=new Date(now+901000).toISOString(),s=>s.sourceHashes.extra='b'.repeat(64),s=>delete s.sourceHashes[sourceFiles[0]],s=>s.ownerSid='S-1-5-18']){const value=scope();mutate(value);assert.throws(()=>a.validateWarningScope(value,context,now));}
 const outer=scope();outer.issuedAt='2026-11-10T07:59:00.000Z';outer.expiresAt='2026-11-10T08:01:00.000Z';assert.throws(()=>a.validateWarningScope(outer,context,Date.parse('2026-11-10T07:59:10.000Z')));
});
test('scope serialization has a fixed reconstruction order independent of descriptor key order',async()=>{
 const a=await api();assert.equal(typeof a.serializeWarningScope,'function');const value=scope(),reversed=Object.fromEntries(Object.entries(value).reverse());reversed.sourceHashes=Object.fromEntries(Object.entries(value.sourceHashes).reverse());assert.equal(a.serializeWarningScope(value),a.serializeWarningScope(reversed));assert.deepEqual(JSON.parse(a.serializeWarningScope(value)),value);
});
test('complete warning evidence requires real cancellation, no confirmation and cleanup',async()=>{
 const a=await api();assert.equal(typeof a.validateWarningResult,'function');assert.deepEqual(a.validateWarningResult(success()),success());
 for(const mutate of [r=>r.originalWarningVisible=false,r=>r.defaultCancelObserved=false,r=>r.cancelInvoked=false,r=>r.formDisposed=false,r=>r.childCleanupVerified=false,r=>r.confirmEventObserved=true,r=>r.secret='PRIVATE_VALUE',r=>r.runtimeScopeSha256='bad']){const r=success();mutate(r);assert.throws(()=>a.validateWarningResult(r));}
});
test('bounded child accepts only matching closed evidence and measured child exit',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedWarningChild,'function');const workerResult={...success(),childCleanupVerified:false};
 const result=await a.runBoundedWarningChild(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(workerResult))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000,runtimeScopeSha256:'c'.repeat(64),sourceRevision:context.GITHUB_SHA});assert.equal(result.complete,true);assert.equal(result.childCleanupVerified,true);
});
test('timeout terminates the owned public fixture child and never invents a warning pass',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedWarningChild,'function');let child;
 const result=await a.runBoundedWarningChild(()=>child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']}),{durationMs:300,runtimeScopeSha256:'c'.repeat(64),sourceRevision:context.GITHUB_SHA});assert.equal(result.complete,false);assert.equal(result.failureCode,'WARNING_TIMEOUT');assert.equal(child.killed,true);assert.equal(result.childCleanupVerified,true);
});
test('child stderr, excess output and mismatched scope evidence fail closed without raw output',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedWarningChild,'function');
 for(const code of ["process.stderr.write('PRIVATE_ERROR');setInterval(()=>{},1000)","process.stdout.write('PRIVATE_OUTPUT'.repeat(2000));setInterval(()=>{},1000)",`console.log(${JSON.stringify(JSON.stringify({...success(),runtimeScopeSha256:'d'.repeat(64),childCleanupVerified:false}))})`]){const result=await a.runBoundedWarningChild(()=>spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe']}),{durationMs:3000,runtimeScopeSha256:'c'.repeat(64),sourceRevision:context.GITHUB_SHA});assert.equal(result.complete,false);assert.equal(result.failureCode,'WARNING_PROTOCOL_FAILED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR|PRIVATE_OUTPUT/);}
});
test('invalid warning execution returns closed failure without reading any Owner state',()=>{
 for(const [binary,args] of [[process.execPath,[entry,'--run']],[shell,['-NoProfile','-NonInteractive','-File',worker,'-Run']]]){const run=spawnSync(binary,args,{encoding:'utf8',timeout:10000,env:{...process.env,GORIQ_OWNER_WARNING_SCOPE_BASE64:'PRIVATE_INVALID_SCOPE'}});assert.equal(run.status,1);assert.equal(run.stderr,'');const result=JSON.parse(run.stdout);assert.equal(result.complete,false);assert.match(result.failureCode,/^WARNING_/);assert.doesNotMatch(run.stdout,/PRIVATE_INVALID_SCOPE|ownerSid|config\.dpapi/);}
});
test('PowerShell strict scope validator rejects an unbound selector without opening UI',()=>{
 const value={...scope(),workflowRunId:'BIND_CURRENT_GITHUB_RUN'};const q=value=>"'"+value.replaceAll("'","''")+"'";
 const code=`$ErrorActionPreference='Stop'; . ${q(worker)};if(Test-Path Function:Assert-OwnerWarningScope){try{Assert-OwnerWarningScope -Scope (${q(JSON.stringify(value))}|ConvertFrom-Json) -Environment (${q(JSON.stringify(context))}|ConvertFrom-Json) -Now ([datetimeoffset]::Parse('2026-11-04T11:00:00.000Z'));'false'}catch{'true'}}else{'false'}`;
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout.trim()),true);
});
test('exclusive workflow mode guard rejects both modes without running surrounding native steps',()=>{
 const text=readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8'),match=text.match(/run: \|\r?\n((?: {10}.*\r?\n)+)/);assert.ok(match,'Exclusive warning/practical mode guard required');
 const code=match[1].split(/\r?\n/).map(line=>line.slice(10)).join('\n');
 for(const [warning,practical,exit] of [['true','true',1],['true','false',0],['false','true',0],['false','false',0]]){const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:10000,env:{...process.env,GORIQ_WARNING_ONLY:warning,GORIQ_LOCAL_PRACTICAL:practical}});assert.equal(run.status,exit,run.stderr);if(exit)assert.match(run.stderr,/OWNER_ACCEPTANCE_MODES_EXCLUSIVE/);}
});
test('UI child environment preserves actual Windows runtime while excluding unrelated credentials',async()=>{
 const a=await api();assert.equal(typeof a.buildWarningChildEnvironment,'function');
 const env=a.buildWarningChildEnvironment({SystemRoot:'PUBLIC_EXISTING_WINDOWS',Path:'PUBLIC_PATH',GITHUB_ACTOR:'haji84',GH_TOKEN:'PRIVATE_TOKEN',GITHUB_TOKEN:'PRIVATE_GITHUB_TOKEN',JARVIS_OWNER_SECRET:'PRIVATE_OWNER',GORIQ_OTHER_SCOPE:'PRIVATE_OTHER'},'PUBLIC_BOUND_SCOPE','PUBLIC_DEADLINE');
 assert.equal(env.SystemRoot,'PUBLIC_EXISTING_WINDOWS');assert.equal(env.Path,'PUBLIC_PATH');assert.equal(env.GITHUB_ACTOR,'haji84');assert.equal(env.GORIQ_OWNER_WARNING_SCOPE_BASE64,'PUBLIC_BOUND_SCOPE');assert.equal(env.GORIQ_OWNER_WARNING_DEADLINE_UTC,'PUBLIC_DEADLINE');assert.doesNotMatch(JSON.stringify(env),/PRIVATE_|GH_TOKEN|GITHUB_TOKEN|JARVIS_OWNER_SECRET|GORIQ_OTHER/);
});
test('scope string and scalar types cannot be bypassed with coercible arrays or booleans',async()=>{
 const a=await api();assert.equal(typeof a.validateWarningScope,'function');
 for(const mutate of [s=>s.ownerSid=[s.ownerSid],s=>s.issuedAt=[s.issuedAt],s=>s.expiresAt=[s.expiresAt]]){const s=scope();mutate(s);assert.throws(()=>a.validateWarningScope(s,context,now));}
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const values=[scope()];for(const mutate of [s=>s.schemaVersion=true,s=>s.issue='1218',s=>s.workflowRunAttempt='1',s=>s.maxAttempts='1',s=>s.maxDurationSeconds='30',s=>s.ownerSid=[s.ownerSid],s=>s.workflowRunId=12345678,s=>s.sourceRevision=[s.sourceRevision],s=>s.sourceHashes[sourceFiles[0]]=[s.sourceHashes[sourceFiles[0]]],s=>s.credentialRotationApproval=true,s=>s.workflowRunId='BIND_CURRENT_GITHUB_RUN']){const s=scope();mutate(s);values.push(s);}
 // PS7.5 auto-parses JSON date strings; retain their wire types as PS5.1 does.
 const code=`$ErrorActionPreference='Stop'; . ${q(worker)};$fixtures=${q(JSON.stringify(values))}|ConvertFrom-Json;@($fixtures|ForEach-Object{$_.issuedAt=${q(scope().issuedAt)};$_.expiresAt=${q(scope().expiresAt)};try{Assert-OwnerWarningScope -Scope $_ -Environment (${q(JSON.stringify(context))}|ConvertFrom-Json) -Now ([datetimeoffset]::Parse('2026-11-04T11:00:00.000Z'));$true}catch{$false}})|ConvertTo-Json -Compress`;
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout.trim()),[true,...Array(11).fill(false)]);
});
test('parent deadline expiry never leaves complete true after receiving valid worker evidence',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedWarningChild,'function');let clockReads=0;
 const r=await a.runBoundedWarningChild(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify({...success(),childCleanupVerified:false}))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000,runtimeScopeSha256:'c'.repeat(64),sourceRevision:context.GITHUB_SHA,clock:()=>clockReads++===0?0:4000});
 assert.equal(r.complete,false);assert.equal(r.failureCode,'WARNING_TIMEOUT');assert.equal(r.deadlineRespected,false);assert.equal(r.childCleanupVerified,true);
});
test('hosted Windows public worker shows/cancels only while task delegation is valid and fails closed after expiry',{skip:process.platform!=='win32'},async()=>{
 const a=await api();assert.equal(typeof a.serializeWarningScope,'function');const marker=resolve('.gai-results/owner-warning-1218.attempt');assert.equal(existsSync(marker),false,'Public checkout attempt marker must be fresh');
 const sidRun=spawnSync(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',timeout:10000});assert.equal(sidRun.status,0,'Public Windows identity unavailable');assert.equal(/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(sidRun.stdout.trim()),true,'Public Windows user identity required');
 const current=Date.now(),outer=Date.parse('2026-11-10T08:00:00.000Z'),active=current+30000<=outer,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(/^[a-f0-9]{40}$/.test(revision),true);
 const s={...scope(),ownerSid:sidRun.stdout.trim(),sourceRevision:revision,sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),workflowRunId:process.env.GITHUB_RUN_ID??String(current),issuedAt:new Date(current-1000).toISOString(),expiresAt:new Date(Math.min(current+600000,outer)).toISOString()};
 const serialized=a.serializeWarningScope(s),scopeHash=createHash('sha256').update(serialized).digest('hex');
 try{
  const run=spawnSync(process.execPath,[entry,'--run'],{encoding:'utf8',timeout:35000,cwd:resolve('.'),env:{...process.env,...context,GITHUB_SHA:revision,GITHUB_RUN_ID:s.workflowRunId,GORIQ_OWNER_WARNING_SCOPE_BASE64:Buffer.from(serialized).toString('base64')}});
  assert.equal(run.error,undefined,'Public warning child exceeded its bounded wrapper');assert.equal(run.stderr,'');const r=JSON.parse(run.stdout);a.validateWarningResult(r);
  if(active){assert.equal(run.status,0,JSON.stringify(r));assert.equal(r.complete,true,JSON.stringify(r));assert.equal(r.runtimeScopeSha256,scopeHash);assert.equal(r.confirmEventObserved,false);assert.equal(r.defaultCancelObserved,true);assert.equal(r.formDisposed,true);assert.equal(r.childCleanupVerified,true);}
  else{console.log('PUBLIC_WARNING_FIXTURE_EXPECTS_EXPIRED_SCOPE');assert.equal(run.status,1);assert.equal(r.failureCode,'WARNING_SCOPE_REQUIRED');assert.equal(r.originalFormShown,false);assert.equal(r.cancelInvoked,false);assert.equal(existsSync(marker),false);}
 }finally{if(existsSync(marker)){const retained=JSON.parse(readFileSync(marker,'utf8'));assert.equal(retained.runtimeScopeSha256,scopeHash,'Never remove another attempt marker');rmSync(marker);}}
});
test('one ordinary warning attempt is reserved only once in its public checkout result directory',async()=>{
 const a=await api();assert.equal(typeof a.reserveWarningAttempt,'function');const directory=mkdtempSync(join(tmpdir(),'warning-attempt-public-'));
 try{a.reserveWarningAttempt(directory,'c'.repeat(64),context.GITHUB_SHA,context.GITHUB_RUN_ID);const marker=JSON.parse(readFileSync(join(directory,'.gai-results','owner-warning-1218.attempt'),'utf8'));assert.equal(marker.stage,'reserved');assert.equal(marker.runtimeScopeSha256,'c'.repeat(64));assert.throws(()=>a.reserveWarningAttempt(directory,'c'.repeat(64),context.GITHUB_SHA,context.GITHUB_RUN_ID),{message:'WARNING_ATTEMPT_CONSUMED'});assert.equal(JSON.parse(readFileSync(join(directory,'.gai-results','owner-warning-1218.attempt'),'utf8')).stage,'reserved');}finally{rmSync(directory,{recursive:true,force:true});}
});
