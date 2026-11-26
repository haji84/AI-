import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const target=new URL('./owner-code-rotation-acceptance.mjs',import.meta.url);
const sourceNames=['owner-code-rotation-acceptance.mjs','owner-code-fleet-preservation.mjs','owner-code-pc-preservation.mjs','owner-code-rotation-worker.ps1','rotate-jarvis-owner-code-windows.ps1','read-jarvis-production-config.ps1','validate-jarvis-production-config.mjs','jarvis-production-config.mjs','jarvis-windows-install-paths.mjs'];
const current=Date.now();
function approved(){return {scopeId:'issue:1218:owner-code-rotation',ownerSid:'S-1-5-21-1-2-3-1004',issuedAt:new Date(current-1000).toISOString(),expiresAt:new Date(current+3600000).toISOString(),sourceRevision:'a'.repeat(40),sourceHashes:Object.fromEntries(sourceNames.map(name=>['scripts/'+name,'b'.repeat(64)])),configSha256:'c'.repeat(64),taskSha256:'d'.repeat(64),nodeSha256:'e'.repeat(64),runtimeRevision:'f'.repeat(40),dbPath:'C:\\Users\\Owner\\JARVIS\\state\\jarvis.db',attemptId:'12345678-1234-1234-1234-123456789012',maxAttempts:1,maxDurationSeconds:900,recoveryReserveSeconds:120,credentialRotationApproval:true,existingTaskRestartApproval:true,configPersistenceApproval:true,normalLoopbackCookieApproval:true,confirmationApproval:true,automationConfirmationApproval:true,fleetReadOnlyApproval:true,pcSidecarReadOnlyApproval:true,pcSidecars:{profile:'jarvis-pc-sidecars-v1',expectedTaskFile:'absent',expectedObservationFile:'absent'},cohortAuthority:{kind:'approved-active-capture',expectedCount:38}};}

test('rotation acceptance defaults to an inert plan without any approval file',()=>{
 const run=spawnSync(process.execPath,[fileURLToPath(target)],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stderr,'');assert.match(run.stdout,/^PLAN ONLY:/);
});

test('rotation scope accepts only exact one-attempt bounded Owner authority',async()=>{
 const {validateRotationScope}=await import(target);assert.equal(validateRotationScope(approved(),current).scopeId,'issue:1218:owner-code-rotation');
 const mutations={expired:s=>s.expiresAt=new Date(current).toISOString(),future:s=>s.issuedAt=new Date(current+1).toISOString(),overlong:s=>s.expiresAt=new Date(current+3*3600000).toISOString(),wrongScope:s=>s.scopeId='issue:1218',replay:s=>s.maxAttempts=2,noReserve:s=>s.recoveryReserveSeconds=0,shortWindow:s=>s.expiresAt=new Date(current+60000).toISOString(),newPermission:s=>s.permissionGrant=true,noCohort:s=>delete s.cohortAuthority,noFleetApproval:s=>s.fleetReadOnlyApproval=false,noNativeConfirmation:s=>s.automationConfirmationApproval=false,unc:s=>s.dbPath='\\\\server\\share\\jarvis.db',ads:s=>s.dbPath+=':secret',missingPin:s=>delete s.sourceHashes['scripts/read-jarvis-production-config.ps1'],extraExecutable:s=>s.sourceHashes['scripts/extra.ps1']='b'.repeat(64),unknownCohort:s=>s.cohortAuthority.kind='count-only'};
 mutations.noPcApproval=s=>s.pcSidecarReadOnlyApproval=false;mutations.noPcPolicy=s=>delete s.pcSidecars;mutations.unknownPcPolicy=s=>s.pcSidecars.expectedTaskFile='unknown';
 for(const [name,mutate]of Object.entries(mutations)){const scope=approved();mutate(scope);assert.throws(()=>validateRotationScope(scope,current),{message:'ROTATION_APPROVAL_REQUIRED'},name);}
});

test('closed protocol refuses out-of-order, duplicate or unrecognized worker messages',async()=>{
 const {RotationFleetSession}=await import(target);
 for(const message of [{event:'before-commit'},{event:'after-rollback'},{event:'before-rotation',code:'PUBLIC-SECRET-SENTINEL'},{event:'execute',command:'arbitrary'},{event:'result',result:{complete:true}}]){
  const session=new RotationFleetSession(approved(),'0'.repeat(64));assert.throws(()=>session.accept(message),{message:'ROTATION_PROTOCOL_REJECTED'});
 }
});

