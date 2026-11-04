import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,parse} from 'node:path';
import {spawnSync} from 'node:child_process';
const {structuredClone}=globalThis;

const script=resolve('scripts/owner-code-preflight-1218.ps1');
const core=resolve('scripts/rotate-jarvis-owner-code-windows.ps1');
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const sid='S-1-5-21-1-2-3-1004';
const other='S-1-5-21-9-9-9-9999';
const installer='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const roles=['pathNode','taskNode','releaseRoot','releaseManifest'];
const metadataFields=['schemaVersion','readOnly','proof','actualAcceptanceConditionsPassed','readyForRotation','actionKind','taskSha256','currentOwnerPrincipalMatch','taskRunning','pathNode','taskNode','pathNodeMatchesTaskNodeBytes','pathNodeMatchesTaskNodePath','releaseManifest','directNodeGuardShapeMatches'];
const predicates=['UNKNOWN','policyMatched','pathShapeRefused','pathOrDriveContextRefused','rootMetadataRefused','reparseRefused','metadataRefused','ownerOutsideTrustSet','nonSidAccessRuleRefused','writeOutsideTrustSet'];
const loadCore=`. ${quote(core)} -Apply:$false -AuthorizationPath '';`;
function ps(code,{seed=true,load=false}={}){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'current-observation-script-'))),file=join(directory,'public-test.ps1');
 const source=`$ErrorActionPreference='Stop'; . ${quote(script)};
  if(-not (Get-Command Get-1218CurrentRotationProtectionObservation -ErrorAction SilentlyContinue)){'{"missingFeature":true}';return}
  ${seed?`Get-1218ReviewedArtifacts -Root ${quote(resolve('.'))}|Out-Null;`:''}
  ${load?loadCore:''}
  ${code}`;
 // UTF-8 BOM and -File preserve non-ASCII Windows paths without a long command.
 writeFileSync(file,'\ufeff'+source);
 try{
  const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File',file],{encoding:'utf8',timeout:25000});
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');return JSON.parse(run.stdout.trim());
 }finally{rmSync(directory,{recursive:true,force:true});}
}
function fixture(fn){
 const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'current-observation-public-'))),profile=join(directory,'profile'),release=join(profile,'release'),node=join(profile,'node.exe');
 mkdirSync(join(release,'scripts'),{recursive:true});writeFileSync(node,'PRIVATE-NODE-CONTENT-MARKER');writeFileSync(join(release,'jarvis-release.json'),JSON.stringify({commit:'a'.repeat(40)}));
 const task={TaskName:'JARVIS Remote Host',TaskPath:'\\',State:'Running',Actions:[{Execute:node,Arguments:'"'+join(release,'scripts','jarvis-remote-host.mjs')+'"',WorkingDirectory:release}],Principal:{UserId:sid,LogonType:'Password',RunLevel:'Limited'}};
 try{return fn({directory,profile,release,node,task});}finally{rmSync(directory,{recursive:true,force:true});}
}

