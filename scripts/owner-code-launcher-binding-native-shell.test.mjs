import assert from 'node:assert/strict';
import test from 'node:test';
import {copyFileSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const suite='scripts/owner-code-launcher-binding-native-shell.test.mjs';
const worker='owner-code-launcher-binding-inspection-1218.ps1';
const workflow=readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8');
const entry=workflow.split(/^ {6}- /m).find(step=>step.startsWith('name: Inspect separately approved fixed launcher bindings as data only\n'));
assert.ok(entry,'the existing bounded native launcher inspection step is required');
const shell=entry.match(/^ {8}shell: (.+)$/m)?.[1];
const body=entry.match(/^ {8}run: \|\n((?: {10}.*\n)+)/m)?.[1].split('\n').map(line=>line.slice(10)).join('\n');
assert.ok(shell);assert.ok(body);
const executable=shell.match(/^(\S+) /)?.[1];
const argumentsFormat=shell.slice(executable.length+1);
const windowsOnly=process.platform==='win32'?false:'requires actual Windows PowerShell 5 and its native command-line parsing';
const trustedPowerShell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function assertPublicEntry(){
 assert.equal(executable,trustedPowerShell);
 assert.ok([
  `${trustedPowerShell} -NoLogo -NoProfile -NonInteractive -File {0}`,
  `${trustedPowerShell} -NoLogo -NoProfile -NonInteractive -Command "& ([scriptblock]::Create([System.IO.File]::ReadAllText('{0}')))"`,
  `${trustedPowerShell} -NoLogo -NoProfile -NonInteractive -Command "$env:PSModulePath=[System.IO.Path]::Combine($PSHOME,'Modules'); & ([scriptblock]::Create([System.IO.File]::ReadAllText('{0}')))"`,
 ].includes(shell),'only the reviewed fixed interpreter/public-wrapper argument formats may execute');
 const prefix="$ErrorActionPreference = 'Stop'\nNew-Item -ItemType Directory -Force -Path .gai-results | Out-Null\n";
 const suffix=' | Tee-Object -FilePath .gai-results/owner-code-launcher-bindings-1218.json\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n';
 assert.ok([
  prefix+'& .\\scripts\\'+worker+' -Inspect'+suffix,
  prefix+`& '${trustedPowerShell}' -NoLogo -NoProfile -NonInteractive -File .\\scripts\\${worker} -Inspect`+suffix,
 ].includes(body),'only the reviewed public worker/closed-result run bodies may execute');
}

function executeWrapper(root,publicBody){
 assertPublicEntry();
 const wrapper=join(root,'actions-generated-public-body');
 writeFileSync(wrapper,publicBody);
 // The runner substitutes the path into one raw argument string. Preserve that
 // Windows parsing boundary; splitting/requoting it here could hide this bug.
 return spawnSync(executable,[argumentsFormat.replace('{0}',wrapper)],{
  cwd:root,encoding:'utf8',timeout:15000,windowsVerbatimArguments:true,shell:false,
  env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR??process.env.SystemRoot,TEMP:root,TMP:root,PATHEXT:'.EXE',GORIQ_OWNER_LAUNCHER_BINDING_GRANT_BASE64:''},
 });
}
function artifactText(path){
 const bytes=readFileSync(path);
 return bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8').replace(/^\uFEFF/,'');
}

test('the native shell keeps its fixed trusted interpreter and receives only the public runner wrapper',()=>{
 assertPublicEntry();
 for(const flag of ['-NoLogo','-NoProfile','-NonInteractive'])assert.ok(argumentsFormat.includes(flag),flag);
 assert.equal(argumentsFormat.match(/\{0\}/g)?.length,1);
 assert.doesNotMatch(shell,/\$\{\{|ExecutionPolicy|EncodedCommand|Invoke-Expression|https?:|\b(?:node|cmd|pwsh)\b|Start-Process/i);
 assert.doesNotMatch(body,/\$\{\{|ExecutionPolicy|EncodedCommand|Invoke-Expression|https?:|--apply|AuthorizationPath|runtime-receipt|launch-current/i);
 assert.match(body,/-Inspect \| Tee-Object -FilePath \.gai-results\/owner-code-launcher-bindings-1218\.json\n/);
 assert.match(body,/if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/);
});

test('both existing hosted Windows test routes exercise the native entry regression with LF bytes',()=>{
 for(const path of ['.github/workflows/ci.yml','.github/workflows/goriq-owner-rotation-acceptance-1218.yml']){
  assert.ok(readFileSync(path,'utf8').split('\n').some(line=>line.includes('node --test')&&line.includes(suite)),path);
 }
 assert.ok(readFileSync('.gitattributes','utf8').split('\n').includes(suite+' text eol=lf'));
});

test('the exact Windows shell executes extensionless public wrappers in a path with spaces and preserves their exit codes',{skip:windowsOnly},()=>{
 const root=mkdtempSync(join(tmpdir(),'goriq public native shell 1218-'));
 try{
  for(const status of [0,7]){
   const run=executeWrapper(root,`[Console]::Out.WriteLine('PUBLIC_WRAPPER_REACHED'); exit ${status}\n`);
   assert.equal(run.error,undefined);
   assert.equal(run.status,status,run.stderr);
   assert.equal(run.stderr,'');
   assert.equal(run.stdout.trim(),'PUBLIC_WRAPPER_REACHED');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the exact Windows native run body retains closed empty-grant JSON through Tee and exits one before any private boundary',{skip:windowsOnly},()=>{
 const root=mkdtempSync(join(tmpdir(),'goriq public native grant 1218-'));
 try{
  mkdirSync(join(root,'scripts'));
  copyFileSync(resolve('scripts',worker),join(root,'scripts',worker));
  const run=executeWrapper(root,body);
  assert.equal(run.error,undefined);
  assert.equal(run.status,1,run.stderr);
  assert.equal(run.stderr,'');
  const expected={schemaVersion:1,issue:1218,operation:'launcher-binding-inspection',complete:false,failureCode:'LBI_GRANT_REQUIRED',sourceRevision:null,workflowRunId:null,workflowRunAttempt:null,sourceHashesVerified:false,publicCiVerified:false,actualWindowsOwnerContextVerified:false,taskBindingVerified:false,claimConsumed:false,exactlyTwoTargets:false,compatibilityStructure:'UNKNOWN',nativeStructure:'UNKNOWN',fixedDelegationMatched:false,nativeRelationCandidate:false,protectedLocalRecordWritten:false,noExecution:true,authorizationGranted:false,readyForRotation:false,actualAcceptanceConditionsPassed:0};
  assert.deepEqual(JSON.parse(run.stdout.trim()),expected);
  assert.deepEqual(JSON.parse(artifactText(join(root,'.gai-results','owner-code-launcher-bindings-1218.json')).trim()),expected);
  assert.deepEqual(readdirSync(root).sort(),['.gai-results','actions-generated-public-body','scripts']);
  assert.deepEqual(readdirSync(join(root,'.gai-results')),['owner-code-launcher-bindings-1218.json']);
  assert.deepEqual(readdirSync(join(root,'scripts')),[worker]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
