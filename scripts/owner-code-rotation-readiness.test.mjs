import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const script=resolve('scripts/owner-code-preflight-1218.ps1');
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const digest=value=>createHash('sha256').update(value).digest('hex');
const sid='S-1-5-21-1-2-3-1004';
const ownerName='PUBLIC-FIXTURE\\Owner';
const fields=['schemaVersion','readOnly','proof','actualAcceptanceConditionsPassed','readyForRotation','actionKind','taskSha256','currentOwnerPrincipalMatch','taskRunning','pathNode','taskNode','pathNodeMatchesTaskNodeBytes','pathNodeMatchesTaskNodePath','releaseManifest','directNodeGuardShapeMatches'];
function fixture(fn){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'rotation-metadata-public-')));
 const release=join(directory,'release'),node=join(directory,'node.exe'),legacy=join(directory,'legacy'),system=process.env.SystemRoot||join(directory,'Windows');
 mkdirSync(join(release,'scripts'),{recursive:true});mkdirSync(join(legacy,'JARVIS','production'),{recursive:true});
 writeFileSync(node,'PUBLIC-NODE-FIXTURE-NOT-EXECUTABLE');
 const manifest=JSON.stringify({commit:'a'.repeat(40),createdAt:'2026-11-04T00:00:00Z'});
 writeFileSync(join(release,'jarvis-release.json'),manifest);
 const task={TaskName:'JARVIS Remote Host',TaskPath:'\\',State:'Running',Actions:[{Execute:node,Arguments:'"'+join(release,'scripts','jarvis-remote-host.mjs')+'"',WorkingDirectory:release}],Principal:{UserId:sid,LogonType:'Password',RunLevel:'Limited'}};
 try{return fn({directory,release,node,legacy,system,manifest,task});}finally{rmSync(directory,{recursive:true,force:true});}
}
function inspect(f,{task=f.task,pathNode=f.node,unprotected='',extra=''}={}){
 const taskText=task===null?'$null':`(${quote(JSON.stringify(task))}|ConvertFrom-Json)`;
 const code=`$ErrorActionPreference='Stop'; . ${quote(script)};
 $fixtureTask=${taskText};$fixtureNode=${quote(pathNode)};$fixtureOwner=${quote(sid)};$fixtureUnprotected=${quote(unprotected)};
 $env:LOCALAPPDATA=${quote(f.legacy)};if(-not $env:SystemRoot){$env:SystemRoot=${quote(f.system)}};
 function Get-Command { param([string]$Name,$ErrorAction) if($Name -cne 'node.exe'){throw 'UNEXPECTED_COMMAND_LOOKUP'}; [pscustomobject]@{Source=$fixtureNode;CommandType='Application'} }
 function Get-Acl { param([string]$LiteralPath,$ErrorAction)
  $acl=[pscustomobject]@{Access=@()}; $acl|Add-Member ScriptMethod GetOwner {param($type) [pscustomobject]@{Value=$fixtureOwner}};
  if($LiteralPath -ceq $fixtureUnprotected){$who=[pscustomobject]@{};$who|Add-Member ScriptMethod Translate {param($type) [pscustomobject]@{Value='S-1-5-21-9-9-9-9999'}};$acl.Access=@([pscustomobject]@{AccessControlType=[Security.AccessControl.AccessControlType]::Allow;FileSystemRights=[Security.AccessControl.FileSystemRights]::Write;IdentityReference=$who})};return $acl
 }
 function Start-Process {throw 'NATIVE_PROCESS_MUST_NOT_START'};function Stop-ScheduledTask {throw 'NATIVE_TASK_MUST_NOT_CHANGE'};function Start-ScheduledTask {throw 'NATIVE_TASK_MUST_NOT_CHANGE'};function Invoke-WebRequest {throw 'NETWORK_MUST_NOT_RUN'};function Get-ScheduledTask {throw 'TASK_MUST_BE_SUPPLIED'};
 ${extra}
 if(Test-Path Function:Get-1218RotationMetadata){Get-1218RotationMetadata -Task $fixtureTask -OwnerSid ${quote(sid)} -OwnerName ${quote(ownerName)}|ConvertTo-Json -Depth 8 -Compress}else{'{"missingFeature":true}'}
 `;
 const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:25000});
 assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');
 return JSON.parse(run.stdout.trim());
}
function closed(result,f){
 assert.deepEqual(Object.keys(result).sort(),[...fields].sort());
 assert.equal(result.schemaVersion,1);assert.equal(result.readOnly,true);assert.equal(result.proof,'UNVERIFIED');assert.equal(result.actualAcceptanceConditionsPassed,0);assert.equal(result.readyForRotation,false);
 for(const node of [result.pathNode,result.taskNode])assert.deepEqual(Object.keys(node).sort(),['protection','sha256','sizeBytes','state']);
 assert.deepEqual(Object.keys(result.releaseManifest).sort(),['protection','revision','sha256','state']);
 assert.doesNotMatch(JSON.stringify(result),/PUBLIC-NODE-FIXTURE|PUBLIC-FIXTURE|PRIVATE-ARGUMENT|CommandLine|Arguments|WorkingDirectory/);
 assert.equal(JSON.stringify(result).includes(f.directory),false);
}