// These are ACL observation substitutes, necessary on Linux and deterministic
// on hosted Windows. The real pinned native path/ancestor guard runs for parity.
// Synthetic ACL results establish source behavior, never actual Owner ACL state.
const boundary=`
 $script:aclReads=0;$script:metadataReads=0;$script:contentReads=0;
 function New-PublicAcl([string]$Path,[bool]$Native) {
  $script:aclReads++;
  if($script:aclMode -ceq 'unavailable'){throw [IO.IOException]::new('PRIVATE-EXCEPTION-MARKER')}
  if($script:aclMode -ceq 'guardText'){throw 'ROTATION_CONTEXT_UNAVAILABLE'}
  $owner=if($Path -ieq $script:refusedPath){$script:refusedOwner}else{$script:defaultOwner};
  if($Native -and $script:replayThreshold -gt 0 -and $script:aclReads -gt $script:replayThreshold){$owner=${quote(sid)};$script:fixtureTask.State='Disabled';$script:replayBoundaryChanged=$true}
  $acl=[pscustomobject]@{Access=@();FixtureOwner=$owner};
  $acl|Add-Member ScriptMethod GetOwner {param($type) [pscustomobject]@{Value=$this.FixtureOwner}};
  if($script:aclMode -ceq 'nonSid'){$acl.Access=@([pscustomobject]@{IdentityReference=[pscustomobject]@{};AccessControlType=[Security.AccessControl.AccessControlType]::Allow;FileSystemRights=[Security.AccessControl.FileSystemRights]::Read})}
  if($script:aclMode -ceq 'windowsRule' -and $Path -ieq $script:rulePath){$acl.Access=@([pscustomobject]@{IdentityReference=[Security.Principal.SecurityIdentifier]::new($script:writerSid);AccessControlType=[Security.AccessControl.AccessControlType]$script:ruleType;FileSystemRights=[Security.AccessControl.FileSystemRights]$script:ruleRights})}
  $acl|Add-Member ScriptMethod GetAccessRules {param($explicit,$inherited,$type) $this.Access};return $acl
 }
 function Get-Acl {param([string]$LiteralPath,$ErrorAction) New-PublicAcl -Path $LiteralPath -Native $false}
 foreach($type in @('System.IO.FileInfo','System.IO.DirectoryInfo')){Update-TypeData -TypeName $type -MemberType ScriptMethod -MemberName GetAccessControl -Value {param($sections) New-PublicAcl -Path $this.FullName -Native $true} -Force}
 function Get-Item {param([string]$LiteralPath,[string]$Path,[switch]$Force,$ErrorAction)
  if($PSBoundParameters.ContainsKey('LiteralPath')){if($LiteralPath -notmatch '^Function:'){$script:metadataReads++};Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath -Force:$Force -ErrorAction Stop}
  else{Microsoft.PowerShell.Management\\Get-Item -Path $Path -Force:$Force -ErrorAction Stop}
 }
 function Get-FileHash {param([string]$LiteralPath,[string]$Algorithm,$ErrorAction) $script:contentReads++;Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $LiteralPath -Algorithm $Algorithm -ErrorAction Stop}
 function Start-Process {throw 'PROCESS_MUST_NOT_START'};function Start-ScheduledTask {throw 'TASK_MUST_NOT_CHANGE'};function Stop-ScheduledTask {throw 'TASK_MUST_NOT_CHANGE'};function Invoke-WebRequest {throw 'NETWORK_MUST_NOT_RUN'};
`;
function setup({mode='matched',defaultOwner=sid,refusedPath='',refusedOwner=other,replayThreshold=0}={}){
 return `$script:aclMode=${quote(mode)};$script:defaultOwner=${quote(defaultOwner)};$script:refusedPath=${quote(refusedPath)};$script:refusedOwner=${quote(refusedOwner)};$script:replayThreshold=${replayThreshold};$script:replayBoundaryChanged=$false;${boundary}`;
}
function inspect(f,{collectors='both',task=f.task,mode='matched',defaultOwner=other,replayThreshold=0,extra='',readOnlyDetails=false,proof=true}={}){
 return ps(`$script:fixtureTask=${task===null?'$null':`(${quote(JSON.stringify(task))}|ConvertFrom-Json)`};${setup({mode,defaultOwner,replayThreshold})}
  function Get-Command {param([string]$Name,$ErrorAction) if($Name -ceq 'node.exe'){return [pscustomobject]@{CommandType='Application';Source=${quote(f.node)}}};Microsoft.PowerShell.Core\\Get-Command -Name $Name -ErrorAction Stop}
  ${proof?'':'$script:LastSourceArtifact=$null;'}${extra}
  $old=New-1218RotationProtectionDiagnostics;$details=New-1218RotationProtectionFailureDetails;
  ${readOnlyDetails?'$empty=[Collections.Generic.Dictionary[string,object]]::new();$details=[Collections.ObjectModel.ReadOnlyDictionary[string,object]]::new($empty);':''}
  $output=@(Get-1218RotationMetadata -Task $script:fixtureTask -OwnerSid ${quote(sid)} -OwnerName 'PRIVATE-OWNER-NAME' ${collectors==='old'||collectors==='both'?'-ProtectionDiagnostics $old':''} ${collectors==='details'||collectors==='both'?'-ProtectionFailureDetails $details':''});
  @{metadata=$output;old=$old;details=$details;aclReads=$script:aclReads;metadataReads=$script:metadataReads;contentReads=$script:contentReads;replayBoundaryChanged=$script:replayBoundaryChanged}|ConvertTo-Json -Depth 10 -Compress`);
}
function closedRole(role,f){
 assert.ok(role,'A current-observation role must be returned');assert.deepEqual(Object.keys(role).sort(),['state','predicate','location','ownerClass'].sort());
 assert.ok(['NOT_OBSERVED','CURRENT_MATCH','CURRENT_REFUSAL','UNAVAILABLE'].includes(role.state));assert.ok(predicates.includes(role.predicate));assert.ok(['NOT_OBSERVED','pathInput','leaf','parent','ancestor','volumeRoot'].includes(role.location));assert.ok(['NOT_OBSERVED','owner','system','administrators','trustedInstaller','other'].includes(role.ownerClass));
 const json=JSON.stringify(role);assert.doesNotMatch(json,/PRIVATE-|S-1-|Exception|ScriptName|ScriptLine|OffsetInLine|\.ps1/);if(f)assert.equal(json.includes(f.directory),false);
}
function closedDetails(d,f){
 assert.ok(d,'The separate current-observation collector must exist');assert.deepEqual(Object.keys(d).sort(),['schemaVersion','readOnly','proof','measurement','priorCause','state','authorizationGranted','actualAcceptanceConditionsPassed','paths'].sort());
 assert.equal(d.schemaVersion,1);assert.equal(d.readOnly,true);assert.equal(d.proof,'UNVERIFIED');assert.equal(d.measurement,'CURRENT_OBSERVATION');assert.equal(d.priorCause,'UNKNOWN');assert.ok(['NOT_OBSERVED','OBSERVED','UNAVAILABLE'].includes(d.state));assert.equal(d.authorizationGranted,false);assert.equal(d.actualAcceptanceConditionsPassed,0);assert.deepEqual(Object.keys(d.paths).sort(),[...roles].sort());for(const role of roles)closedRole(d.paths[role],f);
}
const matched={state:'CURRENT_MATCH',predicate:'policyMatched',location:'NOT_OBSERVED',ownerClass:'NOT_OBSERVED'};
const unknown={state:'UNAVAILABLE',predicate:'UNKNOWN',location:'NOT_OBSERVED',ownerClass:'NOT_OBSERVED'};
const unobserved={state:'NOT_OBSERVED',predicate:'UNKNOWN',location:'NOT_OBSERVED',ownerClass:'NOT_OBSERVED'};
function oldResultsEqual(value,baseline){
 assert.ok(value.metadata,'The optional current-observation integration must exist');assert.equal(value.metadata.length,1);assert.deepEqual(value.metadata,baseline.metadata);assert.deepEqual(value.old,baseline.old);assert.deepEqual(Object.keys(value.metadata[0]).sort(),[...metadataFields].sort());assert.equal(value.metadata[0].readyForRotation,false);assert.equal(value.metadata[0].actualAcceptanceConditionsPassed,0);
}
function observe(f,{path=f.node,...options}={}){
 return ps(`${setup(options)}$nativeMatched=$true;try{Assert-OwnerRotationProtectedPath -Path ${quote(path)} -OwnerSid ${quote(sid)} -NativeMetadata}catch{$nativeMatched=$false};$before=$script:contentReads;$observation=Get-1218CurrentRotationProtectionObservation -Path ${quote(path)} -OwnerSid ${quote(sid)};@{observation=$observation;nativeMatched=$nativeMatched;contentReads=$script:contentReads-$before;aclReads=$script:aclReads}|ConvertTo-Json -Depth 6 -Compress`,{load:true});
}

