import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,parse} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runPreflightPowerShellBatch} from '../tests/helpers/powershell-preflight-batch.mjs';
const {structuredClone}=globalThis;

const script=resolve('scripts/owner-code-preflight-1218.ps1');
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const sid='S-1-5-21-1-2-3-1004';
const roles=['pathNode','taskNode','releaseRoot','releaseManifest'];
const metadataFields=['schemaVersion','readOnly','proof','actualAcceptanceConditionsPassed','readyForRotation','actionKind','taskSha256','currentOwnerPrincipalMatch','taskRunning','pathNode','taskNode','pathNodeMatchesTaskNodeBytes','pathNodeMatchesTaskNodePath','releaseManifest','directNodeGuardShapeMatches'];
function sourceFor(code,{requiresFeature=true}={}){
 const source=`$ErrorActionPreference='Stop'; . ${quote(script)}; ${requiresFeature?"if(-not (Get-Command New-1218RotationProtectionDiagnostics -ErrorAction SilentlyContinue)){'{\"missingFeature\":true}';return}":''} ${code}`;
 return source;
}
function ps(code,{requiresFeature=true,expectedStatus=0}={}){
 const source=sourceFor(code,{requiresFeature});
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',source],{encoding:'utf8',timeout:25000});
 assert.equal(run.error,undefined);assert.equal(run.status,expectedStatus,run.stderr);assert.equal(run.stderr,'');
 return JSON.parse(run.stdout.trim());
}
function psMany(codes){
 if(process.platform!=='linux')return codes.map(code=>ps(code));
 return runPreflightPowerShellBatch({shell,sources:codes.map(code=>sourceFor(code))}).map(run=>{
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');return JSON.parse(run.stdout.trim());
 });
}
function fixture(fn){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'protection-observation-public-')));
 const profile=join(directory,'profile'),release=join(profile,'release'),node=join(profile,'node.exe');
 mkdirSync(join(release,'scripts'),{recursive:true});writeFileSync(node,'PRIVATE-NODE-CONTENT-MARKER');
 writeFileSync(join(release,'jarvis-release.json'),JSON.stringify({commit:'a'.repeat(40)}));
 const task={TaskName:'JARVIS Remote Host',TaskPath:'\\',State:'Running',Actions:[{Execute:node,Arguments:'"'+join(release,'scripts','jarvis-remote-host.mjs')+'"',WorkingDirectory:release}],Principal:{UserId:sid,LogonType:'Password',RunLevel:'Limited'}};
 try{return fn({directory,profile,release,node,task});}finally{rmSync(directory,{recursive:true,force:true});}
}

