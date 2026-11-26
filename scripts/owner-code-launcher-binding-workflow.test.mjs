import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

const workflow=()=>readFileSync('.github/workflows/gai-zbook-diagnostic-1218.yml','utf8');
const job=(text,name)=>text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`,'m'))?.[1]??'';
const steps=text=>text.split(/^ {6}- /m).slice(1);
const field=(text,name,indent=8)=>text.match(new RegExp(`^ {${indent}}${name}: (.+)$`,'m'))?.[1];
const context={repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84'};
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const selected=bits=>Object.fromEntries(['rotation_only','owner_local_practical','warning_only','launcher_binding_only'].map((name,index)=>[name,Boolean(bits&(1<<index))]));
function enabled(expression,inputs,github=context){
 assert.ok(expression);return runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g,''),{inputs,github,always:()=>true},{timeout:100});
}
function active(inputs){return steps(job(workflow(),'inspect')).filter(step=>!field(step,'if')||enabled(field(step,'if'),inputs));}

test('launcher inspection is an explicit default-false fourth mode with a nonsecret grant input',()=>{
 const text=workflow(),block=text.match(/^ {6}launcher_binding_only:\n((?: {8,}.*\n)+)/m)?.[1];assert.ok(block);assert.match(block,/type: boolean\n {8}default: false/);
 assert.match(text,/^ {6}launcher_binding_grant_base64:\n(?: {8,}.*\n)* {8}type: string\n/m);
 assert.match(text,/^permissions:\n {2}contents: read\n/m);assert.doesNotMatch(text,/secrets\.|(?:contents|actions|id-token|pull-requests): write|ExecutionPolicy Bypass/);
 const inspect=job(text,'inspect');for(const github of [context,{...context,actor:'foreign'},{...context,repository:'foreign/AI-'},{...context,ref:'refs/heads/other'}])assert.equal(enabled(field(inspect,'if',4),selected(8),github),github===context);
});

test('the actual pre-checkout PowerShell guard enforces every four-mode combination',()=>{
 const all=steps(job(workflow(),'inspect')),guard=all[0];assert.match(guard,/^name: Require exclusive bounded native mode/);assert.match(all[1],/^uses: actions\/checkout@v5/);
 const body=guard.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1];assert.ok(body);const code=body.split('\n').map(line=>line.slice(10)).join('\n');
 const bindings=[...guard.matchAll(/^ {10}(GORIQ_\w+): (.+)$/gm)];assert.equal(bindings.length,4);
 for(let bits=0;bits<16;bits++){
  const inputs=selected(bits),env={...process.env,...Object.fromEntries(bindings.map(([,name,value])=>[name,String(enabled(value,inputs))]))};
  const run=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:10000,env});assert.equal(run.error,undefined);
  const refused=Object.values(inputs).filter(Boolean).length>1;assert.equal(run.status,refused?1:0,JSON.stringify({bits,stderr:run.stderr}));if(refused)assert.match(run.stderr,/OWNER_ACCEPTANCE_MODES_EXCLUSIVE/);else assert.equal(run.stderr,'');
 }
});

test('only the inspection mode reaches one fixed trusted-PowerShell private entry and one closed artifact',()=>{
 const text=workflow(),inspection='owner-code-launcher-binding-inspection-1218.ps1',native=active(selected(8));
 const privateEntries=native.filter(step=>step.includes(inspection));assert.equal(privateEntries.length,1);
 const entry=privateEntries[0];assert.match(field(entry,'shell'),/^'?C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe /i);assert.match(field(entry,'shell'),/-NoProfile/);assert.match(field(entry,'shell'),/-NonInteractive/);assert.match(entry,/-Inspect/);
 assert.match(entry,/GORIQ_OWNER_LAUNCHER_BINDING_GRANT_BASE64: \$\{\{ inputs\.launcher_binding_grant_base64 \}\}/);
 for(const step of native){assert.doesNotMatch(step,/uses: actions\/setup-node|run: node |node scripts\/|owner-code-preflight-1218|owner-code-practical-1218|owner-code-warning-1218|owner-code-rotation-native-1218/);}
 const artifacts=native.filter(step=>step.includes('uses: actions/upload-artifact@'));assert.equal(artifacts.length,1);assert.match(artifacts[0],/name: goriq-owner-1218-launcher-bindings\n/);assert.match(artifacts[0],/\/\.gai-results\/owner-code-launcher-bindings-1218\.json\n/);assert.doesNotMatch(artifacts[0],/\*|\.claim|receipt|findings|scope\.json/);
 for(const bits of [0,1,2,4])assert.equal(active(selected(bits)).some(step=>step.includes(inspection)),false);
 const phone=job(text,'iphone-visibility');assert.equal(enabled(field(phone,'if',4),selected(8)),false);
});

test('inspection cannot bypass fresh source materialization or smuggle an executable through inputs',()=>{
 const all=steps(job(workflow(),'inspect')),entry=all.findIndex(step=>step.includes('owner-code-launcher-binding-inspection-1218.ps1'));assert.ok(entry>1);assert.match(all[1],/persist-credentials: false/);
 assert.match(all[entry],/working-directory: owner-native-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
 assert.doesNotMatch(all[entry],/run:\s*\$\{\{|AuthorizationPath:\s*\$\{\{|runtimeScope|ConvertTo-Json|credentialRotationApproval|--run|--apply/);
 assert.equal(enabled(field(job(workflow(),'inspect'),'timeout-minutes',4),selected(8)),5);
});

test('both existing hosted Windows routes run the inspector fixtures and keep the inspector default inert',()=>{
 for(const path of ['.github/workflows/ci.yml','.github/workflows/goriq-owner-rotation-acceptance-1218.yml']){
  const text=readFileSync(path,'utf8');for(const suite of ['owner-code-launcher-binding-inspection-1218.test.mjs','owner-code-launcher-binding-workflow.test.mjs'])assert.ok(text.split('\n').some(line=>line.includes('node --test')&&line.includes(suite)),`${path}: ${suite}`);
  assert.doesNotMatch(text,/owner-code-launcher-binding-inspection-1218\.ps1 -Inspect|GORIQ_OWNER_LAUNCHER_BINDING_GRANT_BASE64/);
 }
 const attributes=readFileSync('.gitattributes','utf8');for(const path of ['scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.test.mjs','scripts/owner-code-launcher-binding-workflow.test.mjs'])assert.equal(attributes.split('\n').includes(path+' text eol=lf'),true,path);
});
