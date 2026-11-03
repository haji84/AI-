import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
function client(){
 const source=resolve('scripts/rotate-jarvis-owner-code-windows.ps1');
 const code=`$ErrorActionPreference='Stop'; $tokens=$null; $errors=$null; $ast=[Management.Automation.Language.Parser]::ParseFile(${quote(source)},[ref]$tokens,[ref]$errors); if (@($errors).Count -ne 0) { throw 'source parse' }; $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-LocalOwnerLogin'},$true); if (-not $definition) { throw 'login client missing' }; . ([scriptblock]::Create($definition.Extent.Text)); function Get-ScheduledTask { param($TaskName) [pscustomobject]@{State='Running'} }; function Start-Sleep { param([int]$Seconds) }; $taskName='public-fixture-no-task-operation'; $ok=Test-LocalOwnerLogin 'PUBLIC-ROTATION-TRANSPORT-FIXTURE-123456'; @{loginVerified=($ok -eq $true)} | ConvertTo-Json -Compress`;
 return new Promise((fulfil,reject)=>{const child=spawn(shell,['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('bounded public transport fixture timeout'));},20000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',status=>{clearTimeout(timer);try{assert.equal(status,0,err);assert.equal((out+err).includes('PUBLIC-ROTATION-TRANSPORT-FIXTURE'),false);fulfil(JSON.parse(out.trim()));}catch(e){reject(e);}});});
}
function listen(server,port){return new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});}
function close(server){return new Promise(done=>server.close(done));}
test('rotation login verifies locally and never forwards the code through redirects',async()=>{
 let mode='direct',originCalls=0,forwarded=0,receivedDummy=false;
 const sink=createServer(async(req,res)=>{for await(const chunk of req)void chunk;forwarded++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});
 const origin=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;originCalls++;receivedDummy ||=new URLSearchParams(body).get('passcode')==='PUBLIC-ROTATION-TRANSPORT-FIXTURE-123456';if(mode==='redirect'){res.writeHead(307,{Location:`http://127.0.0.1:${sink.address().port}/different-origin`});res.end();}else{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');}});
 await listen(sink,0);
 try{await listen(origin,3000);assert.deepEqual(await client(),{loginVerified:true});assert.equal(receivedDummy,true);assert.equal(forwarded,0);mode='redirect';originCalls=0;const response=await client();assert.equal(forwarded,0,'Owner login code must never be forwarded to another HTTP origin');assert.equal(response.loginVerified,false,'A redirect must not verify the local login');assert.ok(originCalls>0,'The real local HTTP request must execute');}
 finally{await close(origin);await close(sink);}
});