// Only the platform ACL boundary is substituted. Real filesystem path/reparse
// inspection, both existing protection guards, and their ancestor loops run.
// Linux lacks Windows ACL APIs; public Windows positive ACLs are host-dependent.
const aclBoundary=`
 $script:aclReads=[Collections.Generic.List[string]]::new();$script:contentReads=0;
 function New-PublicAcl([string]$Path,[bool]$Native) {
  $script:aclReads.Add($(if($Native){'native:'}else{'legacy:'})+$Path);
  if(-not $Native -and $script:legacyMode -ceq 'commandUnavailable'){throw [Management.Automation.ErrorRecord]::new([Management.Automation.CommandNotFoundException]::new('PRIVATE-EXCEPTION-MARKER'),'CommandNotFoundException',[Management.Automation.ErrorCategory]::ObjectNotFound,'Get-Acl')}
  if(-not $Native -and $script:legacyMode -ceq 'observationUnavailable'){throw [IO.IOException]::new('PRIVATE-EXCEPTION-MARKER')}
  if($Native -and $script:nativeMode -ceq 'unavailable'){throw [IO.IOException]::new('PRIVATE-EXCEPTION-MARKER')}
  $acl=[pscustomobject]@{Access=@();FixtureOwner=$(if(($Native -and $Path -ieq $script:nativeRejectedPath) -or (-not $Native -and ($script:legacyMode -ceq 'guardRefusedCauseUnknown' -or $Path -ieq $script:legacyRejectedPath))){'S-1-5-21-9-9-9-9999'}else{${quote(sid)}})};
  $acl|Add-Member ScriptMethod GetOwner {param($type) [pscustomobject]@{Value=$this.FixtureOwner}};
  $acl|Add-Member ScriptMethod GetAccessRules {param($explicit,$inherited,$type) @()};return $acl
 }
 function Get-Acl {param([string]$LiteralPath,$ErrorAction) New-PublicAcl -Path $LiteralPath -Native $false}
 foreach($type in @('System.IO.FileInfo','System.IO.DirectoryInfo')){Update-TypeData -TypeName $type -MemberType ScriptMethod -MemberName GetAccessControl -Value {param($sections) New-PublicAcl -Path $this.FullName -Native $true} -Force}
 function Start-Process {throw 'PROCESS_MUST_NOT_START'};function Start-ScheduledTask {throw 'TASK_MUST_NOT_CHANGE'};function Stop-ScheduledTask {throw 'TASK_MUST_NOT_CHANGE'};function Invoke-WebRequest {throw 'NETWORK_MUST_NOT_RUN'};
`;
function inspectionSource(f,{task=f.task,legacyMode='commandUnavailable',nativeMode='matched',nativeRejectedPath='',legacyRejectedPath='',noContent=true,extra='',ownerSid=sid,collector=true}={}){
 return `$fixtureTask=${task===null?'$null':`(${quote(JSON.stringify(task))}|ConvertFrom-Json)`};
  $script:legacyMode=${quote(legacyMode)};$script:nativeMode=${quote(nativeMode)};$script:nativeRejectedPath=${quote(nativeRejectedPath)};$script:legacyRejectedPath=${quote(legacyRejectedPath)};
  ${aclBoundary}
  function Get-Command {param([string]$Name,$ErrorAction) if($Name -cne 'node.exe'){throw 'UNEXPECTED_COMMAND'};[pscustomobject]@{CommandType='Application';Source=${quote(f.node)}}}
  ${noContent?"function Get-1218FileMetadata {$script:contentReads++;throw 'CONTENT_MUST_NOT_BE_READ'}":''}
  ${extra}
  $diagnostics=New-1218RotationProtectionDiagnostics;
  $metadata=Get-1218RotationMetadata -Task $fixtureTask -OwnerSid ${quote(ownerSid)} -OwnerName 'PRIVATE-OWNER-NAME' ${collector?'-ProtectionDiagnostics $diagnostics':''};
  @{metadata=$metadata;diagnostics=$diagnostics;aclReads=@($script:aclReads.ToArray());contentReads=$script:contentReads}|ConvertTo-Json -Depth 10 -Compress`;
}
function inspect(f,options){return ps(inspectionSource(f,options));}
function inspectMany(f,cases){return process.platform==='linux'?psMany(cases.map(options=>inspectionSource(f,options))):cases.map(options=>inspect(f,options));}
function closed(value,f){
 assert.ok(value.diagnostics,'The optional diagnostic collector must be available');
 const d=value.diagnostics;
 assert.deepEqual(Object.keys(d).sort(),['schemaVersion','readOnly','proof','state','cause','authorizationGranted','actualAcceptanceConditionsPassed','paths'].sort());
 assert.equal(d.schemaVersion,1);assert.equal(d.readOnly,true);assert.equal(d.proof,'UNVERIFIED');assert.equal(d.cause,'UNKNOWN');assert.equal(d.authorizationGranted,false);assert.equal(d.actualAcceptanceConditionsPassed,0);
 assert.ok(['NOT_OBSERVED','OBSERVED'].includes(d.state));assert.deepEqual(Object.keys(d.paths).sort(),[...roles].sort());
 for(const role of roles){assert.deepEqual(Object.keys(d.paths[role]).sort(),['legacy','native']);assert.ok(['notObserved','policyMatched','commandUnavailable','guardRefusedCauseUnknown','observationUnavailable'].includes(d.paths[role].legacy));assert.ok(['notObserved','policyMatched','guardRefusedCauseUnknown','unavailable'].includes(d.paths[role].native));}
 assert.deepEqual(Object.keys(value.metadata).sort(),[...metadataFields].sort());assert.equal(value.metadata.readyForRotation,false);assert.equal(value.metadata.actualAcceptanceConditionsPassed,0);
 const serialized=JSON.stringify({metadata:value.metadata,diagnostics:d});assert.doesNotMatch(serialized,/PRIVATE-|S-1-5-|Exception|OwnerName|Arguments|WorkingDirectory/);assert.equal(serialized.includes(f.directory),false);
}