test('worker final result cannot hide incomplete preservation, cleanup or rollback',async()=>{
 const {validateRotationResult}=await import(target);
 const result={schemaVersion:1,issue:1218,complete:true,confirmationVerified:true,sessionInvalidationWarningVerified:true,configurationValidated:true,credentialGenerated:true,atomicReplacementVerified:true,protectedBackupVerified:true,newLoginVerified:true,rollbackAttempted:false,rollbackVerified:false,oldLoginVerified:false,cleanupFailed:false,failureCode:null,failedStage:null};
 assert.deepEqual(validateRotationResult(result),result);
 for(const mutate of [r=>r.newLoginVerified=false,r=>r.cleanupFailed=true,r=>r.rollbackAttempted=true,r=>r.code='PUBLIC-SECRET-SENTINEL',r=>r.failedStage='PUBLIC-PATH-SENTINEL']){const bad={...result};mutate(bad);assert.throws(()=>validateRotationResult(bad),{message:'ROTATION_RESULT_REJECTED'});}
});

test('recovery certification requires its own successful restored-phase comparison',async()=>{
 const {RotationFleetSession,validateRotationResult}=await import(target);
 const recovered={schemaVersion:1,issue:1218,complete:false,confirmationVerified:true,sessionInvalidationWarningVerified:true,configurationValidated:true,credentialGenerated:true,atomicReplacementVerified:true,protectedBackupVerified:true,newLoginVerified:false,rollbackAttempted:true,rollbackVerified:true,oldLoginVerified:true,cleanupFailed:false,failureCode:'ROTATION_FAILED_RECOVERED',failedStage:'rollback'};
 assert.throws(()=>new RotationFleetSession(approved(),'0'.repeat(64)).finish(recovered),{message:'ROTATION_RESULT_REJECTED'});
 assert.throws(()=>validateRotationResult({...recovered,rollbackVerified:false}),{message:'ROTATION_RESULT_REJECTED'});
});

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

test('controller brackets the real WAL fleet before rotation and commits only preserved data',async t=>{
 const f=await fleetFixture(t),{RotationFleetSession}=await import(target),session=new RotationFleetSession({...approved(),dbPath:f.dbPath},'0'.repeat(64));
 assert.deepEqual(session.accept({event:'before-rotation'}),{event:'before-rotation',accepted:true});
 assert.throws(()=>session.accept({event:'before-rotation'}),{message:'ROTATION_PROTOCOL_REJECTED'});
 assert.deepEqual(session.accept({event:'before-commit'}),{event:'before-commit',accepted:true});
 const report=session.finish({schemaVersion:1,issue:1218,complete:true,confirmationVerified:true,sessionInvalidationWarningVerified:true,configurationValidated:true,credentialGenerated:true,atomicReplacementVerified:true,protectedBackupVerified:true,newLoginVerified:true,rollbackAttempted:false,rollbackVerified:false,oldLoginVerified:false,cleanupFailed:false,failureCode:null,failedStage:null});
 assert.equal(report.complete,true);assert.equal(report.fleetSqlitePreserved,true);assert.equal(report.wholeR06Verified,false);assert.doesNotMatch(JSON.stringify(report),/PUBLIC-CONTROLLER|BEGIN PUBLIC KEY|fleet\.db/);
});

test('controller rejects an enrollment-history change then checks recovery without repairing the database',async t=>{
 const f=await fleetFixture(t),{RotationFleetSession}=await import(target),session=new RotationFleetSession({...approved(),dbPath:f.dbPath},'0'.repeat(64));
 assert.equal(session.accept({event:'before-rotation'}).accepted,true);
 const row=f.db.prepare('SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id LIMIT 1').get(),identity=JSON.parse(row.payload);
 identity.enrolledAt='2026-10-01T00:00:00.000Z';f.db.prepare('UPDATE jarvis_worker_identity SET payload=? WHERE node_id=?').run(JSON.stringify(identity),row.node_id);
 assert.deepEqual(session.accept({event:'before-commit'}),{event:'before-commit',accepted:false});
 assert.deepEqual(session.accept({event:'after-rollback'}),{event:'after-rollback',accepted:false});
 assert.equal(f.db.prepare('SELECT payload FROM jarvis_worker_identity WHERE node_id=?').get(row.node_id).payload,JSON.stringify(identity),'Controller must never repair fleet data to make a comparison pass');
 assert.throws(()=>session.accept({event:'before-commit'}),{message:'ROTATION_PROTOCOL_REJECTED'});
});