test('memory policy pins permit the public baseline and refuse stale proof without filesystem remeasurement',()=>{
 const value=ps(`function Get-FileHash {throw 'POLICY_MUST_NOT_REHASH_SOURCE'};function Get-Acl {throw 'POLICY_MUST_NOT_READ_ACL'};$valid=Test-1218RotationObservationPolicy;$baseline=$script:LastSourceArtifact;$invalid=@();foreach($field in @('name','state','sha256','expectedSha256')){$script:LastSourceArtifact=@{};foreach($key in $baseline.Keys){$script:LastSourceArtifact[$key]=$baseline[$key]};$script:LastSourceArtifact[$field]='PRIVATE-MISMATCH-MARKER';$invalid+=Test-1218RotationObservationPolicy};$script:LastSourceArtifact=$null;$invalid+=Test-1218RotationObservationPolicy;@{valid=$valid;invalid=$invalid}|ConvertTo-Json -Compress`,{load:true});
 assert.equal(value.valid,true);assert.deepEqual(value.invalid,[false,false,false,false,false]);
});
test('a changed loaded native guard body cannot authorize current metadata reads with stale file proof',()=>fixture(f=>{
 const value=ps(`$definition=(Microsoft.PowerShell.Core\\Get-Command Assert-OwnerRotationProtectedPath).ScriptBlock.Ast;$changed=$definition.Extent.Text.Replace('$depth -le 1','$depth -le 0');$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput((([string][char]10)*($definition.Extent.StartLineNumber-1))+$changed,${quote(core)},[ref]$tokens,[ref]$errors);. $ast.GetScriptBlock();${setup()}$policy=Test-1218RotationObservationPolicy;$observation=Get-1218CurrentRotationProtectionObservation -Path ${quote(f.node)} -OwnerSid ${quote(sid)};@{policy=$policy;observation=$observation;aclReads=$script:aclReads;contentReads=$script:contentReads}|ConvertTo-Json -Depth 6 -Compress`,{load:true});
 assert.equal(value.policy,false);closedRole(value.observation,f);assert.deepEqual(value.observation,unknown);assert.equal(value.aclReads,0);assert.equal(value.contentReads,0);
}));
test('current owner policy agrees with the unchanged native guard for all allowed owner classes',()=>fixture(f=>{
 for(const owner of [sid,'S-1-5-18','S-1-5-32-544']){const value=observe(f,{defaultOwner:owner});closedRole(value.observation,f);assert.equal(value.nativeMatched,true);assert.deepEqual(value.observation,matched);assert.equal(value.contentReads,0);}
}));
test('first current owner refusal uses the observed tier and keeps TrustedInstaller descriptive only',()=>fixture(f=>{
 for(const [path,location] of [[f.node,'leaf'],[f.profile,'parent'],[f.directory,'ancestor'],[parse(f.directory).root,'volumeRoot']]){
  const value=observe(f,{refusedPath:path});closedRole(value.observation,f);assert.equal(value.nativeMatched,false);assert.deepEqual(value.observation,{state:'CURRENT_REFUSAL',predicate:'ownerOutsideTrustSet',location,ownerClass:'other'});assert.equal(value.contentReads,0);
 }
 const value=observe(f,{refusedPath:f.node,refusedOwner:installer});closedRole(value.observation,f);assert.equal(value.nativeMatched,false);assert.deepEqual(value.observation,{state:'CURRENT_REFUSAL',predicate:'ownerOutsideTrustSet',location:'leaf',ownerClass:'trustedInstaller'});
}));
test('real leaf and ancestor reparse boundaries refuse before any ACL or content read',()=>fixture(f=>{
 const leafDirectory=join(f.profile,'leaf-link');mkdirSync(leafDirectory);const leaf=join(leafDirectory,'node.exe');symlinkSync(f.node,leaf,process.platform==='win32'?'file':undefined);
 const target=join(f.directory,'target'),link=join(f.profile,'junction');mkdirSync(target);symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 for(const [path,location] of [[leaf,'leaf'],[join(link,'node.exe'),'parent']]){const value=observe(f,{path});closedRole(value.observation,f);assert.equal(value.nativeMatched,false);assert.deepEqual(value.observation,{state:'CURRENT_REFUSAL',predicate:'reparseRefused',location,ownerClass:'NOT_OBSERVED'});assert.equal(value.aclReads,0);assert.equal(value.contentReads,0);}
}));
test('input refusal and API failures expose only current fixed outcomes without attributing exception text',()=>fixture(f=>{
 const shape=observe(f,{path:'PRIVATE-RELATIVE-PATH'});closedRole(shape.observation,f);assert.equal(shape.nativeMatched,false);assert.deepEqual(shape.observation,{state:'CURRENT_REFUSAL',predicate:'pathShapeRefused',location:'pathInput',ownerClass:'NOT_OBSERVED'});assert.equal(shape.aclReads,0);
 for(const mode of ['unavailable','guardText']){const value=observe(f,{mode});closedRole(value.observation,f);assert.equal(value.nativeMatched,false);assert.deepEqual(value.observation,unknown);assert.equal(value.contentReads,0);}
 const nonSid=observe(f,{mode:'nonSid'});closedRole(nonSid.observation,f);assert.equal(nonSid.nativeMatched,false);assert.deepEqual(nonSid.observation,{state:'CURRENT_REFUSAL',predicate:'nonSidAccessRuleRefused',location:'leaf',ownerClass:'owner'});
}));
test('only old native refusals replay once per selected role after preserving both old result objects',()=>fixture(f=>{
 const baseline=inspect(f,{collectors:'old'}),value=inspect(f);closedDetails(value.details,f);oldResultsEqual(value,baseline);assert.equal(baseline.aclReads,6);assert.equal(value.aclReads,9);assert.equal(value.metadataReads,baseline.metadataReads);assert.equal(value.contentReads,0);assert.equal(value.details.state,'OBSERVED');
 for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.details.paths[role],{state:'CURRENT_REFUSAL',predicate:'ownerOutsideTrustSet',location:'leaf',ownerClass:'other'});assert.deepEqual(value.details.paths.releaseManifest,unobserved);assert.equal(value.metadata[0].pathNode.sha256,null);assert.equal(value.metadata[0].releaseManifest.revision,null);
}));
test('later current match after old refusal preserves withheld hashes and captures all old calls before replay',()=>fixture(f=>{
 const baseline=inspect(f,{collectors:'old'}),value=inspect(f,{replayThreshold:6});closedDetails(value.details,f);oldResultsEqual(value,baseline);assert.equal(value.replayBoundaryChanged,true);
 for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.details.paths[role],matched);assert.equal(value.metadata[0].taskRunning,true);assert.equal(value.metadata[0].pathNode.protection,'rejected');assert.equal(value.metadata[0].pathNode.sha256,null);assert.equal(value.metadata[0].taskNode.sha256,null);assert.equal(value.metadata[0].releaseManifest.revision,null);assert.equal(value.contentReads,0);assert.equal(value.details.priorCause,'UNKNOWN');
}));
test('old native matches are summarized without replay and neither optional collector leaves old I/O unchanged',()=>fixture(f=>{
 const baseline=inspect(f,{collectors:'old',defaultOwner:sid}),value=inspect(f,{defaultOwner:sid});closedDetails(value.details,f);oldResultsEqual(value,baseline);for(const field of ['aclReads','metadataReads','contentReads'])assert.equal(value[field],baseline[field]);for(const role of roles)assert.deepEqual(value.details.paths[role],matched);assert.equal(readFileSync(f.node,'utf8'),'PRIVATE-NODE-CONTENT-MARKER');
 const plain=inspect(f,{collectors:'none'});assert.equal(plain.aclReads,3);assert.equal(plain.contentReads,0);
}));
test('details alone uses the existing comparison while unavailable original comparisons do not replay',()=>fixture(f=>{
 const both=inspect(f),alone=inspect(f,{collectors:'details'});closedDetails(alone.details,f);assert.deepEqual(alone.metadata,both.metadata);assert.deepEqual(alone.details,both.details);for(const field of ['aclReads','metadataReads','contentReads'])assert.equal(alone[field],both[field]);
 const baseline=inspect(f,{mode:'unavailable',collectors:'old'}),value=inspect(f,{mode:'unavailable'});closedDetails(value.details,f);oldResultsEqual(value,baseline);assert.equal(value.aclReads,baseline.aclReads);for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.details.paths[role],unknown);assert.deepEqual(value.details.paths.releaseManifest,unobserved);
}));
test('missing source pins block added observation before any new metadata, ACL or content reads',()=>fixture(f=>{
 const baseline=inspect(f,{collectors:'old',proof:false}),value=inspect(f,{proof:false});closedDetails(value.details,f);oldResultsEqual(value,baseline);assert.equal(value.details.state,'UNAVAILABLE');for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.details.paths[role],unknown);for(const field of ['aclReads','metadataReads','contentReads'])assert.equal(value[field],baseline[field]);
}));
test('broken collectors and observer output cannot change old objects or emit private pipeline values',()=>fixture(f=>{
 const baseline=inspect(f,{collectors:'old'}),readOnly=inspect(f,{readOnlyDetails:true});oldResultsEqual(readOnly,baseline);
 for(const body of ["'PRIVATE-PIPELINE-MARKER';throw 'PRIVATE-OBSERVER-FAILURE'","@{state='CURRENT_REFUSAL';predicate='ownerOutsideTrustSet';location='leaf';ownerClass='other';extra='PRIVATE-EXTRA-MARKER'}","@{state='CURRENT_REFUSAL';predicate='PRIVATE-PREDICATE-MARKER';location='leaf';ownerClass='other'}"]){
  const value=inspect(f,{extra:'function Get-1218CurrentRotationProtectionObservation {param([string]$Path,[string]$OwnerSid) '+body+'}'});closedDetails(value.details,f);oldResultsEqual(value,baseline);for(const role of ['pathNode','taskNode','releaseRoot'])assert.deepEqual(value.details.paths[role],unknown);assert.equal(value.aclReads,baseline.aclReads);
 }
}));
test('missing task, unsupported arguments and unknown principal never select observable paths',()=>fixture(f=>{
 const unsupported=structuredClone(f.task);unsupported.Actions[0].Arguments+=' PRIVATE-ARGUMENT-MARKER';const wrong=structuredClone(f.task);wrong.Principal.UserId='PRIVATE-OTHER-OWNER';
 for(const task of [null,unsupported,wrong]){const value=inspect(f,{task});closedDetails(value.details,f);assert.equal(value.details.state,'NOT_OBSERVED');for(const role of roles)assert.deepEqual(value.details.paths[role],unobserved);assert.equal(value.aclReads,0);assert.equal(value.metadataReads,0);assert.equal(value.contentReads,0);}
}));
test('factory and failure report retain closed current summaries separately from both original schema-1 objects',()=>{
 const value=ps(`function Get-FileHash {throw 'NO_NEW_IO'};function Get-Acl {throw 'NO_NEW_IO'};$details=New-1218RotationProtectionFailureDetails;$report=New-1218FailureReport -Stage 'platform' -ReasonCode 'WINDOWS_REQUIRED';@{details=$details;report=$report}|ConvertTo-Json -Depth 10 -Compress`,{seed:false});closedDetails(value.details);closedDetails(value.report.rotationProtectionFailureDetails);assert.equal(value.details.state,'NOT_OBSERVED');for(const role of roles)assert.deepEqual(value.details.paths[role],unobserved);assert.deepEqual(Object.keys(value.report.rotationMetadata).sort(),[...metadataFields].sort());assert.deepEqual(Object.keys(value.report.rotationProtectionDiagnostics).sort(),['schemaVersion','readOnly','proof','state','cause','authorizationGranted','actualAcceptanceConditionsPassed','paths'].sort());assert.equal(value.report.rotationMetadata.readyForRotation,false);
});
test('public Windows native SID rules preserve depth masks, denial handling and missing-target guard depth',{skip:process.platform!=='win32'},()=>fixture(f=>{
 const missing=join(f.profile,'missing','node.exe');
 const cases=[
  {path:f.node,rule:f.node,rights:'Write',type:'Allow',writer:other,refused:true,location:'leaf'},
  {path:f.node,rule:f.profile,rights:'Write',type:'Allow',writer:other,refused:true,location:'parent'},
  {path:f.node,rule:f.directory,rights:'Write',type:'Allow',writer:other,refused:false},
  {path:f.node,rule:f.directory,rights:'Delete',type:'Allow',writer:other,refused:true,location:'ancestor'},
  {path:f.node,rule:f.node,rights:'Write',type:'Deny',writer:other,refused:false},
  {path:f.node,rule:f.node,rights:'Write',type:'Allow',writer:'S-1-3-0',refused:false},
  {path:missing,rule:f.profile,rights:'Write',type:'Allow',writer:other,refused:true,location:'ancestor'}
 ];
 const value=ps(`${setup({mode:'windowsRule'})}$cases=${quote(JSON.stringify(cases))}|ConvertFrom-Json;$results=@();foreach($case in $cases){$script:rulePath=$case.rule;$script:ruleRights=$case.rights;$script:ruleType=$case.type;$script:writerSid=$case.writer;$nativeMatched=$true;try{Assert-OwnerRotationProtectedPath -Path $case.path -OwnerSid ${quote(sid)} -NativeMetadata}catch{$nativeMatched=$false};$results+=@{nativeMatched=$nativeMatched;observation=(Get-1218CurrentRotationProtectionObservation -Path $case.path -OwnerSid ${quote(sid)})}};@{results=$results}|ConvertTo-Json -Depth 8 -Compress`,{load:true});
 assert.equal(value.results.length,cases.length);for(const [index,item] of value.results.entries()){const c=cases[index];closedRole(item.observation,f);assert.equal(item.nativeMatched,!c.refused);assert.deepEqual(item.observation,c.refused?{state:'CURRENT_REFUSAL',predicate:'writeOutsideTrustSet',location:c.location,ownerClass:'owner'}:matched);}
}));
test('public Windows default preflight adds only the separate closed current-observation report',{skip:process.platform!=='win32'},()=>fixture(f=>{
 const encrypted=join(f.directory,'public.dpapi');writeFileSync(encrypted,'PRIVATE-PUBLIC-CIPHERTEXT-MARKER');const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',timeout:35000,env:{...process.env,JARVIS_PRODUCTION_CONFIG:encrypted}});assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');const value=JSON.parse(run.stdout.trim());closedDetails(value.rotationProtectionFailureDetails,f);assert.equal(value.rotationProtectionDiagnostics.schemaVersion,1);assert.deepEqual(Object.keys(value.rotationMetadata).sort(),[...metadataFields].sort());assert.equal(value.rotationMetadata.readyForRotation,false);assert.doesNotMatch(run.stdout,/PRIVATE-PUBLIC-CIPHERTEXT-MARKER/);
}));
