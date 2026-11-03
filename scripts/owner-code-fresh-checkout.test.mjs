import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const source=resolve('scripts/owner-code-preflight-1218.ps1');const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';const quote=s=>"'"+s.replaceAll("'","''")+"'";
function runPS(code,restricted=false){const r=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ${restricted?"$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage';":''} . ${quote(source)}; ${code}`],{encoding:'utf8',timeout:25000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());}
test('each native run attempt owns a fresh source directory, every execution and artifact is bound to it',()=>{
 const s=readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8'),fresh='owner-native-${{ github.run_id }}-${{ github.run_attempt }}';
 assert.equal(s.split('path: '+fresh+'\n').length-1,2);assert.equal(s.split('working-directory: '+fresh+'\n').length-1,4);assert.equal(s.split('path: '+fresh+'/.gai-results/').length-1,2);
 assert.notEqual(fresh.replace('${{ github.run_attempt }}','1'),fresh.replace('${{ github.run_attempt }}','2'));assert.doesNotMatch(s,/inputs:|ExecutionPolicy Bypass|LanguageMode\s*=/);
});
test('safe failure JSON keeps a fixed stage and language mode without raw exception contents',()=>{
 const r=runPS("New-1218FailureReport -Stage 'source-artifacts' -ReasonCode 'SECRET_ERROR_MUST_NOT_LEAK' -FailureLine 12 | ConvertTo-Json -Depth 6 -Compress");assert.equal(r.complete,false);assert.equal(r.failedStage,'source-artifacts');assert.equal(r.reasonCode,'PREFLIGHT_RUNTIME_ERROR');assert.equal(r.failureLine,12);assert.equal(r.originalAcceptanceConditionsPassed,0);assert.equal(JSON.stringify(r).includes('SECRET_ERROR_MUST_NOT_LEAK'),false);
});
test('failure JSON remains available in a deliberately restricted child without relaxing its mode',()=>{
 const r=runPS("New-1218FailureReport -Stage 'source-artifacts' -ReasonCode 'UNREVIEWED_SOURCE' | ConvertTo-Json -Depth 6 -Compress",true);assert.equal(r.languageMode,'ConstrainedLanguage');assert.equal(r.reasonCode,'UNREVIEWED_SOURCE');assert.equal(r.complete,false);
});
test('fresh materialization preserves full source identity after an eol-policy transition',()=>{
 const d=mkdtempSync(join(tmpdir(),'owner-checkout-'));const names=['owner-code-windows.ps1','read-jarvis-production-config.ps1','rotate-jarvis-owner-code-windows.ps1'];
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=(cwd,args)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:'pipe'}).trim();
 try{const seed=join(d,'seed');mkdirSync(seed);mkdirSync(join(seed,'scripts'));for(const n of names)copyFileSync(resolve('scripts',n),join(seed,'scripts',n));git(seed,['init']);git(seed,['config','user.name','Fixture']);git(seed,['config','user.email','fixture@example.invalid']);git(seed,['config','core.autocrlf','false']);git(seed,['add','.']);git(seed,['commit','-m','old']);const old=git(seed,['rev-parse','HEAD']);writeFileSync(join(seed,'.gitattributes'),names.map(n=>'scripts/'+n+' text eol=lf').join('\n')+'\n');git(seed,['add','.gitattributes']);git(seed,['commit','-m','exact LF']);const current=git(seed,['rev-parse','HEAD']);
 const existing=join(d,'existing');git(d,['clone','--shared','--no-checkout',seed,existing]);git(existing,['config','core.autocrlf','true']);git(existing,['checkout','--force',old]);git(existing,['checkout','--force',current]);
 const fresh=join(d,'fresh');git(d,['clone','--shared','--no-checkout',seed,fresh]);git(fresh,['config','core.autocrlf','true']);git(fresh,['checkout','--force',current]);
 for(const n of names){const expected=createHash('sha256').update(readFileSync(resolve('scripts',n))).digest('hex');const actual=createHash('sha256').update(readFileSync(join(fresh,'scripts',n))).digest('hex');assert.equal(actual,expected);}
 const verified=runPS(`@(Get-1218ReviewedArtifacts ${quote(fresh)}).Count | ConvertTo-Json -Compress`);assert.equal(verified,3);
 }finally{rmSync(d,{recursive:true,force:true});}
});
