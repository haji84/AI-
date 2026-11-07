import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const entry=resolve('scripts/owner-code-rotation-native-1218.mjs');
const files=['owner-code-rotation-acceptance.mjs','owner-code-fleet-preservation.mjs','owner-code-pc-preservation.mjs','owner-code-rotation-worker.ps1','rotate-jarvis-owner-code-windows.ps1','read-jarvis-production-config.ps1','validate-jarvis-production-config.mjs','jarvis-production-config.mjs','jarvis-windows-install-paths.mjs'].map(file=>'scripts/'+file);
const now=Date.parse('2026-11-04T16:00:00.000Z');
const environment={GITHUB_ACTOR:'haji84',GITHUB_REPOSITORY:'haji84/AI-',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345678',GITHUB_RUN_ATTEMPT:'1'};
const flags=['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'];
function scope(){return {scopeId:'issue:1218:owner-code-rotation',ownerSid:'S-1-5-21-1-2-3-1004',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+7199000).toISOString(),sourceRevision:environment.GITHUB_SHA,sourceHashes:Object.fromEntries(files.map(file=>[file,'b'.repeat(64)])),configSha256:'c'.repeat(64),taskSha256:'d'.repeat(64),nodeSha256:'e'.repeat(64),runtimeRevision:'f'.repeat(40),dbPath:'C:\\PUBLIC\\broker.sqlite',attemptId:'11111111-2222-4333-8444-555555555555',maxAttempts:1,maxDurationSeconds:900,recoveryReserveSeconds:120,cohortAuthority:{kind:'approved-active-capture',expectedCount:38},pcSidecars:{profile:'jarvis-pc-sidecars-v1',expectedTaskFile:'present',expectedObservationFile:'present'},...Object.fromEntries(flags.map(flag=>[flag,true]))};}
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64');
async function api(){return existsSync(entry)?import(pathToFileURL(entry).href):{};}

