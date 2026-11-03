import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,symlinkSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const script=resolve('scripts/owner-code-preflight-1218.ps1');
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
function ps(code){const r=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; . ${quote(script)}; ${code}`],{encoding:'utf8',timeout:25000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());}
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'owner-preflight-'));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
test('encrypted-byte metadata is read only and never emits contents',()=>fixture(dir=>{
 const f=join(dir,'config.dpapi'),value='never-disclose-fixture-owner-value';writeFileSync(f,value);
 const result=ps(`Get-1218FileMetadata ${quote(f)} | ConvertTo-Json -Compress`);
 assert.equal(result.state,'regular');assert.equal(result.sha256,createHash('sha256').update(value).digest('hex'));assert.equal(JSON.stringify(result).includes(value),false);assert.equal(readFileSync(f,'utf8'),value);
}));
test('metadata refuses directories, oversized files and missing files',()=>fixture(dir=>{
 const f=join(dir,'large.dpapi');writeFileSync(f,'123456');
 assert.equal(ps(`Get-1218FileMetadata ${quote(dir)} | ConvertTo-Json -Compress`).state,'not-regular');
 assert.equal(ps(`Get-1218FileMetadata ${quote(f)} -Limit 3 | ConvertTo-Json -Compress`).state,'oversize');
 assert.equal(ps(`Get-1218FileMetadata ${quote(join(dir,'missing.dpapi'))} | ConvertTo-Json -Compress`).state,'missing');
}));
test('metadata refuses UNC, relative and alternate data stream paths',()=>{
 for(const path of ['\\\\untrusted.invalid\\share\\config.dpapi','relative/config.dpapi','C:\\safe\\config.dpapi:stream'])assert.equal(ps(`Get-1218FileMetadata ${quote(path)} | ConvertTo-Json -Compress`).state,'rejected-path');
});
test('metadata refuses a reparse point in any ancestor',()=>fixture(dir=>{
 const target=join(dir,'real'),link=join(dir,'link');mkdirSync(target);writeFileSync(join(target,'config.dpapi'),'unchanged');symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 assert.equal(ps(`Get-1218FileMetadata ${quote(join(link,'config.dpapi'))} | ConvertTo-Json -Compress`).state,'reparse');
}));
test('reviewed artifacts reject drift before plan execution',()=>fixture(dir=>{
 mkdirSync(join(dir,'scripts'));for(const n of ['owner-code-windows.ps1','read-jarvis-production-config.ps1','rotate-jarvis-owner-code-windows.ps1','install-owner-code-windows.ps1'])copyFileSync(resolve('scripts',n),join(dir,'scripts',n));
 writeFileSync(join(dir,'scripts/rotate-jarvis-owner-code-windows.ps1'),'throw "unreviewed must not execute"');
 assert.equal(ps(`try { Get-1218ReviewedArtifacts ${quote(dir)} | Out-Null; 'false' } catch { 'true' }`),true);
}));
test('pinned rotation really executes with no arguments and remains plan only',()=>{
 const result=ps(`Invoke-1218PlanOnly ${quote(resolve('.'))} | ConvertTo-Json -Compress`);assert.equal(result.expectedOutputMatched,true);assert.equal(result.exitCode,0);assert.equal(result.noArguments,true);
});
test('native Windows entry probes a temporary encrypted-blob metadata fixture without content disclosure',{skip:process.platform!=='win32'},()=>fixture(dir=>{
 const f=join(dir,'config.dpapi'),marker='not-a-real-secret-do-not-publish';writeFileSync(f,marker);
 const r=spawnSync(shell,['-NoProfile','-NonInteractive','-File',script],{encoding:'utf8',timeout:35000,env:{...process.env,JARVIS_PRODUCTION_CONFIG:f}});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout.trim());
 assert.equal(v.encryptedConfiguration.state,'regular');assert.equal(v.encryptedConfiguration.sha256,createHash('sha256').update(marker).digest('hex'));assert.equal(v.actualDpapiUsed,false);assert.equal(v.secretDisplayed,false);assert.equal(v.databaseOpened,false);assert.equal(v.originalAcceptanceConditionsPassed,0);assert.equal((r.stdout+r.stderr).includes(marker),false);assert.equal(readFileSync(f,'utf8'),marker);
}));
test('native acceptance workflow no longer opens historical Goal state or runs its workspace',()=>{
 const text=readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8');assert.doesNotMatch(text,/zbook-goal-diagnostics|zbook-isolated-test-diagnostic/);assert.match(text,/owner-code-preflight-1218\.ps1/);assert.match(text,/goriq-pc-approved-source\.mjs/);assert.match(text,/iphone-owner-visibility-1218\.mjs/);assert.doesNotMatch(text,/secrets\.|permissions:\s*write|ExecutionPolicy Bypass|approve_ephemeral_pairing/);
});

for(const mixed of [String.raw`/\untrusted.invalid\share\config.dpapi`,String.raw`\/untrusted.invalid\share\config.dpapi`])test('mixed UNC separators are rejected before any filesystem lookup: '+mixed,()=>{
 const r=ps(`$script:lookup=$false; function Test-Path { $script:lookup=$true; throw 'NO_REMOTE_LOOKUP' }; $m=Get-1218FileMetadata ${quote(mixed)}; @{state=$m.state;lookup=$script:lookup} | ConvertTo-Json -Compress`);assert.equal(r.state,'rejected-path');assert.equal(r.lookup,false);
});
test('reparse ancestors are rejected before looking up their child',()=>fixture(dir=>{
 const target=join(dir,'real'),link=join(dir,'link'),child=join(link,'config.dpapi');mkdirSync(target);writeFileSync(join(target,'config.dpapi'),'unchanged');symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 const r=ps(`$script:childLookup=$false; function Get-Item { param([string]$LiteralPath,[switch]$Force) if ($LiteralPath -ceq ${quote(child)}) { $script:childLookup=$true }; Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath -Force }; $m=Get-1218FileMetadata ${quote(child)}; @{state=$m.state;childLookup=$script:childLookup} | ConvertTo-Json -Compress`);assert.equal(r.state,'reparse');assert.equal(r.childLookup,false);
}));
