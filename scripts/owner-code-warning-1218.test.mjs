import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync,mkdtempSync,rmSync,realpathSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
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
 }finally{if(existsSync(marker)){const retained=JSON.parse(readFileSync(marker,'utf8'));assert.equal(retained.runtimeScopeSha256,scopeHash,'Never remove another attempt marker');assert.equal(['reserved','consumed'].includes(retained.stage),true);console.log('PUBLIC_WARNING_ATTEMPT_STAGE '+JSON.stringify({schemaVersion:1,stage:retained.stage,runtimeScopeMatched:true}));rmSync(marker);}}
});
test('one ordinary warning attempt is reserved only once in its public checkout result directory',async()=>{
 const a=await api();assert.equal(typeof a.reserveWarningAttempt,'function');const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'warning-attempt-public-')));
 try{a.reserveWarningAttempt(directory,'c'.repeat(64),context.GITHUB_SHA,context.GITHUB_RUN_ID);const marker=JSON.parse(readFileSync(join(directory,'.gai-results','owner-warning-1218.attempt'),'utf8'));assert.equal(marker.stage,'reserved');assert.equal(marker.runtimeScopeSha256,'c'.repeat(64));assert.throws(()=>a.reserveWarningAttempt(directory,'c'.repeat(64),context.GITHUB_SHA,context.GITHUB_RUN_ID),{message:'WARNING_ATTEMPT_CONSUMED'});assert.equal(JSON.parse(readFileSync(join(directory,'.gai-results','owner-warning-1218.attempt'),'utf8')).stage,'reserved');}finally{rmSync(directory,{recursive:true,force:true});}
});
test('hosted public diagnostic records closed real-form thread facts without changing production files',{skip:process.platform!=='win32'},async()=>{
 const a=await api(),results=resolve('.gai-results');mkdirSync(results,{recursive:true});const directory=realpathSync.native(mkdtempSync(join(results,'public-warning-diagnostic-')));mkdirSync(join(directory,'scripts'));
 const productionHashes=Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
 try{
  for(const file of sourceFiles)copyFileSync(file,join(directory,file));
  const target=join(directory,'scripts/owner-code-warning-1218.ps1');let body=readFileSync(target,'utf8');
  const save=`$publicProbe.elapsedMilliseconds=[int]$publicWatch.ElapsedMilliseconds;if($publicProbe.history.Count -ge 64){$publicProbe.history=@($publicProbe.history[(-63)..(-1)])};$publicProbe.history+=@{stage=$publicProbe.stage;elapsedMilliseconds=$publicProbe.elapsedMilliseconds};[IO.File]::WriteAllText($publicProbePath,($publicProbe|ConvertTo-Json -Depth 5 -Compress));`;
  const stage=value=>`$publicProbe.stage='${value}';${save}`;
  const rotationText=readFileSync('scripts/rotate-jarvis-owner-code-windows.ps1','utf8');
  let guard=rotationText.slice(rotationText.indexOf('function Assert-OwnerRotationProtectedPath {'),rotationText.indexOf('function Get-OwnerRotationTaskHash('));
  const wrap=(statement,label)=>{assert.equal(guard.split(statement).length-1,1);guard=guard.replace(statement,()=>stage(label+'-before')+statement+';'+stage(label+'-after'));};
  wrap('$current=Get-OwnerRotationSafePath $Path','guard-safe-path');
  wrap('$acl=Get-Acl -LiteralPath $current -ErrorAction Stop','guard-get-acl');
  wrap(guard.split('\n').find(line=>line.trim().startsWith('if ($acl.GetOwner(')),'guard-owner');
  const originalRule=guard.split('\n').find(line=>line.trim().startsWith('if ($rule.AccessControlType'));
  assert.equal(typeof originalRule,'string');
  guard=guard.replace(originalRule,()=>`if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $write) -ne 0) {
   $publicReference=$rule.IdentityReference;$publicProbe.identityKind=if($publicReference -is [Security.Principal.NTAccount]){'NTAccount'}elseif($publicReference -is [Security.Principal.SecurityIdentifier]){'SID'}else{'Other'};
   ${stage('guard-translate-before')}$publicTranslated=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;${stage('guard-translate-after')}
   if($publicTranslated -notin $trusted){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
  }`);
  wrap('$current=[IO.Path]::GetDirectoryName($current);$depth++','guard-parent');
  const nativeControl=`$publicNative=@{schemaVersion=1;readable=$false;allSID=$false;count=0;policyVerdict=$false};try{
   $publicNativeRules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);$publicNative.readable=$true;$publicNative.count=$publicNativeRules.Count;$publicNative.allSID=$true;$publicNative.policyVerdict=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @($OwnerSid,'S-1-5-18','S-1-5-32-544');
   foreach($publicRule in $publicNativeRules){if($publicRule.IdentityReference -isnot [Security.Principal.SecurityIdentifier]){$publicNative.allSID=$false;$publicNative.policyVerdict=$false};if($publicRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($publicRule.FileSystemRights -band $write) -ne 0 -and $publicRule.IdentityReference.Value -notin $trusted){$publicNative.policyVerdict=$false}}
  }catch{$publicNative.readable=$false;$publicNative.allSID=$false;$publicNative.policyVerdict=$false};[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $publicProbePath) 'public-native-sid-control.json'),($publicNative|ConvertTo-Json -Compress));`;
  guard=guard.replace('foreach ($rule in $acl.Access) {',()=>nativeControl+stage('guard-access-before')+'foreach ($rule in $acl.Access) {'+stage('guard-access-entered'));
  guard=guard.replace('  }\n  if (($OwnerProfile',()=> '  }\n'+stage('guard-access-after')+'\n  if (($OwnerProfile');
  const start=`$publicWatch=[Diagnostics.Stopwatch]::StartNew();$publicProbePath=Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) '.gai-results') 'public-warning-probe.json';$publicProbe=@{schemaVersion=1;stage='entered';threadExceptionObserved=$false;exceptionType='None';missingClockCommand=$false;identityKind='Unobserved';elapsedMilliseconds=0;history=@()};${save}`;
  assert.equal(body.split('$encoded=$env:GORIQ_OWNER_WARNING_SCOPE_BASE64').length-1,1);body=body.replace('$encoded=$env:GORIQ_OWNER_WARNING_SCOPE_BASE64',()=>start+'$encoded=$env:GORIQ_OWNER_WARNING_SCOPE_BASE64');
  body=body.replace('$result.actualWindowsOwnerContextVerified=$true',()=>'$result.actualWindowsOwnerContextVerified=$true;'+stage('owner-verified'));
  const hashStage=position=>`$publicProbe.stage='hash-'+$publicHashRole+'-${position}';${save}`;
  body=body.replace('$path=Join-Path $root $file;',()=>"$publicHashRole=@{'scripts/owner-code-warning-1218.mjs'='node';'scripts/owner-code-warning-1218.ps1'='worker';'scripts/rotate-jarvis-owner-code-windows.ps1'='rotation'}[$file];"+hashStage('before')+'$path=Join-Path $root $file;');
  const hashStatement=body.split('\n').find(line=>line.includes('[IO.File]::ReadAllBytes($path)'));
  assert.equal(typeof hashStatement,'string');body=body.replace(hashStatement,()=>hashStatement+';'+hashStage('after'));
  body=body.replace("  # Import unchanged definitions only.",()=>stage('source-hashes-after')+'\n  # Import unchanged definitions only.');
  const importStatement=". (Join-Path $PSScriptRoot 'rotate-jarvis-owner-code-windows.ps1') -Apply:$false -AuthorizationPath ''";
  assert.equal(body.split(importStatement).length-1,1);body=body.replace(importStatement,()=>stage('import-before')+importStatement+';'+stage('import-after')+'\n'+guard);
  const protectionStatement='Assert-OwnerRotationProtectedPath -Path (Join-Path $root $file) -OwnerSid $scope.ownerSid';
  assert.equal(body.split(protectionStatement).length-1,1);body=body.replace(protectionStatement,()=>stage('source-protection-before')+protectionStatement+';'+stage('source-protection-after'));
  body=body.replace('$result.sourceHashesVerified=$true',()=>'$result.sourceHashesVerified=$true;'+stage('sources-verified'));
  body=body.replace("$attempt.stage='consumed'",()=>stage('attempt-consumption')+"$attempt.stage='consumed'");
  const hook=`
  ${stage('attempt-consumed')}
  [Windows.Forms.Application]::SetUnhandledExceptionMode([Windows.Forms.UnhandledExceptionMode]::CatchException)
  $publicThreadHandler=[Threading.ThreadExceptionEventHandler]{param($sender,$eventArgs)
   $publicProbe.threadExceptionObserved=$true;$type=$eventArgs.Exception.GetType().FullName;if($type -cnotmatch '^System[.][A-Za-z0-9_.+]+$'){$type='Unknown'};$publicProbe.exceptionType=$type;$publicProbe.missingClockCommand=$eventArgs.Exception.ToString().Contains('Get-OwnerRotationNow');${stage('thread-exception')}
   [Windows.Forms.Application]::ExitThread()
  }.GetNewClosure()
  [Windows.Forms.Application]::add_ThreadException($publicThreadHandler)
  `;
  assert.equal(body.split('Add-Type -AssemblyName System.Windows.Forms').length-1,1);body=body.replace('Add-Type -AssemblyName System.Windows.Forms',()=> 'Add-Type -AssemblyName System.Windows.Forms;'+hook);
  body=body.replace('try { $observer.Start();',()=>stage('before-form')+'try { $observer.Start();');
  body=body.replace('$result.cancelledWithoutConfirmation=',()=>stage('after-form')+'$result.cancelledWithoutConfirmation=');
  writeFileSync(target,body);
  const identity=spawnSync(shell,['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',timeout:10000});assert.equal(identity.status,0,'Public identity unavailable');assert.equal(/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(identity.stdout.trim()),true);
  const controlScript=`[Console]::Out.WriteLine('{"schemaVersion":1,"frame":"entered"}');[Console]::Out.Flush();
  $ErrorActionPreference='Stop';if($env:PUBLIC_WARNING_CONTROL_KIND -ceq 'cmdlet-pinned-module-path'){$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')};$watch=[Diagnostics.Stopwatch]::StartNew();$completed=$false;$builtin=$false;$readable=$false;$count=0;$verdict=$false;try{
   if($env:PUBLIC_WARNING_CONTROL_KIND -ceq 'native-filtered'){$info=[IO.FileInfo]::new($env:PUBLIC_WARNING_CONTROL_PATH);$acl=$info.GetAccessControl([Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner);$builtin=$info.GetType().Assembly.GetName().Name -ceq 'mscorlib'}else{$acl=Get-Acl -LiteralPath $env:PUBLIC_WARNING_CONTROL_PATH -ErrorAction Stop;$cmd=Get-Command 'Get-Acl' -CommandType Cmdlet -ErrorAction Stop;$builtin=$cmd.ModuleName -ceq 'Microsoft.PowerShell.Security'}
   $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);$readable=$true;$count=$rules.Count;if($count -lt 0 -or $count -gt 4096){throw 'ControlCountInvalid'};$owner=$env:PUBLIC_WARNING_CONTROL_OWNER_SID;$trusted=@($owner,'S-1-5-18','S-1-5-32-544','S-1-3-0');$verdict=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in @($owner,'S-1-5-18','S-1-5-32-544');$write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership;foreach($rule in $rules){if($rule.IdentityReference -isnot [Security.Principal.SecurityIdentifier]){$readable=$false;$verdict=$false};if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $write) -ne 0 -and $rule.IdentityReference.Value -notin $trusted){$verdict=$false}};$completed=$true
  }catch{$completed=$false;$readable=$false;$verdict=$false;$count=0}finally{$milliseconds=[int]$watch.ElapsedMilliseconds;[Console]::Out.WriteLine('{"schemaVersion":1,"frame":"result","completed":'+$completed.ToString().ToLowerInvariant()+',"commandTypeBuiltinModule":'+$builtin.ToString().ToLowerInvariant()+',"nativeSidReadable":'+$readable.ToString().ToLowerInvariant()+',"count":'+$count.ToString([Globalization.CultureInfo]::InvariantCulture)+',"policyVerdict":'+$verdict.ToString().ToLowerInvariant()+',"operationMilliseconds":'+$milliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)+'}');[Console]::Out.Flush()}`;
  for(const kind of ['cmdlet-filtered','native-filtered','cmdlet-pinned-module-path']){
   const env=a.buildWarningChildEnvironment(process.env,'','');env.PUBLIC_WARNING_CONTROL_KIND=kind;env.PUBLIC_WARNING_CONTROL_PATH=join(directory,sourceFiles[0]);env.PUBLIC_WARNING_CONTROL_OWNER_SID=identity.stdout.trim();
   const observation=await new Promise(done=>{
    const started=Date.now(),child=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',controlScript],{stdio:['ignore','pipe','pipe'],env,windowsHide:true});let output='',count=0,settled=false,killed=false;
    const fallback={schemaVersion:1,kind,success:false,elapsedMilliseconds:0,killed:false,childClosed:false,engineEntered:false,resultReceived:false,completed:false,commandTypeBuiltinModule:false,nativeSidReadable:false,count:0,policyVerdict:false,operationMilliseconds:0};
    const readFrames=()=>{const record={...fallback};try{
     const lines=output.trim()===''?[]:output.trim().split(/\r?\n/);assert.equal(lines.length<=2,true);if(lines.length===0)return record;
     const entered=JSON.parse(lines[0]);assert.deepEqual(Object.keys(entered).sort(),['frame','schemaVersion']);assert.equal(entered.schemaVersion,1);assert.equal(entered.frame,'entered');record.engineEntered=true;if(lines.length===1)return record;
     const r=JSON.parse(lines[1]);assert.deepEqual(Object.keys(r).sort(),['commandTypeBuiltinModule','completed','count','frame','nativeSidReadable','operationMilliseconds','policyVerdict','schemaVersion']);assert.equal(r.frame,'result');for(const key of ['commandTypeBuiltinModule','completed','nativeSidReadable','policyVerdict'])assert.equal(typeof r[key],'boolean');assert.equal(r.schemaVersion,1);assert.equal(Number.isInteger(r.count)&&r.count>=0&&r.count<=4096,true);assert.equal(Number.isInteger(r.operationMilliseconds)&&r.operationMilliseconds>=0&&r.operationMilliseconds<=5000,true);delete r.frame;Object.assign(record,r,{resultReceived:true});
    }catch{}return record;};
    const finish=record=>{if(settled)return;settled=true;clearTimeout(kill);clearTimeout(hard);done({...record,success:record.success&&!killed,elapsedMilliseconds:Date.now()-started,killed});};const stop=()=>{killed=true;child.kill();};const kill=setTimeout(stop,4500),hard=setTimeout(()=>{stop();finish(readFrames());},5000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{count+=Buffer.byteLength(data);if(count>4096){stop();return;}output+=data;});child.stderr.on('data',stop);child.on('error',()=>finish(readFrames()));child.on('close',exit=>{const record=readFrames();finish({...record,success:exit===0&&record.resultReceived&&record.completed,childClosed:true});});
   });
   console.log('PUBLIC_WARNING_ACL_AB_CONTROL '+JSON.stringify(observation));
  }
  const current=Date.now(),s={...scope(),ownerSid:identity.stdout.trim(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')])),workflowRunId:process.env.GITHUB_RUN_ID??String(current),issuedAt:new Date(current-1000).toISOString(),expiresAt:new Date(Math.min(current+600000,Date.parse('2026-11-10T08:00:00.000Z'))).toISOString()};
  const run=spawnSync(process.execPath,[join(directory,'scripts/owner-code-warning-1218.mjs'),'--run'],{encoding:'utf8',timeout:35000,cwd:directory,env:{...process.env,...context,GITHUB_SHA:s.sourceRevision,GITHUB_RUN_ID:s.workflowRunId,GORIQ_OWNER_WARNING_SCOPE_BASE64:Buffer.from(a.serializeWarningScope(s)).toString('base64')}});assert.equal(run.error,undefined,'Public diagnostic exceeded unchanged child bound');assert.equal(run.stderr,'');
  const path=join(directory,'.gai-results/public-warning-probe.json');
  if(current+30000<=Date.parse('2026-11-10T08:00:00.000Z')){
   assert.equal(existsSync(path),true,'Public diagnostic must record its reached stage');const observation=JSON.parse(readFileSync(path,'utf8'));
   assert.deepEqual(Object.keys(observation).sort(),['elapsedMilliseconds','exceptionType','history','identityKind','missingClockCommand','schemaVersion','stage','threadExceptionObserved']);assert.equal(observation.schemaVersion,1);const stages=['entered','owner-verified','sources-verified','hash-node-before','hash-node-after','hash-worker-before','hash-worker-after','hash-rotation-before','hash-rotation-after','source-hashes-after','import-before','import-after','source-protection-before','source-protection-after','guard-safe-path-before','guard-safe-path-after','guard-get-acl-before','guard-get-acl-after','guard-owner-before','guard-owner-after','guard-access-before','guard-access-entered','guard-access-after','guard-translate-before','guard-translate-after','guard-parent-before','guard-parent-after','attempt-consumption','attempt-consumed','before-form','after-form','thread-exception'];assert.equal(stages.includes(observation.stage),true);assert.equal(['Unobserved','NTAccount','SID','Other'].includes(observation.identityKind),true);assert.equal(typeof observation.threadExceptionObserved,'boolean');assert.equal(typeof observation.missingClockCommand,'boolean');assert.equal(/^(?:None|Unknown|System[.][A-Za-z0-9_.+]+)$/.test(observation.exceptionType),true);assert.equal(Number.isInteger(observation.elapsedMilliseconds)&&observation.elapsedMilliseconds>=0&&observation.elapsedMilliseconds<=35000,true);assert.equal(Array.isArray(observation.history)&&observation.history.length<=64,true);let previous=0;for(const point of observation.history){assert.deepEqual(Object.keys(point).sort(),['elapsedMilliseconds','stage']);assert.equal(stages.includes(point.stage),true);assert.equal(Number.isInteger(point.elapsedMilliseconds)&&point.elapsedMilliseconds>=previous&&point.elapsedMilliseconds<=35000,true);previous=point.elapsedMilliseconds;}console.log('PUBLIC_WARNING_UI_DIAGNOSTIC '+JSON.stringify(observation));
   const nativePath=join(directory,'.gai-results/public-native-sid-control.json');if(existsSync(nativePath)){const native=JSON.parse(readFileSync(nativePath,'utf8'));assert.deepEqual(Object.keys(native).sort(),['allSID','count','policyVerdict','readable','schemaVersion']);assert.equal(native.schemaVersion,1);for(const field of ['allSID','policyVerdict','readable'])assert.equal(typeof native[field],'boolean');assert.equal(Number.isInteger(native.count)&&native.count>=0&&native.count<=4096,true);console.log('PUBLIC_WARNING_NATIVE_SID_CONTROL '+JSON.stringify(native));}
  }else{const r=JSON.parse(run.stdout);assert.equal(r.failureCode,'WARNING_SCOPE_REQUIRED');console.log('PUBLIC_WARNING_DIAGNOSTIC_EXPECTS_EXPIRED_SCOPE');}
  for(const file of sourceFiles)assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),productionHashes[file]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
