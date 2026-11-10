import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import * as entry from './owner-code-rotation-native-1218.mjs';

const start=Date.parse('2026-11-06T18:00:00.000Z'),now=start+200000;
const environment={GITHUB_ACTOR:'haji84',GITHUB_REPOSITORY:'haji84/AI-',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345678',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:'haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main'};
const flags=['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'];
const files=['owner-code-rotation-acceptance.mjs','owner-code-fleet-preservation.mjs','owner-code-pc-preservation.mjs','owner-code-rotation-worker.ps1','rotate-jarvis-owner-code-windows.ps1','read-jarvis-production-config.ps1','validate-jarvis-production-config.mjs','jarvis-production-config.mjs','jarvis-windows-install-paths.mjs','owner-code-rotation-native-1218.mjs','owner-code-rotation-native-1218.ps1','owner-code-launcher-binding-inspection-1218.ps1','owner-code-rotation-exercise.mjs','owner-code-rotation-exercise.ps1','owner-code-production-cutover-1218.ps1'].map(x=>'scripts/'+x);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const compile=(value,env=environment)=> (entry.compilePublicCutoverGrant??entry.compilePublicRotationGrant)(encode(value),env,now);
function approval(){return {schemaVersion:2,scopeId:'issue:1218:ephemeral-password-task-retention-proof',goalId:'goal-fcc81c97e09153f7',sourceRevision:'c'.repeat(40),scriptSha256:'1698f5238d2ca735dee2cfad7c5ed1238f396866220aeebf3624bab560edecca',issuedAt:'2026-11-05T16:00:00.000Z',expiresAt:'2026-11-05T17:00:00.000Z',attemptId:'22222222-2222-4222-8222-222222222222',runBinding:'one-current-dispatch-attempt-1',maxAttempts:1,maxAccounts:1,maxTasks:1,maxJobs:1,maxDurationSeconds:480,cleanupReserveSeconds:120,maxTotalSeconds:600,explicitOwnerApproval:true,createEphemeralAccountApproval:true,temporaryPasswordPersistenceApproval:true,temporaryTaskRegistrationApproval:true,conditionalBatchLogonRightApproval:true,ownObjectCleanupApproval:true};}
function grant(){
 const archive=Buffer.alloc(30);archive.writeUInt32LE(0x04034b50); // DATA-only placeholder, never proof acceptance.
 return {schemaVersion:2,kind:'NONSECRET_ORIGINAL_ROTATION_GRANT',scopeId:'issue:1218:owner-code-rotation',issue:1218,goalId:'goal-fcc81c97e09153f7',authorityType:'FRESH_OWNER_HIGH_ROTATION_RESTORATION_APPROVAL',issuedBy:'owner-approved-task-operator',approvalId:'11111111-1111-4111-8111-111111111111',approvalReference:'owner-approval:'+'d'.repeat(64),sourceRevision:'a'.repeat(40),sourceHashes:Object.fromEntries(files.map(x=>[x,'b'.repeat(64)])),ciRunId:'1001',ciRunAttempt:1,workflowPath:'.github/workflows/gai-zbook-diagnostic-1218.yml',ownerSidSha256:'d'.repeat(64),profile:'jarvis-owner-production-cutover-v1',operation:'cutover-rotate-verify-restore-verify-original',issuedAt:new Date(start).toISOString(),expiresAt:new Date(start+1400000).toISOString(),maxAttempts:1,maxDurationSeconds:900,recoveryReserveSeconds:120,cohortAuthority:{kind:'approved-active-capture',expectedCount:38},pcSidecars:{profile:'jarvis-pc-sidecars-v1',expectedTaskFile:'present',expectedObservationFile:'absent'},...Object.fromEntries(flags.map(x=>[x,true])),taskActionMigration:{approved:true,taskName:'JARVIS Remote Host',taskPath:'\\',target:'bound-direct-node'},knownRecoveryTask:{approved:true,profile:'interactive-owner-limited-manual-v1',maxTasks:1,allowedOperations:['preflight','recover-known-runtime'],disposition:'retain-until-password-primary-healthy'},protectedNodeBootstrap:{approved:true,version:'24.19.0',architecture:'x64',archiveSha256:'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73',nodeSha256:'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',signerCertificateSha256:'c5b94f1334367cb4fa004504d0cb62a558d30e1c3c712f729a02333bf5011522',publisher:'OpenJS Foundation',retention:'while-referenced'},credentialProof:{runId:'1002',jobId:'1003',artifactId:'1004',approvalBase64:encode(approval()),archiveBase64:archive.toString('base64'),dispatchLedgerSha256:'e'.repeat(64),independentVerdictSha256:'f'.repeat(64)}};
}
test('new cutover contract accepts exactly36 keys and15 source files as immutable data, never live admission',()=>{
 const value=grant(),compiled=compile(value);
 assert.equal(compiled.grant.profile,'jarvis-owner-production-cutover-v1');
 assert.equal(Object.keys(compiled.grant).length,36);assert.equal(Object.keys(compiled.grant.sourceHashes).length,15);
 assert.equal(compiled.originalGrantSha256,createHash('sha256').update(JSON.stringify(value)).digest('hex'));
 assert.equal(compiled.effectCapability,false);
 assert.throws(()=>{compiled.grant.taskActionMigration.taskName='Other';},TypeError);
 assert.equal(compiled.proofApproval.expiresAt,'2026-11-05T17:00:00.000Z','expired historical lease is DATA until official execution checks');
});
test('cutover contract rejects missing or extra keys, arbitrary task authority and source closure substitution',()=>{
 for(const key of Object.keys(grant())){const value=grant();delete value[key];assert.throws(()=>compile(value));}
 for(const mutate of [g=>g.proofPassed=true,g=>g.taskActionMigration.taskName='Other',g=>g.taskActionMigration.taskPath='\\Other',g=>g.taskActionMigration.password='fixture-canary',g=>g.taskActionMigration.approved=false,g=>g.sourceHashes['scripts/extra.ps1']='b'.repeat(64),g=>delete g.sourceHashes[files[14]],g=>g.ciRunAttempt=2,g=>g.knownRecoveryTask.allowedOperations.reverse(),g=>g.knownRecoveryTask.maxTasks=2,g=>g.protectedNodeBootstrap.retention='delete-at-job-end']){const value=grant();mutate(value);assert.throws(()=>compile(value));}
});
test('fixed public Windows Node identity cannot become caller-selected package, architecture, publisher or certificate',()=>{
 for(const [key,value]of [['archiveSha256','0'.repeat(64)],['nodeSha256','0'.repeat(64)],['architecture','x86'],['publisher','fixture-private-canary'],['signerCertificateSha256','0'.repeat(64)],['version','latest']]){const g=grant();g.protectedNodeBootstrap[key]=value;assert.throws(()=>compile(g));}
});
test('historical canonical22 proof transport rejects false scope, changed budget, ambiguous wire and caller PASS flags',()=>{
 for(const mutate of [a=>a.maxAttempts=2,a=>a.ownObjectCleanupApproval=false,a=>a.scriptSha256='0'.repeat(64),a=>a.maxTotalSeconds=660,a=>a.goalId='other',a=>a.issuedAt=a.expiresAt,a=>a.explicitOwnerApproval=1]){const a=approval();mutate(a);const g=grant();g.credentialProof.approvalBase64=encode(a);assert.throws(()=>compile(g));}
 for(const mutate of [p=>p.complete=true,p=>p.runId=1002,p=>p.jobId='01',p=>p.archiveBase64=Buffer.from('not-zip').toString('base64'),p=>p.approvalBase64+='=',p=>p.independentVerdictSha256='not-a-hash']){const g=grant();mutate(g.credentialProof);assert.throws(()=>compile(g));}
 const g=grant();g.credentialProof.approvalBase64=Buffer.from(JSON.stringify(approval()).replace('"schemaVersion":2','"schemaVersion":1,"schemaVersion":2')).toString('base64');assert.throws(()=>compile(g));
});
function jobs(runId=12345678){return {total_count:1,jobs:[{id:55,run_id:runId,run_attempt:1,head_sha:'a'.repeat(40),name:'inspect',status:'in_progress',completed_at:null,started_at:new Date(start).toISOString()}]};}
test('cutover clock begins at original official job start and carries one120-second reserve through long preparation',()=>{
 assert.equal(typeof entry.createCutoverClock,'function','new shared-clock feature is absent on baseline');
 let utc=now,mono=0;const data=compile(grant()),laterData=compile(grant());
 const clock=entry.createCutoverClock(data,jobs(),environment,{utcClock:()=>utc,monoClock:()=>mono});
 assert.equal(entry.observeCutoverClock(clock,'Forward').hardEndUtc,new Date(start+900000).toISOString());
 assert.equal(entry.observeCutoverClock(clock,'Forward').remainingForwardMs,580000);
 utc+=500000;mono+=500000;
 assert.equal(entry.observeCutoverClock(clock,'Forward').remainingForwardMs,80000);
 assert.throws(()=>entry.observeCutoverClock(clock,'Forward',81000));
 assert.equal(entry.observeCutoverClock(clock,'Recovery').remainingHardMs,200000);
 const later=entry.createCutoverClock(laterData,jobs(),environment,{utcClock:()=>utc,monoClock:()=>mono});
 assert.equal(entry.observeCutoverClock(later,'Recovery').hardEndUtc,new Date(start+900000).toISOString(),'later phase never gets now+900s');
 assert.throws(()=>entry.createCutoverClock(data,jobs(),environment,{utcClock:()=>utc,monoClock:()=>mono}));
 utc=start+900000;mono=700000;assert.throws(()=>entry.observeCutoverClock(clock,'Recovery'));
});
test('clock identity, actual job binding and backward clocks fail closed without accepting copied admission data',()=>{
 assert.equal(typeof entry.createCutoverClock,'function');
 const context={...environment,GITHUB_RUN_ID:'12345679'},data=compile(grant(),context);let utc=now,mono=0;
 assert.throws(()=>entry.createCutoverClock(JSON.parse(JSON.stringify(data)),jobs(12345679),context));
 for(const mutate of [j=>j.jobs[0].run_id++,j=>j.jobs[0].run_attempt=2,j=>j.jobs[0].head_sha='c'.repeat(40),j=>j.jobs[0].name='other',j=>j.jobs[0].started_at=new Date(now+1).toISOString()]){const j=jobs(12345679);mutate(j);assert.throws(()=>entry.createCutoverClock(data,j,context));}
 const clock=entry.createCutoverClock(data,jobs(12345679),context,{utcClock:()=>utc,monoClock:()=>mono});
 assert.throws(()=>entry.observeCutoverClock({...clock},'Forward'));
 utc-=1;assert.throws(()=>entry.observeCutoverClock(clock,'Forward'));utc=now;mono=1;assert.throws(()=>entry.observeCutoverClock(clock,'Recovery'),'invalid clock remains refused');
});
test('old v1 remains exactly32 keys and14 sources and cannot gain migration authority by reinterpretation',()=>{
 const old=grant();for(const key of ['taskActionMigration','knownRecoveryTask','protectedNodeBootstrap','credentialProof'])delete old[key];delete old.sourceHashes[files[14]];old.schemaVersion=1;old.profile='jarvis-owner-production-v1';old.operation='rotate-verify-restore-verify-original';
 assert.equal(entry.compilePublicRotationGrant(encode(old),environment,now).grant.profile,'jarvis-owner-production-v1');
 assert.equal(Object.keys(old).length,32);old.taskActionMigration={approved:true};assert.throws(()=>entry.compilePublicRotationGrant(encode(old),environment,now));
});
test('new profile fits existing dispatch transport and refuses a ZIP byte beyond16384 without treating DATA as proof',()=>{
 const value=grant(),archive=Buffer.alloc(16384);archive.writeUInt32LE(0x04034b50);value.credentialProof.archiveBase64=archive.toString('base64');
 const accepted=compile(value);assert.equal(accepted.effectCapability,false);
 assert.ok(Buffer.byteLength(JSON.stringify(value))<=32768);assert.ok(encode(value).length<=43692);
 for(const size of [16385,30000]){const g=grant(),large=Buffer.alloc(size);large.writeUInt32LE(0x04034b50);g.credentialProof.archiveBase64=large.toString('base64');assert.throws(()=>compile(g),/ROTATION_CUTOVER_SCOPE_REQUIRED/);}
});
test('oversized canonical22 transport is refused without echoing the unparsed payload',()=>{
 const value=grant();value.credentialProof.approvalBase64=Buffer.from('fixture-private-canary'+' '.repeat(1100)).toString('base64');
 assert.throws(()=>compile(value),error=>error.message==='ROTATION_CUTOVER_SCOPE_REQUIRED');
});
test('oversized descriptor wire is closed before parsing and never widens legacy admission',()=>{
 for(const length of [32769,131073]){const encoded=Buffer.from('fixture-private-canary'+' '.repeat(length)).toString('base64');assert.throws(()=>entry.compilePublicCutoverGrant(encoded,environment,now),error=>error.message==='ROTATION_CUTOVER_SCOPE_REQUIRED');}
});
test('same allocated job cannot reanchor monotonic budget through exact recompile, changed wire, approval or job metadata',()=>{
 const context={...environment,GITHUB_RUN_ID:'12345680'};let utc=now,mono=0;
 const original=compile(grant(),context),clock=entry.createCutoverClock(original,jobs(12345680),context,{utcClock:()=>utc,monoClock:()=>mono});
 mono=500000;assert.equal(entry.observeCutoverClock(clock,'Recovery').remainingHardMs,200000);
 const recompiled=compile(grant(),context),same=entry.createCutoverClock(recompiled,jobs(12345680),context,{utcClock:()=>utc,monoClock:()=>0});
 assert.equal(same,clock,'same job and wire reuse the original opaque identity, not a fresh anchor');
 assert.equal(entry.observeCutoverClock(same,'Recovery').remainingHardMs,200000,'stalled UTC cannot replenish500s of consumed monotonic budget');
 for(const mutate of [g=>g.credentialProof.artifactId='1005',g=>g.approvalId='33333333-3333-4333-8333-333333333333']){const changed=grant();mutate(changed);assert.throws(()=>entry.createCutoverClock(compile(changed,context),jobs(12345680),context));}
 for(const mutate of [j=>j.jobs[0].id++,j=>j.jobs[0].started_at=new Date(start-1).toISOString()]){const changed=jobs(12345680);mutate(changed);assert.throws(()=>entry.createCutoverClock(compile(grant(),context),changed,context));}
});
test('recompiling an allocated job cannot revive its original invalid clock with new clock callbacks',()=>{
 const context={...environment,GITHUB_RUN_ID:'12345681'};let utc=now,mono=0;
 const clock=entry.createCutoverClock(compile(grant(),context),jobs(12345681),context,{utcClock:()=>utc,monoClock:()=>mono});
 utc--;assert.throws(()=>entry.observeCutoverClock(clock,'Forward'),/ROTATION_CUTOVER_CLOCK_INVALID/);
 assert.throws(()=>entry.createCutoverClock(compile(grant(),context),jobs(12345681),context,{utcClock:()=>now,monoClock:()=>0}),/ROTATION_CUTOVER_CLOCK_INVALID/);
 utc=now;mono=1;
 assert.throws(()=>entry.createCutoverClock(compile(grant(),context),jobs(12345681),context,{utcClock:()=>now,monoClock:()=>0}),/ROTATION_CUTOVER_CLOCK_INVALID/);
});
