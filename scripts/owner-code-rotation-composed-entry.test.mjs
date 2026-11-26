import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {existsSync} from 'node:fs';
async function fleetFixture(t){
 const {DatabaseSync}=await import('node:sqlite');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rotation-controller-public-')),dbPath=path.join(directory,'fleet.db'),db=new DatabaseSync(dbPath);
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE jarvis_state(id INTEGER PRIMARY KEY CHECK(id = 1),payload TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT; CREATE TABLE jarvis_worker_identity(node_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT; CREATE TABLE jarvis_worker_nonce(node_id TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(node_id,nonce)) STRICT; CREATE INDEX jarvis_worker_nonce_expires_at ON jarvis_worker_nonce(expires_at)');
 const at='2026-11-03T18:00:00.000Z',publicKeyPem='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n';
 const fleet=Array.from({length:38},(_,i)=>({id:'PUBLIC-CONTROLLER-'+i,label:'Public fixture '+i,kind:'android',status:'ready',capabilities:['device-status'],policy:{allowPaidServices:false,allowDestructiveActions:false,allowExternalPublication:false,allowRemoteControl:false,requireHumanForLockedDevice:true},telemetry:{checkedAt:at},enrollment:'full',lastSeenAt:at}));
 const state={generatedAt:at,fleet,tasks:[],activeTakeovers:[],audit:[],stats:{registered:38,ready:38,offline:0,needsHuman:0,queued:0,running:0,completed:0,failed:0}};
 db.prepare('INSERT INTO jarvis_state VALUES(1,?,?)').run(JSON.stringify(state),at);
 for(const node of fleet)db.prepare('INSERT INTO jarvis_worker_identity VALUES(?,?,?)').run(node.id,JSON.stringify({nodeId:node.id,publicKeyPem,enrolledAt:at,algorithm:'ed25519'}),at);
 return {db,dbPath,state,save(){db.prepare('UPDATE jarvis_state SET payload=? WHERE id=1').run(JSON.stringify(state));}};
}
// Regresses dropped/misordered exercise IPC, false preservation credit and
// private output while running the actual unchanged transaction on owned files.
test('composed owned Node PowerShell SQLite exercise preserves both planned and natural recovery meanings',{timeout:60000},async()=>{
 assert.equal(existsSync('scripts/owner-code-rotation-exercise.mjs'),true,'operation-specific composed entry is missing');
 const {RotationExerciseFleetSession}=await import('./owner-code-rotation-exercise.mjs');
 const cleanup=[],outcomes=[];
try{for(const scenario of ['success','new-login-failed']){
 const f=await fleetFixture({after:fn=>cleanup.push(fn)}),session=new RotationExerciseFleetSession({dbPath:f.dbPath,configSha256:'c'.repeat(64),taskSha256:'d'.repeat(64),runtimeRevision:'e'.repeat(40),cohortAuthority:{kind:'approved-active-capture',expectedCount:38},pcSidecars:{profile:'jarvis-pc-sidecars-v1',expectedTaskFile:'absent',expectedObservationFile:'absent'}},'0'.repeat(64));
 const directory=mkdtempSync(join(tmpdir(),'rotation-protocol-probe-')),script=join(directory,'public.ps1');cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
 let text=readFileSync('tests/owner-code-rotation-exercise.fixture.ps1','utf8');const a=text.indexOf(' $originalCheckpoint=$checkpoint'),b=text.indexOf(' $value=Invoke-OwnerRotationExercise',a);
 text=text.slice(0,a)+` $checkpoint={param($Event) [Console]::Out.WriteLine((@{event=$Event}|ConvertTo-Json -Compress));[Console]::Out.Flush();$read=[Console]::In.ReadLineAsync();if(-not $read.Wait(15000)){throw 'PUBLIC_PROTOCOL_TIMEOUT'};$ack=$read.Result|ConvertFrom-Json;if(@($ack.PSObject.Properties).Count -ne 2 -or $ack.event -cne $Event -or $ack.accepted -isnot [bool]){throw 'PUBLIC_PROTOCOL_INVALID'};return $ack.accepted}\n`+text.slice(b);
 const c=text.indexOf(' $current=[IO.File]::ReadAllText',text.indexOf(' $value=Invoke'));
 text=text.slice(0,c)+` [Console]::Out.WriteLine((@{event='result';result=$value}|ConvertTo-Json -Depth 8 -Compress))\n}finally{[IO.Directory]::Delete($root,$true)}\n`;
 writeFileSync(script,'\ufeff'+text);const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh',child=spawn(shell,['-NoProfile','-NonInteractive','-File',script,'-SourcePath',resolve('scripts/owner-code-rotation-exercise.ps1'),'-Case',scenario,'-FleetPath',f.dbPath],{stdio:['pipe','pipe','pipe'],timeout:30000});let output='',stderr='',pending='',report,problem;const events=[];
 child.stderr.on('data',chunk=>stderr+=chunk);child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;pending+=chunk;let end;while((end=pending.indexOf('\n'))!==-1){const wire=pending.slice(0,end).trim();pending=pending.slice(end+1);if(!wire)continue;try{const message=JSON.parse(wire);if(message.event==='result')report=session.finishExercise(message.result);else{events.push(message.event);child.stdin.write(JSON.stringify(session.accept(message))+'\n');}}catch(error){problem=error;child.stdin.end();}}});
 const status=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code)=>done(code));});assert.equal(status,0,stderr);assert.equal(stderr,'');assert.equal(problem,undefined);assert.equal(pending.trim(),'');assert.ok(report);assert.equal(report.complete,scenario==='success');assert.equal(report.fleetSqlitePreserved,true);assert.equal(report.pcSidecarsPreserved,true);assert.doesNotMatch(JSON.stringify(report)+output,/PRIVATE_|PUBLIC-CONTROLLER|BEGIN PUBLIC KEY|fixture-original-owner-code|config\.dpapi|broker\.sqlite|fleet\.db/);
 outcomes.push({scenario,complete:report.complete,forwardComplete:report.exercise.rotation.complete,plannedRestorationVerified:report.exercise.restoration.complete,naturalRecoveryVerified:report.exercise.rotation.rollbackVerified,preservationVerified:report.fleetSqlitePreserved,events,privateOutput:false});
}
assert.deepEqual(outcomes.map(x=>({scenario:x.scenario,complete:x.complete,planned:x.plannedRestorationVerified,natural:x.naturalRecoveryVerified,preserved:x.preservationVerified,privateOutput:x.privateOutput})),[{scenario:'success',complete:true,planned:true,natural:false,preserved:true,privateOutput:false},{scenario:'new-login-failed',complete:false,planned:false,natural:true,preserved:true,privateOutput:false}]);
}finally{for(const fn of cleanup.reverse())fn();}
});
