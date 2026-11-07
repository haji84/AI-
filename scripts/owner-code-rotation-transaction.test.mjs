import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const source=resolve('scripts/rotate-jarvis-owner-code-windows.ps1');
const fixture=resolve('tests/owner-code-rotation-transaction.fixture.ps1');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
test('rotation definitions import without output, environment changes, exit or native work',()=>{
 const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',`$before=$env:PSModulePath;. ${quote(source)};@{continued=$true;environmentUnchanged=($env:PSModulePath -ceq $before);transactionDefined=([bool](Get-Command Invoke-OwnerRotationTransaction -ErrorAction SilentlyContinue))}|ConvertTo-Json -Compress`],{encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{continued:true,environmentUnchanged:true,transactionDefined:true});
});
for(const scenario of ['success','no-pc-approval','pc-sidecar-protection-drift','cancel','expired','future','overlong','source-drift','task-drift','before-rotation-rejected','validation-failed','expiry-during-validation','config-during-validation','config-after-candidate-created','new-login-failed','stop-failed','start-failed','before-commit-rejected','rollback-stop-failed','rollback-login-failed','backup-drift','current-config-drift','config-acl-drift','config-protection-drift','node-drift','source-ancestor-writable','restart-deadline-before-stop','restart-deadline-after-stop','before-commit-expiry','after-rollback-expiry','runtime-mismatch','release-mismatch','task-principal-mismatch','receipt-drift','receipt-drift-during-validation'])test('bounded production rotation transaction: '+scenario,()=>{
 const r=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',fixture,'-SourcePath',source,'-Case',scenario],{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');const v=JSON.parse(r.stdout);assert.equal(v.case,scenario);assert.equal(v.passed,true);assert.equal(v.actualProductionOrDPAPIOrUIOrNetworkUsed,false);assert.equal(v.realTemporaryFileReplace,true);assert.equal(v.sourceAlgorithmImported,true);assert.equal(v.rawSecretEmitted,false);
});
test('rotation worker is inert by default and exposes no production fault switches',()=>{
 const worker=resolve('scripts/owner-code-rotation-worker.ps1');const r=spawnSync(shell,['-NoProfile','-NonInteractive','-File',worker],{encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/^PLAN ONLY:/);assert.equal(r.stderr,'');assert.doesNotMatch(readFileSync(worker,'utf8'),/ForceFailure|TestOnly|SkipAuthority|SkipValidation|ExecutionPolicy\s+Bypass/);
});

test('worker retains its supplied public receipt across import before context refusal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rotation-worker-receipt-'));try{const path=join(dir,'scope.json');writeFileSync(path,'{"publicFixture":"never-a-credential"}');const r=spawnSync(shell,['-NoProfile','-NonInteractive','-File',resolve('scripts/owner-code-rotation-worker.ps1'),'-Apply','-AuthorizationPath',path],{encoding:'utf8',timeout:15000,env:{...process.env,OS:'fixture-not-Windows'}});assert.equal(r.error,undefined);assert.equal(r.status,1,r.stderr);assert.equal(r.stderr,'');const message=JSON.parse(r.stdout.trim());assert.equal(message.event,'result');assert.equal(message.result.failedStage,'context');assert.equal(r.stdout.includes('never-a-credential'),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('local login never starts inside request reserve or accepts a response after its deadline',()=>{
 const code=`. ${quote(source)};function Get-ScheduledTask {param($TaskName)[pscustomobject]@{State='Running'}};function Start-Sleep {param($Seconds)};$script:calls=0;function Invoke-WebRequest {param([switch]$UseBasicParsing,$MaximumRedirection,$Method,$Uri,$Headers,$Body,$TimeoutSec)$script:calls++;[Threading.Thread]::Sleep(4500);[pscustomobject]@{StatusCode=200;Content='{"ok":true}'}};$near=Test-LocalOwnerLogin 'PUBLIC-NOT-A-CREDENTIAL' ([datetimeoffset]::UtcNow.AddSeconds(1)) 1;$nearCalls=$script:calls;$late=Test-LocalOwnerLogin 'PUBLIC-NOT-A-CREDENTIAL' ([datetimeoffset]::UtcNow.AddSeconds(4.1)) 1;@{near=$near;nearCalls=$nearCalls;late=$late}|ConvertTo-Json -Compress`;
 const r=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{near:false,nearCalls:0,late:false});
});
