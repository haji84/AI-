import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh',q=s=>"'"+s.replaceAll("'","''")+"'";
// Rejecting by character count alone admits multibyte receipts over the fixed
// byte limit; serializing PS wrappers can also lose or reject nested scope data.
test('entry JSON codec preserves nested public data and enforces the exact64KiB UTF8 output boundary',()=>{
 const directory=mkdtempSync(join(tmpdir(),'entry-json-public-')),file=join(directory,'public.ps1');
 const code=`$ErrorActionPreference='Stop';. ${q(resolve('scripts/owner-code-rotation-native-1218.ps1'))};$value=[pscustomobject]@{approval=$true;pc=[pscustomobject]@{profile='PUBLIC_CODEC_CANARY';expected='absent'};sources=[ordered]@{fixed=('c'*64)};tags=@('public','漢字')};$wire=ConvertTo-OwnerRotationEntryJson $value;$round=ConvertFrom-OwnerRotationEntryJson $wire;$roundTrip=$round.approval -is [bool] -and $round.approval -eq $true -and $round.pc.profile -ceq 'PUBLIC_CODEC_CANARY' -and $round.pc.expected -ceq 'absent' -and $round.sources.fixed -ceq ('c'*64) -and $round.tags.Count -eq 2 -and $round.tags[0] -ceq 'public' -and $round.tags[1] -ceq '漢字';$atLimit=([Text.Encoding]::UTF8.GetByteCount((ConvertTo-OwnerRotationEntryJson ('A'*65534))) -eq 65536);$asciiRejected=$false;$unicodeRejected=$false;try{$null=ConvertTo-OwnerRotationEntryJson ('A'*65535)}catch{$asciiRejected=$_.Exception.Message -ceq 'ROTATION_ENTRY_SCOPE_REQUIRED'};try{$null=ConvertTo-OwnerRotationEntryJson ('漢'*22000)}catch{$unicodeRejected=$_.Exception.Message -ceq 'ROTATION_ENTRY_SCOPE_REQUIRED'};@{roundTrip=[bool]$roundTrip;atLimit=[bool]$atLimit;asciiRejected=$asciiRejected;unicodeRejected=$unicodeRejected}|ConvertTo-Json -Compress`;
 writeFileSync(file,'\ufeff'+code);
 try{const run=spawnSync(shell,['-NoProfile','-NonInteractive','-File',file],{encoding:'utf8',timeout:15000});assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');assert.doesNotMatch(run.stdout,/PUBLIC_CODEC_CANARY|entry-json-public|[A-Z]:\\|configSha256|runtimeScopeSha256/);assert.deepEqual(JSON.parse(run.stdout),{roundTrip:true,atLimit:true,asciiRejected:true,unicodeRejected:true});}
 finally{rmSync(directory,{recursive:true,force:true});}
});