test('native rotation entry defaults to PLAN without reading a scope or starting Windows work',()=>{
 const result=spawnSync(process.execPath,[entry],{encoding:'utf8',timeout:10000,env:{...process.env,GORIQ_OWNER_ROTATION_SCOPE_BASE64:'PRIVATE_UNUSED_INPUT'}});
 assert.equal(result.status,0);assert.equal(result.stderr,'');assert.match(result.stdout,/^PLAN ONLY:/);assert.doesNotMatch(result.stdout,/PRIVATE_UNUSED_INPUT/);
});
test('binding omitted run fields adds only the real allocated run and attempt one',async()=>{
 const a=await api();assert.equal(typeof a.bindRotationRunScope,'function');const original=scope(),before=globalThis.structuredClone(original),bound=a.bindRotationRunScope(original,environment,now);
 assert.deepEqual(original,before);assert.deepEqual(bound,{...before,workflowRunId:'12345678',workflowRunAttempt:1});
 for(const key of Object.keys(before))assert.deepEqual(bound[key],before[key]);
});
test('a prebound receipt must already match while partial or different run fields are rejected',async()=>{
 const a=await api();assert.equal(typeof a.bindRotationRunScope,'function');const bound={...scope(),workflowRunId:'12345678',workflowRunAttempt:1};assert.deepEqual(a.bindRotationRunScope(bound,environment,now),bound);
 for(const extra of [{workflowRunId:'12345678'},{workflowRunAttempt:1},{workflowRunId:'other',workflowRunAttempt:1},{workflowRunId:'12345678',workflowRunAttempt:2},{workflowRunId:12345678,workflowRunAttempt:1}])assert.throws(()=>a.bindRotationRunScope({...scope(),...extra},environment,now));
});
test('ordinary context or ambient production-config overrides cannot authorize the High entry',async()=>{
 const a=await api();assert.equal(typeof a.bindRotationRunScope,'function');
 for(const extra of [{GITHUB_ACTOR:'other'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/other'},{GITHUB_SHA:'b'.repeat(40)},{GITHUB_RUN_ID:'BIND_CURRENT_GITHUB_RUN'},{GITHUB_RUN_ATTEMPT:'2'},{JARVIS_PRODUCTION_CONFIG:'PRIVATE_OVERRIDE'}])assert.throws(()=>a.bindRotationRunScope(scope(),{...environment,...extra},now));
});
test('approval, scalar, data, source and duration fields cannot be coerced or synthesized',async()=>{
 const a=await api();assert.equal(typeof a.bindRotationRunScope,'function');
 for(const mutate of [s=>delete s.credentialRotationApproval,s=>s.credentialRotationApproval='true',s=>s.fleetReadOnlyApproval=false,s=>s.ownerSid=[s.ownerSid],s=>s.sourceRevision=[s.sourceRevision],s=>s.issuedAt=[s.issuedAt],s=>s.attemptId=[s.attemptId],s=>s.maxAttempts='1',s=>s.maxDurationSeconds=901,s=>s.recoveryReserveSeconds=119,s=>s.expiresAt=new Date(now+899999).toISOString(),s=>s.sourceHashes.extra='b'.repeat(64),s=>s.cohortAuthority.expectedCount=37,s=>s.pcSidecars.expectedTaskFile='unknown',s=>s.extra='PRIVATE_EXTRA']){const value=scope();mutate(value);assert.throws(()=>a.bindRotationRunScope(value,environment,now));}
});
test('canonical descriptor decoding rejects duplicate keys, malformed wire and private raw errors',async()=>{
 const a=await api();assert.equal(typeof a.decodeRotationEntryDescriptor,'function');assert.deepEqual(a.decodeRotationEntryDescriptor(encode(scope())),scope());
 for(const value of ['PRIVATE_BAD_INPUT',' '+encode(scope()),Buffer.from(JSON.stringify(scope(),null,2)).toString('base64'),Buffer.from(JSON.stringify(scope()).replace('"maxAttempts":1','"maxAttempts":1,"maxAttempts":1')).toString('base64'),Buffer.alloc(65537,65).toString('base64')])assert.throws(()=>a.decodeRotationEntryDescriptor(value),error=>/^ROTATION_ENTRY_/.test(error.message)&&!error.message.includes('PRIVATE'));
});
test('descriptor and compiled-receipt hashes remain distinct without changing the original approval',async()=>{
 const a=await api();assert.equal(typeof a.compileRotationEntryDescriptor,'function');const original=scope(),wire=JSON.stringify(original),compiled=a.compileRotationEntryDescriptor(encode(original),environment,now);
 assert.equal(compiled.originalDescriptorSha256,hash(wire));assert.equal(compiled.runtimeScopeSha256,hash(a.serializeRotationRunScope(compiled.scope)));assert.notEqual(compiled.originalDescriptorSha256,compiled.runtimeScopeSha256);assert.deepEqual(JSON.parse(Buffer.from(compiled.scopeBase64,'base64').toString()),{...original,workflowRunId:'12345678',workflowRunAttempt:1});
});
test('entry child environment retains runtime context and excludes unrelated credentials and preload hooks',async()=>{
 const a=await api();assert.equal(typeof a.buildRotationEntryEnvironment,'function');const env=a.buildRotationEntryEnvironment({...environment,SystemRoot:'PUBLIC_WINDOWS',Path:'PUBLIC_PATH',USERPROFILE:'PUBLIC_PROFILE',GH_TOKEN:'PRIVATE_GH',GITHUB_TOKEN:'PRIVATE_TOKEN',JARVIS_OWNER_SECRET:'PRIVATE_OWNER',NODE_OPTIONS:'PRIVATE_PRELOAD',GORIQ_OTHER_SCOPE:'PRIVATE_OTHER'},'PUBLIC_SCOPE','c'.repeat(64));
 assert.equal(env.GITHUB_RUN_ID,'12345678');assert.equal(env.SystemRoot,'PUBLIC_WINDOWS');assert.equal(env.Path,'PUBLIC_PATH');assert.equal(env.GORIQ_OWNER_ROTATION_SCOPE_BASE64,'PUBLIC_SCOPE');assert.equal(env.GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256,'c'.repeat(64));assert.doesNotMatch(JSON.stringify(env),/PRIVATE|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|JARVIS_OWNER_SECRET|GORIQ_OTHER_SCOPE/);
});
test('public preparation child requires closed admission, measured exit and a finite cleanup deadline',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationPreparation,'function');const ok={schemaVersion:1,complete:true,failureCode:null,profileMatchesEnvironment:true};
 assert.deepEqual(await a.runBoundedRotationPreparation(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(ok))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000}),ok);
 for(const value of [{...ok,profileMatchesEnvironment:false},{...ok,private:'PRIVATE_VALUE'},'PRIVATE_RAW']){const denied=await a.runBoundedRotationPreparation(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(denied.complete,false);assert.equal(denied.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.doesNotMatch(JSON.stringify(denied),/PRIVATE/);}
 let child;const timeout=await a.runBoundedRotationPreparation(()=>child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']}),{durationMs:300});assert.equal(timeout.complete,false);assert.equal(timeout.failureCode,'ROTATION_ENTRY_TIMEOUT');assert.equal(child.killed,true);
});
test('a late preparation result cannot be admitted even if its output and exit look valid',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationPreparation,'function');const ok={schemaVersion:1,complete:true,failureCode:null,profileMatchesEnvironment:true};let reads=0;
 const value=await a.runBoundedRotationPreparation(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(ok))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000,clock:()=>reads++===0?0:3001});assert.equal(value.complete,false);assert.equal(value.failureCode,'ROTATION_ENTRY_TIMEOUT');
});
test('invalid native rotation invocation returns only a fixed failure and never starts the controller',()=>{
 const run=spawnSync(process.execPath,[entry,'--run'],{encoding:'utf8',timeout:10000,env:{...process.env,GORIQ_OWNER_ROTATION_SCOPE_BASE64:'PRIVATE_INVALID_SCOPE'}});assert.equal(run.status,1);assert.equal(run.stderr,'');const result=JSON.parse(run.stdout);assert.equal(result.complete,false);assert.match(result.failureCode,/^ROTATION_ENTRY_/);assert.doesNotMatch(run.stdout,/PRIVATE|ownerSid|dbPath|config\.dpapi/);
});
function publicControllerResult(){
 const good=['confirmationVerified','sessionInvalidationWarningVerified','configurationValidated','credentialGenerated','atomicReplacementVerified','protectedBackupVerified','newLoginVerified'];
 const bad=['rollbackAttempted','rollbackVerified','oldLoginVerified','cleanupFailed'];
 return {schemaVersion:1,issue:1218,complete:true,rotation:{schemaVersion:1,issue:1218,complete:true,...Object.fromEntries(good.map(key=>[key,true])),...Object.fromEntries(bad.map(key=>[key,false])),failureCode:null,failedStage:null},fleetSqlitePreserved:true,pcSidecarsPreserved:true,wholeR06Verified:false,workerPrivateKeysVerified:false,sidecarAndCompassHistoryVerified:false,fleet:{status:'PASS',...Object.fromEntries(['databaseBindingMatched','cohortAuthorityVerified','baselineCohortPreserved','fleetMetadataPreserved','identitiesPreserved','keysPreserved','workerLifecycleHistoryPreserved','auditRetainedHistoryPreserved','taskPayloadsPreserved','nonceProtectionPreserved'].map(key=>[key,true])),privateUnused:'PRIVATE_NOT_PROJECTED'}};
}
test('controller projection requires its existing complete result and never exports unused data',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');const source=publicControllerResult();
 const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(source))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});
 assert.equal(r.complete,true);assert.equal(r.childCleanupVerified,true);assert.equal(r.rotation.newLoginVerified,true);assert.equal(r.fleetChecks.status,'PASS');assert.equal(r.wholeR06Verified,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_NOT_PROJECTED/);
});
test('unexpected stderr cannot truncate the existing controller recovery budget',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');const source=publicControllerResult();let child;
 const r=await a.runBoundedRotationController(()=>child=spawn(process.execPath,['-e',`process.stderr.write('PRIVATE_ERROR');setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(source))}),100)`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});
 assert.equal(child.killed,false,'The transport must wait for the controller to finish recovery');assert.equal(r.complete,false);assert.equal(r.childCleanupVerified,true);assert.equal(r.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_ERROR/);
});
test('controller timeout is bounded and never certifies worker cleanup or fabricated recovery',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');let child;
 const r=await a.runBoundedRotationController(()=>child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']}),{durationMs:100});assert.equal(r.complete,false);assert.equal(r.failureCode,'ROTATION_ENTRY_TIMEOUT');assert.equal(r.childCleanupVerified,false);assert.equal(r.rotation,null);assert.equal(child.killed,true);
});
test('malformed or false controller success cannot be projected as acceptance',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');
 for(const mutate of [s=>s.private='PRIVATE_UNKNOWN',s=>s.pcSidecarsPreserved=false,s=>s.rotation.newLoginVerified=false,s=>s.fleet.status='FAIL',s=>s.fleet.identitiesPreserved=false,s=>s.wholeR06Verified=true]){const value=publicControllerResult();mutate(value);const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))})`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(r.complete,false);assert.equal(r.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);}
});

test('a real closed controller failure stays inconclusive without exposing raw data',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');const value={schemaVersion:1,issue:1218,complete:false,failureCode:'ROTATION_ACCEPTANCE_INCONCLUSIVE',wholeR06Verified:false};
 const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=1`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(r.complete,false);assert.equal(r.failureCode,'ROTATION_ENTRY_CONTROLLER_FAILED');assert.equal(r.rotation,null);assert.equal(r.childCleanupVerified,true);
});
test('existing verified recovery is preserved as recovery evidence rather than success',async()=>{
 const a=await api();assert.equal(typeof a.runBoundedRotationController,'function');const value=publicControllerResult();value.complete=false;Object.assign(value.rotation,{complete:false,newLoginVerified:false,rollbackAttempted:true,rollbackVerified:true,oldLoginVerified:true,failureCode:'ROTATION_FAILED_RECOVERED',failedStage:'new-login'});
 const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=1`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(r.complete,false);assert.equal(r.rotation.rollbackVerified,true);assert.equal(r.rotation.oldLoginVerified,true);assert.equal(r.failureCode,'ROTATION_ENTRY_CONTROLLER_FAILED');assert.equal(r.fleetChecks.status,'PASS');assert.equal(r.wholeR06Verified,false);
});

test('original-cohort digest binding requires a scalar string before existing validation',async()=>{
 const a=await api();const good={...scope(),cohortAuthority:{kind:'original-cohort-digest',expectedCount:38,cohortSha256:'b'.repeat(64)}};assert.equal(a.bindRotationRunScope(good,environment,now).cohortAuthority.cohortSha256,good.cohortAuthority.cohortSha256);
 for(const value of [['b'.repeat(64)],{toString:'b'.repeat(64)},123])assert.throws(()=>a.bindRotationRunScope({...good,cohortAuthority:{...good.cohortAuthority,cohortSha256:value}},environment,now));
});

test('unchanged receipt expiry must fit the bounded transport before any controller factory call',async()=>{
 const a=await api();assert.equal(typeof a.rotationControllerDuration,'function');assert.equal(a.rotationControllerDuration({...scope(),expiresAt:new Date(now+900000).toISOString()},now),901000);assert.equal(a.rotationControllerDuration({...scope(),expiresAt:new Date(now+1439000).toISOString()},now),1440000);
 for(const ms of [899999,1439001,3600000]){const approved={...scope(),expiresAt:new Date(now+ms).toISOString()};const before=globalThis.structuredClone(approved);let calls=0;await assert.rejects(a.runBoundedRotationController(()=>{calls++;throw Error('MUST_NOT_START');},{scope:approved,clock:()=>now}));assert.equal(calls,0);assert.deepEqual(approved,before);}
});
test('startup delay cannot move the controller-owned window beyond the receipt or outer deadline',async()=>{
 const a=await api();assert.equal(typeof a.rotationControllerDuration,'function');const approved={...scope(),expiresAt:new Date(now+1200000).toISOString()},expiry=Date.parse(approved.expiresAt),outerEnd=now+a.rotationControllerDuration(approved,now);
 for(const startup of [0,5001,450000,1199000]){const controllerOwnedEnd=Math.min(now+startup+approved.maxDurationSeconds*1000,expiry);assert.ok(controllerOwnedEnd<=outerEnd-1000);}
 const value=publicControllerResult(),r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))})`],{stdio:['ignore','pipe','pipe']}),{scope:approved,clock:()=>now});assert.equal(r.complete,true);assert.equal(r.childCleanupVerified,true);assert.equal(approved.expiresAt,new Date(now+1200000).toISOString());
});

