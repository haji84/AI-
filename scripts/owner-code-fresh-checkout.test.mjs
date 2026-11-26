import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const source=resolve('scripts/owner-code-preflight-1218.ps1');const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';const quote=s=>"'"+s.replaceAll("'","''")+"'";
function runPS(code,restricted=false){const r=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ${restricted?"$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage';":''} . ${quote(source)}; ${code}`],{encoding:'utf8',timeout:25000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());}
test('each native run attempt owns a fresh source directory, every execution and artifact is bound to it',()=>{
 const s=readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8'),fresh='owner-native-${{ github.run_id }}-${{ github.run_attempt }}';
 assert.equal(s.split('path: '+fresh+'\n').length-1,2);assert.equal(s.split('working-directory: '+fresh+'\n').length-1,8);assert.equal(s.split('path: '+fresh+'/.gai-results/').length-1,6);
 assert.notEqual(fresh.replace('${{ github.run_attempt }}','1'),fresh.replace('${{ github.run_attempt }}','2'));assert.doesNotMatch(s,/ExecutionPolicy Bypass|LanguageMode\s*=|run:\s*\$\{\{\s*inputs/);assert.match(s,/owner_local_practical:[\s\S]*default: false/);assert.match(s,/if: \$\{\{ inputs\.owner_local_practical == true && inputs\.rotation_only != true && inputs\.launcher_binding_only != true \}\}/);assert.match(s,/powershell\.exe -NoLogo -NoProfile -STA -NonInteractive -File scripts\/owner-code-practical-1218\.ps1 -Apply/);
});

const nativeWorkflow=()=>readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8');
const job=(text,name)=>text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1]??'';
const steps=text=>text.split(/^ {6}- /m).slice(1);
const field=(text,name,indent=8)=>text.match(new RegExp(`^ {${indent}}${name}: (.+)$`,'m'))?.[1];
const actualContext={repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84'};
function enabled(expression,inputs,github=actualContext){
 assert.ok(expression,'A bounded mode requires an explicit condition');
 return runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g,''),{inputs,github,always:()=>true},{timeout:100});
}
function selectors(rotation_only=false,owner_local_practical=false,warning_only=false){return {rotation_only,owner_local_practical,warning_only};}

test('real native pre-checkout guard rejects every multi-mode selection without executing later steps',()=>{
 const all=steps(job(nativeWorkflow(),'inspect')),guard=all[0];
 assert.match(guard,/^name: Require exclusive bounded native mode/);assert.match(all[1],/^uses: actions\/checkout@v5/);
 const body=guard.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1];assert.ok(body,'Executable guard body required');
 const code=body.split('\n').map(line=>line.slice(10)).join('\n');
 const bindings=[...guard.matchAll(/^ {10}(GORIQ_\w+): (.+)$/gm)];
 for(const [rotation,practical,warning,status] of [[false,false,false,0],[true,false,false,0],[false,true,false,0],[false,false,true,0],[true,true,false,1],[true,false,true,1],[false,true,true,1],[true,true,true,1]]){
  const input=selectors(rotation,practical,warning),env={...process.env,...Object.fromEntries(bindings.map(([,key,value])=>[key,String(enabled(value,input))]))};
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:10000,env});
  assert.equal(result.error,undefined);assert.equal(result.status,status,JSON.stringify({rotation,practical,warning,stderr:result.stderr}));
  if(status)assert.match(result.stderr,/OWNER_ACCEPTANCE_MODES_EXCLUSIVE/);else assert.equal(result.stderr,'');
 }
 assert.equal(bindings.length,4);
});

test('rotation selection retains main actor CI gates and selects only the fixed rotation entry and one artifact',()=>{
 const text=nativeWorkflow(),inspect=job(text,'inspect'),nativeSteps=steps(inspect),phone=job(text,'iphone-visibility');
 const inputBlock=text.match(/^ {6}rotation_only:\n((?: {8,}.*\n)+)/m)?.[1];assert.ok(inputBlock);assert.match(inputBlock,/type: boolean\n {8}default: false/);
 assert.match(text,/^permissions:\n {2}contents: read\n/m);assert.doesNotMatch(text,/secrets\.|(?:contents|actions|id-token|pull-requests): write|ExecutionPolicy Bypass/);
 for(const context of [actualContext,{...actualContext,repository:'foreign/AI-'},{...actualContext,ref:'refs/heads/other'},{...actualContext,actor:'foreign'}]){
  assert.equal(enabled(field(inspect,'if',4),selectors(true),context),context===actualContext);
 }
 const approved=nativeSteps.findIndex(step=>step.includes('run: node scripts/goriq-pc-approved-source.mjs'));assert.ok(approved>1);
 assert.match(nativeSteps[approved],/GORIQ_PC_APPROVED_REVISION: \$\{\{ github\.sha \}\}/);
 assert.equal(nativeSteps.findIndex(step=>step.includes('node scripts/owner-code-rotation-native-1218.mjs --run'))>approved,true);
 for(const [input,want] of [[selectors(),['preflight']],[selectors(false,true),['preflight','practical']],[selectors(false,false,true),['warning']],[selectors(true),['rotation']]]){
  const executed=nativeSteps.filter(step=>!field(step,'if')||enabled(field(step,'if'),input));
  const actions=executed.flatMap(step=>[['preflight','owner-code-preflight-1218.ps1'],['practical','owner-code-practical-1218.ps1 -Apply'],['warning','owner-code-warning-1218.mjs --run'],['rotation','owner-code-rotation-native-1218.mjs --run']].filter(([,command])=>step.includes(command)).map(([name])=>name));
  assert.deepEqual(actions,want);
  const artifacts=executed.filter(step=>step.includes('uses: actions/upload-artifact@'));
  assert.equal(artifacts.length,input.owner_local_practical?2:1);
  if(input.rotation_only){assert.match(artifacts[0],/name: goriq-owner-1218-rotation-only\n/);assert.match(artifacts[0],/path: owner-native-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/\.gai-results\/owner-code-rotation-native-1218\.json\n/);assert.doesNotMatch(artifacts[0],/\*|\.claim|scope\.json/);}
  assert.equal(enabled(field(phone,'if',4),input),!input.rotation_only&&!input.warning_only);
  assert.equal(enabled(field(inspect,'timeout-minutes',4),input),input.rotation_only?25:5);
 }
 const entry=nativeSteps.find(step=>step.includes('node scripts/owner-code-rotation-native-1218.mjs --run'));assert.ok(entry);
 assert.match(entry,/GORIQ_OWNER_ROTATION_SCOPE_BASE64: \$\{\{ inputs\.rotation_scope_base64 \}\}/);
 assert.match(text,/^ {6}rotation_scope_base64:\n(?: {8,}.*\n)* {8}type: string\n/m);
 assert.doesNotMatch(entry,/credentialRotationApproval|issuedAt|expiresAt|ConvertTo-Json|BIND_CURRENT|--apply|--authorization/);
});

test('existing Windows public source and CI routes include both native suites and inert default commands',()=>{
 for(const file of ['.github/workflows/ci.yml','.github/workflows/goriq-owner-rotation-acceptance-1218.yml']){
  const text=readFileSync(file,'utf8');
  for(const suite of ['scripts/owner-code-rotation-native-1218.test.mjs','scripts/owner-code-rotation-native-stage.test.mjs','scripts/owner-code-fresh-checkout.test.mjs']){
   const testRun=text.split('\n').find(line=>line.includes('node --test')&&line.includes(suite));assert.ok(testRun,`${file} must execute ${suite}`);
  }
  assert.match(text,/^ {10}node scripts\/owner-code-rotation-native-1218\.mjs\n/m);
  assert.match(text,/^ {10}powershell\.exe -NoProfile -NonInteractive -File scripts\/owner-code-rotation-native-1218\.ps1\n/m);
  assert.doesNotMatch(text,/owner-code-rotation-native-1218\.(?:mjs --run|ps1 -Prepare)|GORIQ_OWNER_ROTATION_SCOPE_BASE64/);
 }
 const attributes=readFileSync('.gitattributes','utf8');
 for(const file of ['scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-rotation-native-1218.test.mjs','scripts/owner-code-rotation-native-stage.test.mjs'])assert.equal(attributes.split('\n').includes(file+' text eol=lf'),true,`${file} must keep LF bytes`);
});
test('safe failure JSON keeps a fixed stage and language mode without raw exception contents',()=>{
 const r=runPS("New-1218FailureReport -Stage 'source-artifacts' -ReasonCode 'SECRET_ERROR_MUST_NOT_LEAK' -FailureLine 12 | ConvertTo-Json -Depth 6 -Compress");assert.equal(r.complete,false);assert.equal(r.failedStage,'source-artifacts');assert.equal(r.reasonCode,'PREFLIGHT_RUNTIME_ERROR');assert.equal(r.failureLine,12);assert.equal(r.originalAcceptanceConditionsPassed,0);assert.equal(JSON.stringify(r).includes('SECRET_ERROR_MUST_NOT_LEAK'),false);
});
test('failure JSON remains available in a deliberately restricted child without relaxing its mode',()=>{
 const r=runPS("New-1218FailureReport -Stage 'source-artifacts' -ReasonCode 'UNREVIEWED_SOURCE' | ConvertTo-Json -Depth 6 -Compress",true);assert.equal(r.languageMode,'ConstrainedLanguage');assert.equal(r.reasonCode,'UNREVIEWED_SOURCE');assert.equal(r.complete,false);
});
test('fresh materialization preserves full source identity after an eol-policy transition',()=>{
 const d=mkdtempSync(join(tmpdir(),'owner-checkout-'));const names=['owner-code-windows.ps1','read-jarvis-production-config.ps1','rotate-jarvis-owner-code-windows.ps1','install-owner-code-windows.ps1'];
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=(cwd,args)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:'pipe'}).trim();
 try{const seed=join(d,'seed');mkdirSync(seed);mkdirSync(join(seed,'scripts'));for(const n of names)copyFileSync(resolve('scripts',n),join(seed,'scripts',n));git(seed,['init']);git(seed,['config','user.name','Fixture']);git(seed,['config','user.email','fixture@example.invalid']);git(seed,['config','core.autocrlf','false']);git(seed,['add','.']);git(seed,['commit','-m','old']);const old=git(seed,['rev-parse','HEAD']);writeFileSync(join(seed,'.gitattributes'),names.map(n=>'scripts/'+n+' text eol=lf').join('\n')+'\n');git(seed,['add','.gitattributes']);git(seed,['commit','-m','exact LF']);const current=git(seed,['rev-parse','HEAD']);
 const existing=join(d,'existing');git(d,['clone','--shared','--no-checkout',seed,existing]);git(existing,['config','core.autocrlf','true']);git(existing,['checkout','--force',old]);git(existing,['checkout','--force',current]);
 const fresh=join(d,'fresh');git(d,['clone','--shared','--no-checkout',seed,fresh]);git(fresh,['config','core.autocrlf','true']);git(fresh,['checkout','--force',current]);
 for(const n of names){const expected=createHash('sha256').update(readFileSync(resolve('scripts',n))).digest('hex');const actual=createHash('sha256').update(readFileSync(join(fresh,'scripts',n))).digest('hex');assert.equal(actual,expected);}
 const verified=runPS(`@(Get-1218ReviewedArtifacts ${quote(fresh)}).Count | ConvertTo-Json -Compress`);assert.equal(verified,4);
 }finally{rmSync(d,{recursive:true,force:true});}
});