// Regressions below catch accidental readiness credit, disclosure, execution,
// principal translation, or accepting a different task/interpreter/manifest.
test('direct Node metadata hashes real protected files but grants no readiness or acceptance',()=>fixture(f=>{
 const before=readFileSync(f.node);const result=inspect(f);closed(result,f);
 assert.equal(result.actionKind,'direct-node-host');assert.equal(result.currentOwnerPrincipalMatch,true);assert.equal(result.taskRunning,true);
 assert.match(result.taskSha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(result.pathNode,{state:'regular',sha256:digest(before),sizeBytes:before.length,protection:'protected'});
 assert.deepEqual(result.taskNode,result.pathNode);assert.equal(result.pathNodeMatchesTaskNodeBytes,true);assert.equal(result.pathNodeMatchesTaskNodePath,true);
 assert.deepEqual(result.releaseManifest,{state:'regular',sha256:digest(f.manifest),revision:'a'.repeat(40),protection:'protected'});assert.equal(result.directNodeGuardShapeMatches,true);
 assert.deepEqual(readFileSync(f.node),before);
}));
test('same Node bytes at different paths remain a path mismatch to the current task guard',()=>fixture(f=>{
 const other=join(f.directory,'other-node.exe');writeFileSync(other,readFileSync(f.node));
 const result=inspect(f,{pathNode:other});closed(result,f);assert.equal(result.pathNodeMatchesTaskNodeBytes,true);assert.equal(result.pathNodeMatchesTaskNodePath,false);assert.equal(result.directNodeGuardShapeMatches,false);
}));
test('different Node bytes never satisfy interpreter metadata compatibility',()=>fixture(f=>{
 const other=join(f.directory,'other-node.exe');writeFileSync(other,'PUBLIC-DIFFERENT-NODE');const result=inspect(f,{pathNode:other});closed(result,f);
 assert.equal(result.pathNodeMatchesTaskNodeBytes,false);assert.equal(result.pathNodeMatchesTaskNodePath,false);assert.equal(result.directNodeGuardShapeMatches,false);
}));
test('unknown or secret-bearing arguments are not hashed and never inspect an executable',()=>fixture(f=>{
 f.task.Actions[0].Arguments+=' PRIVATE-ARGUMENT-SENTINEL';
 const result=inspect(f,{extra:"function Get-1218FileMetadata {throw 'UNSUPPORTED_ACTION_FILE_MUST_NOT_BE_READ'}"});closed(result,f);
 assert.equal(result.actionKind,'unsupported');assert.equal(result.taskSha256,null);assert.equal(result.pathNode.sha256,null);assert.equal(result.taskNode.sha256,null);assert.equal(result.releaseManifest.revision,null);assert.equal(result.directNodeGuardShapeMatches,null);
}));
test('wrong Owner principal remains unverified without account translation or file reads',()=>fixture(f=>{
 f.task.Principal.UserId='PUBLIC-FIXTURE\\DifferentOwner';const result=inspect(f,{extra:"function Get-1218FileMetadata {throw 'WRONG_OWNER_FILE_MUST_NOT_BE_READ'}"});closed(result,f);
 assert.equal(result.currentOwnerPrincipalMatch,false);assert.equal(result.taskSha256,null);assert.equal(result.pathNode.sha256,null);assert.equal(result.directNodeGuardShapeMatches,null);
}));
test('the exact current Windows account name is accepted without directory lookup',()=>fixture(f=>{
 f.task.Principal.UserId=ownerName.toLowerCase();const result=inspect(f);closed(result,f);assert.equal(result.currentOwnerPrincipalMatch,true);assert.match(result.taskSha256,/^[a-f0-9]{64}$/);
}));
test('known compatibility launcher shape is classified but does not claim a task Node or direct-Node admission',()=>fixture(f=>{
 f.task.Actions[0].Execute=join(f.system,'System32','WindowsPowerShell','v1.0','powershell.exe');
 f.task.Actions[0].Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+join(f.legacy,'JARVIS','production','launch-current.ps1')+'"';
 const result=inspect(f);closed(result,f);assert.equal(result.actionKind,'compatibility-launcher');assert.match(result.taskSha256,/^[a-f0-9]{64}$/);assert.equal(result.taskNode.sha256,null);assert.equal(result.directNodeGuardShapeMatches,false);
}));
test('missing task and multiple actions have no canonical hash or compatibility proof',()=>fixture(f=>{
 for(const task of [null,{...f.task,Actions:[...f.task.Actions,...f.task.Actions]}]){const result=inspect(f,{task});closed(result,f);assert.equal(result.actionKind,task===null?'missing':'unsupported');assert.equal(result.taskSha256,null);assert.equal(result.directNodeGuardShapeMatches,null);}
}));
test('untrusted Node protection suppresses its hash and any compatibility claim',()=>fixture(f=>{
 const result=inspect(f,{unprotected:f.node});closed(result,f);assert.equal(result.taskNode.protection,'rejected');assert.equal(result.taskNode.sha256,null);assert.equal(result.pathNodeMatchesTaskNodeBytes,null);assert.equal(result.directNodeGuardShapeMatches,null);
}));
test('untrusted release root prevents manifest reads and revision disclosure',()=>fixture(f=>{
 const result=inspect(f,{unprotected:f.release});closed(result,f);assert.equal(result.releaseManifest.protection,'rejected');assert.equal(result.releaseManifest.sha256,null);assert.equal(result.releaseManifest.revision,null);assert.equal(result.directNodeGuardShapeMatches,null);
}));
test('oversized or malformed manifests never return a trusted revision',()=>fixture(f=>{
 for(const contents of ['x'.repeat(65537),'{"commit":"PRIVATE-ARGUMENT-SENTINEL"}','{"commit":']){writeFileSync(join(f.release,'jarvis-release.json'),contents);const result=inspect(f);closed(result,f);assert.equal(result.releaseManifest.revision,null);assert.equal(result.directNodeGuardShapeMatches,null);}
}));
test('reparse Node paths are rejected without following or executing their targets',()=>fixture(f=>{
 const target=join(f.directory,'target-node.exe'),link=join(f.directory,'linked-node.exe');writeFileSync(target,'PUBLIC-UNFOLLOWED-NODE');symlinkSync(target,link,process.platform==='win32'?'file':undefined);f.task.Actions[0].Execute=link;
 const marker=join(f.directory,'must-not-exist');const result=inspect(f,{pathNode:link});closed(result,f);assert.equal(result.taskNode.sha256,null);assert.equal(result.pathNode.sha256,null);assert.equal(result.directNodeGuardShapeMatches,null);assert.equal(existsSync(marker),false);
}));