test('UTF8 BOM descriptors are noncanonical and cannot change the original supplied-byte digest',async()=>{
 const a=await api(),wire=JSON.stringify(scope()),bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(wire)]).toString('base64');assert.throws(()=>a.decodeRotationEntryDescriptor(bom));assert.throws(()=>a.compileRotationEntryDescriptor(bom,environment,now));assert.equal(a.compileRotationEntryDescriptor(Buffer.from(wire).toString('base64'),environment,now).originalDescriptorSha256,hash(Buffer.from(wire)));
});

function runningJob(){return {total_count:1,jobs:[{id:98765,run_id:Number(environment.GITHUB_RUN_ID),run_attempt:1,head_sha:environment.GITHUB_SHA,name:'inspect',status:'in_progress',started_at:new Date(now-10000).toISOString(),completed_at:null}]};}
const jobScope=()=>({...scope(),expiresAt:new Date(now+1200000).toISOString()});
test('trusted job start bounds receipt expiry inside the existing total job timeout',async()=>{
 const a=await api();assert.equal(typeof a.validateRotationJobBudget,'function');const approved=jobScope(),before=globalThis.structuredClone(approved),data=runningJob();const deadline=a.validateRotationJobBudget(data,approved,environment,now);assert.equal(deadline,now-10000+24*60000);assert.ok(Date.parse(approved.expiresAt)+1000<=deadline);assert.deepEqual(approved,before);
 for(const mutate of [x=>x.jobs[0].run_id++,x=>x.jobs[0].run_attempt=2,x=>x.jobs[0].head_sha='c'.repeat(40),x=>x.jobs.push({...x.jobs[0],id:98766}),x=>x.total_count=2,x=>x.jobs[0].status='completed',x=>x.jobs[0].started_at='PRIVATE_BAD',x=>x.jobs[0].started_at=new Date(now+1).toISOString(),x=>x.jobs[0].started_at=new Date(now-300000).toISOString(),x=>x.jobs[0].name='other']){const data=runningJob();mutate(data);assert.throws(()=>a.validateRotationJobBudget(data,approved,environment,now),/^Error: ROTATION_ENTRY_/);}
});
test('a captured job deadline is not reset after preparation or source checks',async()=>{
 const a=await api();assert.equal(typeof a.validateRotationJobBudget,'function');const data=runningJob(),approved=jobScope();assert.equal(a.validateRotationJobBudget(data,approved,environment,now),a.validateRotationJobBudget(data,approved,environment,now+1000));assert.throws(()=>a.validateRotationJobBudget(data,approved,environment,now+300001));
});
test('public job metadata read uses exact run attempt with no credentials and rejects transport failures',async()=>{
 const a=await api();assert.equal(typeof a.readRotationJobBudget,'function');let requested=0;const good=async(url,options)=>{requested++;assert.equal(url,'https://api.github.com/repos/haji84/AI-/actions/runs/12345678/attempts/1/jobs?per_page=100');assert.equal(options.redirect,'error');assert.equal(options.signal.aborted,false);assert.equal(Object.keys(options.headers).some(key=>/authorization|cookie/i.test(key)),false);return new globalThis.Response(JSON.stringify(runningJob()),{status:200});};const record=await a.readRotationJobBudget(jobScope(),environment,good,()=>now);assert.equal(requested,1);assert.deepEqual(record,runningJob());
 for(const fetcher of [async()=>new globalThis.Response('PRIVATE_ERROR',{status:403}),async()=>new globalThis.Response('PRIVATE_BAD_JSON',{status:200}),async()=>new globalThis.Response('x'.repeat(65537),{status:200}),async()=>{throw Error('PRIVATE_NETWORK_ERROR');}])await assert.rejects(a.readRotationJobBudget(jobScope(),environment,fetcher,()=>now),error=>/^ROTATION_ENTRY_/.test(error.message)&&!error.message.includes('PRIVATE'));
});