test('failed recovery snapshot cannot reuse the previous successful comparison',async t=>{
 const f=await fleetFixture(t),{RotationFleetSession}=await import(target),session=new RotationFleetSession({...approved(),dbPath:f.dbPath},'0'.repeat(64));
 assert.equal(session.accept({event:'before-rotation'}).accepted,true);
 assert.equal(session.accept({event:'before-commit'}).accepted,true);
 f.db.exec('DROP TABLE jarvis_worker_identity');
 assert.equal(session.accept({event:'after-rollback'}).accepted,false);
 const report=session.finish({schemaVersion:1,issue:1218,complete:false,confirmationVerified:true,sessionInvalidationWarningVerified:true,configurationValidated:true,credentialGenerated:true,atomicReplacementVerified:true,protectedBackupVerified:true,newLoginVerified:true,rollbackAttempted:true,rollbackVerified:false,oldLoginVerified:true,cleanupFailed:false,failureCode:'ROTATION_RECOVERY_FAILED',failedStage:'rollback'});
 assert.equal(report.fleetSqlitePreserved,false);
 assert.equal(report.fleet,null);
});

for(const scenario of ['success','new-login-failed'])test('public Node/PowerShell/WAL/atomic transaction protocol: '+scenario,async t=>{
 const f=await fleetFixture(t),{RotationFleetSession}=await import(target),session=new RotationFleetSession({...approved(),dbPath:f.dbPath},'0'.repeat(64));
 const {join}=await import('node:path');
 const shell=process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
 const child=spawn(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../tests/owner-code-rotation-transaction.fixture.ps1',import.meta.url)),'-SourcePath',fileURLToPath(new URL('./rotate-jarvis-owner-code-windows.ps1',import.meta.url)),'-Case',scenario,'-Protocol','-FleetPath',f.dbPath],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const messages=[],events=[];
 const report=await new Promise((done,fail)=>{
  let pending='',stderr='',result=null;
  const timer=setTimeout(()=>{child.kill();fail(Error('public transaction protocol timed out'));},30000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',value=>stderr+=value);
  child.stdout.on('data',value=>{pending+=value;let end;try{while((end=pending.indexOf('\n'))!==-1){const line=pending.slice(0,end);pending=pending.slice(end+1);assert.ok(line.length<8192);messages.push(line);const message=JSON.parse(line);if(message.event==='result'){assert.deepEqual(Object.keys(message).sort(),['event','result']);assert.equal(result,null);result=session.finish(message.result);child.stdin.end();}else{assert.equal(result,null);events.push(message.event);child.stdin.write(JSON.stringify(session.accept(message))+'\n');}}}catch(error){child.kill();fail(error);}});
  child.on('error',error=>{clearTimeout(timer);fail(error);});child.stdin.on('error',()=>{});
  child.on('close',status=>{clearTimeout(timer);try{assert.equal(status,0,stderr);assert.equal(stderr,'');assert.equal(pending.trim(),'');assert.ok(result);done(result);}catch(error){fail(error);}});
 });
 assert.equal(report.fleetSqlitePreserved,true);assert.equal(report.wholeR06Verified,false);assert.equal(report.complete,scenario==='success');
 if(scenario==='success')assert.deepEqual(events,['before-rotation','before-commit']);
 else{assert.deepEqual(events,['before-rotation','after-rollback']);assert.equal(report.rotation.rollbackVerified,true);assert.equal(report.rotation.oldLoginVerified,true);}
 assert.doesNotMatch(messages.join(''),/PUBLIC-CONTROLLER|PUBLIC-FIXTURE|fixture-other-token|BEGIN PUBLIC KEY|fleet\.db/);
});

test('fresh Windows-style Git checkout preserves all nine rotation source pins',async t=>{
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),{ROTATION_SOURCE_FILES}=await import(target);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rotation-byte-checkout-')),seed=path.join(directory,'seed'),checkout=path.join(directory,'fresh');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(seed,'scripts'),{recursive:true});
 for(const file of ROTATION_SOURCE_FILES)fs.copyFileSync(file,path.join(seed,file));
 fs.copyFileSync('.gitattributes',path.join(seed,'.gitattributes'));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 const git=(cwd,args)=>execFileSync('git',args,{cwd,env,stdio:'pipe',encoding:'utf8'});
 git(seed,['init']);git(seed,['config','user.name','Public Fixture']);git(seed,['config','user.email','fixture@example.invalid']);git(seed,['config','core.autocrlf','false']);git(seed,['add','.']);git(seed,['commit','-m','public exact-byte fixture']);
 git(directory,['clone','--shared','--no-checkout',seed,checkout]);git(checkout,['config','core.autocrlf','true']);git(checkout,['checkout','--force','HEAD']);
 assert.equal(ROTATION_SOURCE_FILES.length,9);
 const {createHash}=await import('node:crypto'),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const file of ROTATION_SOURCE_FILES)assert.equal(digest(fs.readFileSync(path.join(checkout,file))),digest(fs.readFileSync(file)),file+' must keep the approved bytes');
});


