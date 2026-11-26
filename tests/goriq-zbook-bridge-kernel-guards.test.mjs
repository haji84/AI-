// Real compilation and pure native-boundary decisions; no Win32 I/O is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
const program=`Add-Type -Path ./scripts/goriq-zbook-bridge-capture.cs
$valid=@('C:\\Users\\owner','C:\\','D:\\Users\\Owner\\AppData\\Local\\GAIWorker\\goal-1218-bridge-state\\compass.sqlite')
$invalid=@('C:\\Users\\owner\\..\\other','C:\\Users\\owner\\.\\file','C:\\Users\\owner\\file:stream','\\\\server\\share','C:\\Users\\owner\\CON','C:\\Users\\owner\\a.','C:\\Users\\owner\\a ','C:\\\\Users\\owner','C:/Users/owner','C:\\Users\\owner\\file*','1:\\Users\\owner')
$runtimeMethod=[GoriqBridgeCapture].GetMethod('RuntimeDirectoryAcePermitted')
$runtimeAcl=@();if($null -ne $runtimeMethod){$runtimeAcl=@([GoriqBridgeCapture]::RuntimeDirectoryAcePermitted('S-1-5-11',4,$true),[GoriqBridgeCapture]::RuntimeDirectoryAcePermitted('S-1-5-11',64,$true),[GoriqBridgeCapture]::RuntimeDirectoryAcePermitted('S-1-5-11',4,$false),[GoriqBridgeCapture]::RuntimeDirectoryAcePermitted('S-1-5-11',1,$false))}
$method=[GoriqBridgeCapture].GetMethod('AcePermitted')
$acl=@()
if($null -ne $method){
 $acl=@([GoriqBridgeCapture]::AcePermitted('S-1-5-21-1',1,$true,$false,'S-1-5-21-1'),[GoriqBridgeCapture]::AcePermitted('S-1-1-0',1,$true,$false,'S-1-5-21-1'),[GoriqBridgeCapture]::AcePermitted('S-1-1-0',2,$false,$true,'S-1-5-21-1'),[GoriqBridgeCapture]::AcePermitted('S-1-1-0',1,$false,$true,'S-1-5-21-1'),[GoriqBridgeCapture]::AcePermitted('S-1-5-32-544',[uint32]::MaxValue,$true,$false,'S-1-5-21-1'),[GoriqBridgeCapture]::AcePermitted('S-1-5-21-1',2,$false,$true,'S-1-5-21-1'))
}
[ordered]@{valid=@($valid|ForEach-Object {[GoriqBridgeCapture]::CanonicalLocalPath($_)});invalid=@($invalid|ForEach-Object {[GoriqBridgeCapture]::CanonicalLocalPath($_)});acl=$acl;runtimeAcl=$runtimeAcl}|ConvertTo-Json -Compress
`;
test('compiled kernel boundary accepts only canonical local names and rejects untrusted private/runtime ACEs',()=>{
 const r=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',program],{encoding:'utf8',timeout:10000,env:process.env});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.stderr,'');const value=JSON.parse(r.stdout);assert.deepEqual(value.valid,[true,true,true]);assert.ok(value.invalid.every(v=>v===false));assert.deepEqual(value.acl,[true,false,false,true,true,false]);assert.deepEqual(value.runtimeAcl,[true,false,false,true]);
});
test('shared acquisition validates three complete byte observations and native change time before querying',()=>{
 const s=readFileSync('scripts/goriq-zbook-bridge-capture.cs','utf8');assert.match(s,/FILE_SHARE_READWRITEDELETE/);assert.match(s,/GetFileInformationByHandleEx/);assert.match(s,/ChangeTime/);assert.match(s,/OBSERVED_STABLE_SHARED/);assert.match(s,/beforeHash/);assert.match(s,/capturedHash/);assert.match(s,/afterHash/);
});

test('private frozen and staged bytes retain the verified creation stream without metadata-only reopen gap',()=>{
 const source=readFileSync('scripts/goriq-zbook-bridge-capture.cs','utf8'),body=source.split('void WriteNew(')[1].split('public void Stage')[0];
 assert.match(body,/streams.Add\(stream\)/);assert.doesNotMatch(body,/using\(var stream|Open\(path,false,true/);
 assert.match(source,/WriteNew\(Path.Combine\(Root,"work",names\[n\]\),bytes,FILE_SHARE_READWRITEDELETE\)/);
 assert.match(source,/public void VerifyRuntime\(/);
 const adapter=readFileSync('scripts/goriq-zbook-bridge-original-read.ps1','utf8');assert.ok(adapter.indexOf('$Capture.VerifyRuntime()')<adapter.indexOf('if(-not $child.Start())'));
});