test('verified rollback cannot survive contradictory missing or failed fleet and PC preservation',async()=>{
 const a=await api();for(const mutate of [s=>{s.fleet=null;s.fleetSqlitePreserved=false;s.pcSidecarsPreserved=false;},s=>s.fleetSqlitePreserved=false,s=>s.pcSidecarsPreserved=false,s=>s.fleet.status='FAIL',s=>s.fleet.identitiesPreserved=false]){const value=publicControllerResult();value.complete=false;Object.assign(value.rotation,{complete:false,newLoginVerified:false,rollbackAttempted:true,rollbackVerified:true,oldLoginVerified:true,failureCode:'ROTATION_FAILED_RECOVERED',failedStage:'new-login'});mutate(value);const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=1`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(r.complete,false);assert.equal(r.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.equal(r.rotation,null);}
});

test('incomplete rotation cannot export inconsistent preserved fleet evidence',async()=>{
 const a=await api();const partial=()=>{const value=publicControllerResult();value.complete=false;Object.assign(value.rotation,{complete:false,newLoginVerified:false,failureCode:'ROTATION_REJECTED',failedStage:'new-login'});return value;};const execute=value=>a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=1`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});
 const valid=await execute(partial());assert.equal(valid.failureCode,'ROTATION_ENTRY_CONTROLLER_FAILED');assert.equal(valid.fleetChecks.status,'PASS');
 for(const mutate of [s=>s.fleet=null,s=>s.fleet.status='FAIL',s=>s.fleet.identitiesPreserved=false,s=>s.fleetSqlitePreserved=false]){const value=partial();mutate(value);const r=await execute(value);assert.equal(r.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.equal(r.fleetChecks,null);}
});

test('PC sidecars cannot be preserved when the controller has no comparison',async()=>{
 const a=await api(),value=publicControllerResult();value.complete=false;value.fleet=null;value.fleetSqlitePreserved=false;Object.assign(value.rotation,{complete:false,newLoginVerified:false,failureCode:'ROTATION_REJECTED',failedStage:'context'});const r=await a.runBoundedRotationController(()=>spawn(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=1`],{stdio:['ignore','pipe','pipe']}),{durationMs:3000});assert.equal(r.failureCode,'ROTATION_ENTRY_PROTOCOL_FAILED');assert.equal(r.rotation,null);
});