test('actual unavailable legacy ACL command is categorized without releasing hashes after native policy matches',()=>fixture(f=>{
 const value=inspect(f);closed(value,f);assert.equal(value.diagnostics.state,'OBSERVED');
 for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.diagnostics.paths[role],{legacy:'commandUnavailable',native:'policyMatched'});
 assert.deepEqual(value.diagnostics.paths.releaseManifest,{legacy:'notObserved',native:'notObserved'});
 assert.equal(value.metadata.pathNode.protection,'rejected');assert.equal(value.metadata.pathNode.sha256,null);assert.equal(value.metadata.taskNode.sha256,null);assert.equal(value.metadata.releaseManifest.revision,null);assert.equal(value.contentReads,0);
}));
test('actual legacy guard refusal remains distinct from unexpected metadata failure',()=>fixture(f=>{
 const modes=[['guardRefusedCauseUnknown','guardRefusedCauseUnknown'],['observationUnavailable','observationUnavailable']],values=inspectMany(f,modes.map(([legacyMode])=>({legacyMode})));
 for(const [index,[,want]] of modes.entries()){
  const value=values[index];closed(value,f);assert.deepEqual(value.diagnostics.paths.pathNode,{legacy:want,native:'policyMatched'});assert.equal(value.metadata.pathNode.protection,'rejected');assert.equal(value.contentReads,0);
 }
}));
test('native comparison uses the same selected path and rejects an ancestor above the profile',()=>fixture(f=>{
 const value=inspect(f,{nativeRejectedPath:f.directory});closed(value,f);
 assert.deepEqual(value.diagnostics.paths.pathNode,{legacy:'commandUnavailable',native:'guardRefusedCauseUnknown'});
 assert.deepEqual(value.aclReads.slice(0,5),['legacy:'+f.node,'native:'+f.node,'native:'+f.profile,'native:'+f.directory,'legacy:'+f.node]);
 assert.equal(value.metadata.pathNode.sha256,null);assert.equal(value.contentReads,0);
}));
test('native metadata observation failures are closed and cannot replace the original rejection',()=>fixture(f=>{
 const value=inspect(f,{nativeMode:'unavailable'});closed(value,f);assert.deepEqual(value.diagnostics.paths.pathNode,{legacy:'commandUnavailable',native:'unavailable'});assert.equal(value.metadata.pathNode.protection,'rejected');assert.equal(value.contentReads,0);
}));
test('typed failure for an unknown command remains unavailable and never publishes the command name',()=>fixture(f=>{
 const value=inspect(f,{extra:"function Get-Acl {param([string]$LiteralPath,$ErrorAction) throw [Management.Automation.ErrorRecord]::new([Management.Automation.CommandNotFoundException]::new('PRIVATE-EXCEPTION-MARKER'),'CommandNotFoundException',[Management.Automation.ErrorCategory]::ObjectNotFound,'PRIVATE-COMMAND-MARKER')}"});closed(value,f);
 assert.deepEqual(value.diagnostics.paths.pathNode,{legacy:'observationUnavailable',native:'policyMatched'});assert.equal(value.contentReads,0);
}));
test('optional collection preserves the exact legacy metadata result and walks all native ancestors',()=>fixture(f=>{
 const [plain,observed]=inspectMany(f,[{legacyMode:'matched',noContent:false,collector:false},{legacyMode:'matched',noContent:false}]);closed(observed,f);assert.deepEqual(observed.metadata,plain.metadata);
 for(const role of roles)assert.deepEqual(observed.diagnostics.paths[role],{legacy:'policyMatched',native:'policyMatched'});
 const native=observed.aclReads.filter(path=>path.startsWith('native:'));
 assert.ok(native.includes('native:'+parse(f.directory).root));assert.ok(native.includes('native:'+dirname(f.directory)));
 assert.deepEqual(plain.aclReads.filter(path=>path.startsWith('native:')),[]);
 assert.equal(readFileSync(f.node,'utf8'),'PRIVATE-NODE-CONTENT-MARKER');
}));
test('manifest guard failures are attached to the actual manifest path after the root passes',()=>fixture(f=>{
 const manifest=join(f.release,'jarvis-release.json');const value=inspect(f,{legacyMode:'matched',legacyRejectedPath:manifest,nativeRejectedPath:manifest,noContent:false});closed(value,f);
 assert.deepEqual(value.diagnostics.paths.releaseRoot,{legacy:'policyMatched',native:'policyMatched'});assert.deepEqual(value.diagnostics.paths.releaseManifest,{legacy:'guardRefusedCauseUnknown',native:'guardRefusedCauseUnknown'});
 assert.equal(value.metadata.releaseManifest.protection,'rejected');assert.equal(value.metadata.releaseManifest.sha256,null);assert.equal(value.metadata.releaseManifest.revision,null);
}));
test('a failed read-only collector cannot alter legacy metadata or add pipeline output',()=>fixture(f=>{
 const [plain,value]=psMany([inspectionSource(f,{legacyMode:'matched',noContent:false,collector:false}),`$fixtureTask=(${quote(JSON.stringify(f.task))}|ConvertFrom-Json);$script:legacyMode='matched';$script:nativeMode='matched';$script:nativeRejectedPath='';$script:legacyRejectedPath='';${aclBoundary}
  function Get-Command {param([string]$Name,$ErrorAction) [pscustomobject]@{CommandType='Application';Source=${quote(f.node)}}}
  $empty=[Collections.Generic.Dictionary[string,object]]::new();$readOnly=[Collections.ObjectModel.ReadOnlyDictionary[string,object]]::new($empty);
  $metadata=@(Get-1218RotationMetadata -Task $fixtureTask -OwnerSid ${quote(sid)} -OwnerName 'PRIVATE-OWNER-NAME' -ProtectionDiagnostics $readOnly);
  @{metadata=$metadata;aclReads=@($script:aclReads.ToArray())}|ConvertTo-Json -Depth 10 -Compress`]);
 assert.equal(value.metadata.length,1);assert.deepEqual(value.metadata[0],plain.metadata);
}));
test('missing context, unsupported action and unknown principal perform no diagnostic inspection',()=>fixture(f=>{
 const unsupported=structuredClone(f.task);unsupported.Actions[0].Arguments+=' PRIVATE-ARGUMENT-MARKER';
 const wrong=structuredClone(f.task);wrong.Principal.UserId='PRIVATE-OTHER-OWNER';
 const values=inspectMany(f,[...[null,unsupported,wrong].map(task=>({task})),{ownerSid:'PRIVATE-UNKNOWN-SID'}]);
 for(const value of values.slice(0,3)){closed(value,f);assert.equal(value.diagnostics.state,'NOT_OBSERVED');assert.deepEqual(value.aclReads,[]);assert.equal(value.contentReads,0);for(const role of roles)assert.deepEqual(value.diagnostics.paths[role],{legacy:'notObserved',native:'notObserved'});}
 const unknown=values[3];closed(unknown,f);assert.equal(unknown.diagnostics.state,'NOT_OBSERVED');assert.deepEqual(unknown.aclReads,[]);
}));
test('dot-source and empty collector initialization perform no filesystem or process inspection',()=>{
 const value=ps(`function Get-Item {throw 'IMPORT_IO'};function Get-Acl {throw 'IMPORT_IO'};function Get-Process {throw 'IMPORT_IO'};. ${quote(script)};$d=New-1218RotationProtectionDiagnostics;@{state=$d.state;authorizationGranted=$d.authorizationGranted}|ConvertTo-Json -Compress`);
 assert.deepEqual(value,{state:'NOT_OBSERVED',authorizationGranted:false});
});
test('top-level failure report carries separately versioned diagnostics without expanding rotation metadata',()=>{
 const value=ps("New-1218FailureReport -Stage 'platform' -ReasonCode 'WINDOWS_REQUIRED'|ConvertTo-Json -Depth 10 -Compress");
 assert.equal(value.rotationProtectionDiagnostics?.schemaVersion,1);assert.equal(value.rotationProtectionDiagnostics.state,'NOT_OBSERVED');assert.equal(value.rotationProtectionDiagnostics.authorizationGranted,false);assert.equal(value.rotationProtectionDiagnostics.actualAcceptanceConditionsPassed,0);
 assert.deepEqual(Object.keys(value.rotationMetadata).sort(),[...metadataFields].sort());
});
test('public Windows default preflight exposes closed diagnostics at the top-level only',{skip:process.platform!=='win32'},()=>fixture(f=>{
 const encrypted=join(f.directory,'public.dpapi');writeFileSync(encrypted,'PRIVATE-PUBLIC-CIPHERTEXT-MARKER');
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',timeout:35000,env:{...process.env,JARVIS_PRODUCTION_CONFIG:encrypted}});
 assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');const value=JSON.parse(run.stdout.trim());
 assert.equal(value.rotationProtectionDiagnostics?.schemaVersion,1);assert.equal(value.rotationProtectionDiagnostics.authorizationGranted,false);assert.equal(value.rotationProtectionDiagnostics.actualAcceptanceConditionsPassed,0);assert.deepEqual(Object.keys(value.rotationMetadata).sort(),[...metadataFields].sort());assert.equal(value.rotationMetadata.readyForRotation,false);assert.doesNotMatch(run.stdout,/PRIVATE-PUBLIC-CIPHERTEXT-MARKER/);
}));
test('nine approval-bound controller dependencies retain the reviewed baseline bytes',()=>{
 const pins={
  'owner-code-rotation-acceptance.mjs':'6b0679ef7f62af8aa883cf10a3429c2e957912c213fc4f573d4fa4aa7cc703e3',
  'owner-code-fleet-preservation.mjs':'197d838c92652059a1d0a41fb4b929d5c4d3928c6dee95f09de7014e3c4e7938',
  'owner-code-pc-preservation.mjs':'d0d5d9fd3b6106de90d3907fdd993a0e735e524e46daa3d7cc51bf83bf4799b4',
  'owner-code-rotation-worker.ps1':'d56efffa447186d012e33e107091fbf8283578450493422640ea95c808a98896',
  'rotate-jarvis-owner-code-windows.ps1':'588cae41ffdc4aac330629877e4757844e489fb737564bd0465f7a1f5cfa00f3',
  'read-jarvis-production-config.ps1':'252f057b933ddd16c8eec85507fd43b084cf9f0cdba1ded93746ad5e199cccb5',
  'validate-jarvis-production-config.mjs':'343b4f588183b6a135bef464f19ee8ef68c984540fb98f535f18b87c9c8b9f06',
  'jarvis-production-config.mjs':'4a8d55473cdbab4578d4c7ad84b339adce9e5423fea9cbfd9deb2d1d6a8f1fdb',
  'jarvis-windows-install-paths.mjs':'b54bec2195f1f493c5d655433229d71a0258c6d16527c716082c63769b0be95d'
 };
 for(const [name,want] of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(resolve('scripts',name))).digest('hex'),want,name);
});
test('public Windows real-filesystem reparse refusal uses unchanged native guard without ACL substitutes',{skip:process.platform!=='win32'},()=>fixture(f=>{
 const target=join(f.directory,'target'),link=join(f.profile,'junction');mkdirSync(target);symlinkSync(target,link,'junction');
 const value=ps(`. ${quote(resolve('scripts/rotate-jarvis-owner-code-windows.ps1'))} -Apply:$false -AuthorizationPath '';$refusal=try{Get-OwnerRotationSafePath -Path ${quote(join(link,'node.exe'))} -NativeMetadata|Out-Null;@{refused=$false}}catch{@{refused=$_.Exception.Message -ceq 'ROTATION_CONTEXT_UNAVAILABLE'}};$refusal|ConvertTo-Json -Compress`,{requiresFeature:false});
 assert.equal(value.refused,true);
}));