test('rotation refuses an unapproved existing PC sidecar before admitting its baseline',async t=>{
 const f=await fleetFixture(t),fs=await import('node:fs'),{RotationFleetSession}=await import(target);
 fs.writeFileSync(f.dbPath+'.pc-tasks.json',JSON.stringify({version:1,tasks:[],savedAt:'2026-11-04T09:00:00.000Z'},null,2)+'\n');
 const session=new RotationFleetSession({...approved(),dbPath:f.dbPath},'0'.repeat(64));
 assert.deepEqual(session.accept({event:'before-rotation'}),{event:'before-rotation',accepted:false});
});

test('rotation checks PC sidecars after actual atomic rename and refuses subsequent loss',async t=>{
 const f=await fleetFixture(t),fs=await import('node:fs'),{RotationFleetSession}=await import(target);
 const tasks=JSON.stringify({version:1,tasks:[],savedAt:'2026-11-04T09:00:00.000Z'},null,2)+'\n',observations=JSON.stringify({version:1,records:[],savedAt:'2026-11-04T09:00:00.000Z'},null,2)+'\n';
 fs.writeFileSync(f.dbPath+'.pc-tasks.json',tasks);fs.writeFileSync(f.dbPath+'.pc-observations.json',observations);
 const scope={...approved(),dbPath:f.dbPath,pcSidecars:{profile:'jarvis-pc-sidecars-v1',expectedTaskFile:'present',expectedObservationFile:'present'}};
 const session=new RotationFleetSession(scope,'0'.repeat(64));assert.equal(session.accept({event:'before-rotation'}).accepted,true);
 fs.writeFileSync(f.dbPath+'.pc-tasks.json.tmp',tasks);fs.renameSync(f.dbPath+'.pc-tasks.json.tmp',f.dbPath+'.pc-tasks.json');
 assert.equal(session.accept({event:'before-commit'}).accepted,true);
 const report=session.finish({schemaVersion:1,issue:1218,complete:true,confirmationVerified:true,sessionInvalidationWarningVerified:true,configurationValidated:true,credentialGenerated:true,atomicReplacementVerified:true,protectedBackupVerified:true,newLoginVerified:true,rollbackAttempted:false,rollbackVerified:false,oldLoginVerified:false,cleanupFailed:false,failureCode:null,failedStage:null});
 assert.equal(report.pcSidecarsPreserved,true);assert.equal(report.wholeR06Verified,false);
 const failed=new RotationFleetSession(scope,'0'.repeat(64));assert.equal(failed.accept({event:'before-rotation'}).accepted,true);fs.unlinkSync(f.dbPath+'.pc-tasks.json');
 assert.equal(failed.accept({event:'before-commit'}).accepted,false);assert.equal(fs.existsSync(f.dbPath+'.pc-tasks.json'),false);
});
