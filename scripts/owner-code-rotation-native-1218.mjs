// Inert transport to the existing High-gated rotation controller. A mode is not approval.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
import {performance} from 'node:perf_hooks';
import {inflateRawSync} from 'node:zlib';
import {validateProductionConfig} from './jarvis-production-config.mjs';
import {ROTATION_SOURCE_FILES,validateRotationScope,validateRotationResult} from './owner-code-rotation-acceptance.mjs';
import {validateRotationExerciseResult} from './owner-code-rotation-exercise.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const strings=['scopeId','ownerSid','issuedAt','expiresAt','sourceRevision','configSha256','taskSha256','nodeSha256','runtimeRevision','dbPath','attemptId'];
const prepCodes=['ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED','ROTATION_ENTRY_PREPARATION_FAILED'];
const codes=[...prepCodes,'ROTATION_ENTRY_PROTOCOL_FAILED','ROTATION_ENTRY_TIMEOUT','ROTATION_ENTRY_CHILD_UNAVAILABLE','ROTATION_ENTRY_CONTROLLER_FAILED'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw new Error(code);};


// Consumer-only DATA: this transformation never reads configuration, starts a
// process, or creates native/start-only authority. The owned peer must bind its
// actual input bytes/source/Owner and original private lifetime separately.
const cleanPlatformFields=['SystemRoot','ComSpec','USERPROFILE','LOCALAPPDATA','TEMP','TMP','PATH','PATHEXT','PSModulePath'];
const cleanStartupControls=new Set(["HTTPS_PROXY","HTTP_PROXY","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE","NODE_CLUSTER_SCHED_POLICY","NODE_COMPILE_CACHE","NODE_COMPILE_CACHE_PORTABLE","NODE_DEBUG","NODE_DEBUG_NATIVE","NODE_DISABLE_COMPILE_CACHE","NODE_EXTRA_CA_CERTS","NODE_ICU_DATA","NODE_NO_WARNINGS","NODE_OPTIONS","NODE_PATH","NODE_PENDING_DEPRECATION","NODE_PENDING_PIPE_INSTANCES","NODE_PRESERVE_SYMLINKS","NODE_PRESERVE_SYMLINKS_MAIN","NODE_REDIRECT_WARNINGS","NODE_REPL_EXTERNAL_MODULE","NODE_REPL_HISTORY","NODE_SKIP_PLATFORM_CHECK","NODE_TEST_CONTEXT","NODE_TLS_REJECT_UNAUTHORIZED","NODE_UNIQUE_ID","NODE_USE_ENV_PROXY","NODE_USE_SYSTEM_CA","NODE_V8_COVERAGE","OPENSSL_CONF","OPENSSL_CONF_INCLUDE","OPENSSL_ENGINES","OPENSSL_MALLOC_FAILURES","OPENSSL_MALLOC_FD","OPENSSL_MALLOC_SEED","OPENSSL_MODULES","OPENSSL_WIN32_UTF8","OPENSSL_IA32CAP","SSL_CERT_DIR","SSL_CERT_FILE","WATCH_REPORT_DEPENDENCIES","NODE_DISABLE_COLORS","FORCE_COLOR","NO_COLOR","TZ","UV_THREADPOOL_SIZE","COR_ENABLE_PROFILING","COR_PROFILER","COR_PROFILER_PATH","COR_PROFILER_PATH_32","COR_PROFILER_PATH_64","COR_PROFILER_PATH_ARM64","APPDOMAIN_MANAGER_ASM","APPDOMAIN_MANAGER_TYPE","DEVPATH","COMPLUS_PROFAPI_PROFILERCOMPATIBILITYSETTING","COMPLUS_MDA","PSMODULEANALYSISCACHEPATH","PSDISABLEMODULEANALYSISCACHECLEANUP"].map(name=>name.toUpperCase()));
const cleanForbiddenFallback=new Set([...cleanStartupControls,...cleanPlatformFields.map(name=>name.toUpperCase()),'HOME','WINDIR','PSEXECUTIONPOLICYPREFERENCE','JARVIS_PRODUCTION_CONFIG','GORIQ_RUNTIME_REVISION','NODE_ENV']);
const prototypeNames=new Set(Object.getOwnPropertyNames(Object.prototype).map(name=>name.toUpperCase()));
function cutoverProjection(value,depth=0){
 if(depth>16)fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(item=>cutoverProjection(item,depth+1));
 if(!object(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,cutoverProjection(value[key],depth+1)]));
}
export function deriveCutoverCleanEnvironmentData(configuration,releaseRoot,fallbackBytes,platform){
 try{
  if(!exact(platform,cleanPlatformFields)||cleanPlatformFields.some(name=>typeof platform[name]!=='string'||!platform[name]||/[\r\n\0]/.test(platform[name]))||!Array.isArray(fallbackBytes)||fallbackBytes.length!==2||fallbackBytes.some(bytes=>!(bytes instanceof Uint8Array)||bytes.byteLength>65536))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
  const configured=validateProductionConfig(configuration,releaseRoot),values=new Map();
  const put=(name,value,overwrite=false)=>{const folded=name.toUpperCase();if(overwrite||!values.has(folded))values.set(folded,{name,value});};
  for(const [name,value] of Object.entries(platform))put(name,value);
  put('WINDIR',platform.SystemRoot);
  for(const [name,value] of Object.entries(configured))put(name,value,true);
  for(const bytes of fallbackBytes){
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
   for(const rawLine of text.split(/\r?\n/)){
    const line=rawLine.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<=0)continue;
    const name=line.slice(0,index).trim(),folded=name.toUpperCase();let value=line.slice(index+1).trim();
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||prototypeNames.has(folded)||cleanForbiddenFallback.has(folded)||value.includes('\0'))fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');
    if(value.startsWith('"')&&value.endsWith('"')||value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
    put(name,value);
   }
  }
  const projection=cutoverProjection(configuration);delete projection.environment.JARVIS_OWNER_SECRET;
  const environment=Object.fromEntries([...values.values()].map(({name,value})=>[name,value]));
  return frozenTree({profile:'goriq-clean-start-environment-data-v1',effectCapability:false,environment,nonOwnerProjectionSha256:hash(JSON.stringify(projection)),fallbackSha256:fallbackBytes.map(hash)});
 }catch{fail('ROTATION_CUTOVER_ENVIRONMENT_REJECTED');}
}

export const ROTATION_PUBLIC_SOURCE_FILES=Object.freeze([...ROTATION_SOURCE_FILES,'scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1']);
const publicFlags=['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'];
const grantFields=['schemaVersion','kind','scopeId','issue','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','sourceHashes','ciRunId','ciRunAttempt','workflowPath','ownerSidSha256','profile','operation','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars',...publicFlags];
export function compilePublicRotationGrant(encoded,environment=process.env,now=Date.now()){
 const g=decodeRotationEntryDescriptor(encoded);
 if(grantFields.filter(k=>!['schemaVersion','issue','sourceHashes','ciRunAttempt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars',...publicFlags].includes(k)).some(k=>typeof g[k]!=='string'))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 const issued=Date.parse(g.issuedAt),expires=Date.parse(g.expiresAt);
 if(!exact(g,grantFields)||g.schemaVersion!==1||g.kind!=='NONSECRET_ORIGINAL_ROTATION_GRANT'||g.scopeId!=='issue:1218:owner-code-rotation'||g.issue!==1218||g.goalId!=='goal-fcc81c97e09153f7'||g.authorityType!=='FRESH_OWNER_HIGH_ROTATION_RESTORATION_APPROVAL'||g.issuedBy!=='owner-approved-task-operator'||g.profile!=='jarvis-owner-production-v1'||g.operation!=='rotate-verify-restore-verify-original'||g.maxAttempts!==1||g.maxDurationSeconds!==900||g.recoveryReserveSeconds!==120||publicFlags.some(f=>g[f]!==true))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(g.approvalId)||!/^owner-approval:[a-f0-9]{64}$/.test(g.approvalReference)||!/^[a-f0-9]{40}$/.test(g.sourceRevision)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(g.issuedAt)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(g.expiresAt)||!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires-now<900000||expires-issued>7200000||expires>Date.parse('2026-11-10T08:00:00Z')||!/^owner-approval:/.test(g.approvalReference)||!/^[1-9]\d{0,19}$/.test(g.ciRunId)||g.ciRunAttempt!==1||g.workflowPath!=='.github/workflows/gai-zbook-diagnostic-1218.yml'||!/^[a-f0-9]{64}$/.test(g.ownerSidSha256))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(!exact(g.sourceHashes,ROTATION_PUBLIC_SOURCE_FILES)||Object.values(g.sourceHashes).some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))||!exact(g.cohortAuthority,['kind','expectedCount'])||g.cohortAuthority.kind!=='approved-active-capture'||g.cohortAuthority.expectedCount!==38||!exact(g.pcSidecars,['profile','expectedTaskFile','expectedObservationFile'])||g.pcSidecars.profile!=='jarvis-pc-sidecars-v1'||!['present','absent'].includes(g.pcSidecars.expectedTaskFile)||!['present','absent'].includes(g.pcSidecars.expectedObservationFile))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(environment.GITHUB_ACTOR!=='haji84'||environment.GITHUB_REPOSITORY!=='haji84/AI-'||environment.GITHUB_REF!=='refs/heads/main'||environment.GITHUB_SHA!==g.sourceRevision||!/^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID)||environment.GITHUB_RUN_ATTEMPT!=='1'||environment.GITHUB_WORKFLOW_REF!=='haji84/AI-/'+g.workflowPath+'@refs/heads/main'||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 return {grant:g,originalGrantSha256:hash(JSON.stringify(g))};
}

// Source40 data boundary only. These records and clocks never grant a native
// capability; official proof/source and OS admission must precede live wiring.
export const ROTATION_CUTOVER_PUBLIC_SOURCE_FILES=Object.freeze([...ROTATION_PUBLIC_SOURCE_FILES,'scripts/owner-code-production-cutover-1218.ps1']);
const cutoverData=new WeakMap(),cutoverClocks=new WeakMap(),clockOwners=new WeakSet(),allocatedClocks=new Map();
const proofFlags=['explicitOwnerApproval','createEphemeralAccountApproval','temporaryPasswordPersistenceApproval','temporaryTaskRegistrationApproval','conditionalBatchLogonRightApproval','ownObjectCleanupApproval'];
const proofKeys=['schemaVersion','scopeId','goalId','sourceRevision','scriptSha256','issuedAt','expiresAt','attemptId','runBinding','maxAttempts','maxAccounts','maxTasks','maxJobs','maxDurationSeconds','cleanupReserveSeconds','maxTotalSeconds',...proofFlags];
const cutoverNode={approved:true,version:'24.19.0',architecture:'x64',archiveSha256:'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73',nodeSha256:'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',signerCertificateSha256:'c5b94f1334367cb4fa004504d0cb62a558d30e1c3c712f729a02333bf5011522',publisher:'OpenJS Foundation',retention:'while-referenced'};
const cutoverEnvironment=['GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW_REF'];
function frozenTree(value){if(object(value)||Array.isArray(value)){for(const child of Object.values(value))frozenTree(child);Object.freeze(value);}return value;}
function cutoverBytes(encoded,maximum){
 if(typeof encoded!=='string'||encoded.length>4*Math.ceil(maximum/3)||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>maximum||bytes.toString('base64')!==encoded)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');return bytes;
}
function cutoverJson(bytes){
 try{const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);if(!object(value)||JSON.stringify(value)!==wire)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');return value;}catch{fail('ROTATION_CUTOVER_SCOPE_REQUIRED');}
}
function cutoverIso(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function cutoverProofApproval(encoded){
 const a=cutoverJson(cutoverBytes(encoded,1024));
 if(!exact(a,proofKeys)||a.schemaVersion!==2||a.scopeId!=='issue:1218:ephemeral-password-task-retention-proof'||a.goalId!=='goal-fcc81c97e09153f7'||typeof a.sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(a.sourceRevision)||a.scriptSha256!=='1698f5238d2ca735dee2cfad7c5ed1238f396866220aeebf3624bab560edecca'||!cutoverIso(a.issuedAt)||!cutoverIso(a.expiresAt)||Date.parse(a.expiresAt)-Date.parse(a.issuedAt)<600000||Date.parse(a.expiresAt)-Date.parse(a.issuedAt)>7200000||typeof a.attemptId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.attemptId)||a.runBinding!=='one-current-dispatch-attempt-1'||['maxAttempts','maxAccounts','maxTasks','maxJobs'].some(k=>a[k]!==1)||a.maxDurationSeconds!==480||a.cleanupReserveSeconds!==120||a.maxTotalSeconds!==600||proofFlags.some(k=>a[k]!==true))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 return a;
}
export function compilePublicCutoverGrant(encoded,environment=process.env,now=Date.now()){
 const bytes=cutoverBytes(encoded,32768),g=cutoverJson(bytes);
 if(!exact(g,[...grantFields,'taskActionMigration','knownRecoveryTask','protectedNodeBootstrap','credentialProof'])||g.schemaVersion!==2||g.profile!=='jarvis-owner-production-cutover-v1'||g.operation!=='cutover-rotate-verify-restore-verify-original'||!cutoverIso(g.issuedAt)||!cutoverIso(g.expiresAt)||!exact(g.sourceHashes,ROTATION_CUTOVER_PUBLIC_SOURCE_FILES)||Object.values(g.sourceHashes).some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 // Reuse only common validation. This projection is never returned/transported
 // as a v1 authority, and its hash is never substituted for the original wire.
 const common=Object.fromEntries(grantFields.map(k=>[k,g[k]]));common.schemaVersion=1;common.profile='jarvis-owner-production-v1';common.operation='rotate-verify-restore-verify-original';common.sourceHashes=Object.fromEntries(ROTATION_PUBLIC_SOURCE_FILES.map(k=>[k,g.sourceHashes[k]]));
 compilePublicRotationGrant(Buffer.from(JSON.stringify(common)).toString('base64'),environment,now);
 const task=g.taskActionMigration,recovery=g.knownRecoveryTask,proof=g.credentialProof;
 if(!exact(task,['approved','taskName','taskPath','target'])||task.approved!==true||task.taskName!=='JARVIS Remote Host'||task.taskPath!=='\\'||task.target!=='bound-direct-node'||!exact(recovery,['approved','profile','maxTasks','allowedOperations','disposition'])||recovery.approved!==true||recovery.profile!=='interactive-owner-limited-manual-v1'||recovery.maxTasks!==1||!Array.isArray(recovery.allowedOperations)||JSON.stringify(recovery.allowedOperations)!=='["preflight","recover-known-runtime"]'||recovery.disposition!=='retain-until-password-primary-healthy'||!exact(g.protectedNodeBootstrap,Object.keys(cutoverNode))||Object.entries(cutoverNode).some(([k,v])=>g.protectedNodeBootstrap[k]!==v))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 if(!exact(proof,['runId','jobId','artifactId','approvalBase64','archiveBase64','dispatchLedgerSha256','independentVerdictSha256'])||['runId','jobId','artifactId'].some(k=>typeof proof[k]!=='string'||!/^[1-9]\d{0,19}$/.test(proof[k]))||['dispatchLedgerSha256','independentVerdictSha256'].some(k=>typeof proof[k]!=='string'||!/^[a-f0-9]{64}$/.test(proof[k])))fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const approval=cutoverProofApproval(proof.approvalBase64),archive=cutoverBytes(proof.archiveBase64,16384);
 if(archive.length<22||archive.readUInt32LE(0)!==0x04034b50)fail('ROTATION_CUTOVER_SCOPE_REQUIRED');
 const result=frozenTree({grant:g,originalGrantSha256:hash(bytes),proofApproval:approval,proofArchiveSha256:hash(archive),effectCapability:false});
 cutoverData.set(result,{environment:Object.fromEntries(cutoverEnvironment.map(k=>[k,environment[k]]))});return result;
}
export function createCutoverClock(data,jobs,environment=process.env,{utcClock=Date.now,monoClock=()=>performance.now()}={}){
 const record=cutoverData.get(data);if(!record||clockOwners.has(data)||cutoverEnvironment.some(k=>environment[k]!==record.environment[k])||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
 const utc=utcClock(),mono=monoClock();if(!Number.isFinite(utc)||!Number.isFinite(mono)||mono<0)fail('ROTATION_CUTOVER_CLOCK_INVALID');
 const jobHard=validateAllocatedRotationJob(jobs,data.grant,environment,utc),job=jobs.jobs.find(j=>j.name==='inspect');
 const allocation=JSON.stringify([environment.GITHUB_REPOSITORY,environment.GITHUB_WORKFLOW_REF,environment.GITHUB_RUN_ID,environment.GITHUB_RUN_ATTEMPT,'inspect']),original=allocatedClocks.get(allocation);
 if(original){
  if(original.grantSha256!==data.originalGrantSha256||original.jobId!==job.id||original.jobStartedAt!==job.started_at)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
  // Exact recompilation may retrieve only the original token/callbacks. In
  // particular a stalled UTC clock cannot issue a fresh monotonic anchor.
  observeCutoverClock(original.token,'Recovery');clockOwners.add(data);return original.token;
 }
 const hardEnd=Math.min(Date.parse(job.started_at)+900000,Date.parse(data.grant.expiresAt),jobHard);
 if(hardEnd-utc<=120000)fail('ROTATION_CUTOVER_FORWARD_RESERVE');
 const token=Object.freeze({});cutoverClocks.set(token,{utcClock,monoClock,lastUtc:utc,lastMono:mono,hardEnd,hardMono:mono+(hardEnd-utc),terminal:null});clockOwners.add(data);allocatedClocks.set(allocation,{token,grantSha256:data.originalGrantSha256,jobId:job.id,jobStartedAt:job.started_at});return token;
}
export function observeCutoverClock(token,phase,minimumRemainingMs=0){
 const c=cutoverClocks.get(token);if(!c||!['Forward','Recovery'].includes(phase)||!Number.isFinite(minimumRemainingMs)||minimumRemainingMs<0)fail('ROTATION_CUTOVER_CLOCK_REQUIRED');
 if(c.terminal)fail(c.terminal);
 const utc=c.utcClock(),mono=c.monoClock();
 if(!Number.isFinite(utc)||!Number.isFinite(mono)||utc<c.lastUtc||mono<c.lastMono){c.terminal='ROTATION_CUTOVER_CLOCK_INVALID';fail(c.terminal);}
 c.lastUtc=utc;c.lastMono=mono;
 const hardRemaining=Math.min(c.hardEnd-utc,c.hardMono-mono),forwardRemaining=hardRemaining-120000;
 if(hardRemaining<=0){c.terminal='ROTATION_CUTOVER_DEADLINE';fail(c.terminal);}
 if((phase==='Forward'?forwardRemaining:hardRemaining)<=minimumRemainingMs)fail('ROTATION_CUTOVER_FORWARD_RESERVE');
 return Object.freeze({hardEndUtc:new Date(c.hardEnd).toISOString(),forwardEndUtc:new Date(c.hardEnd-120000).toISOString(),remainingHardMs:hardRemaining,remainingForwardMs:Math.max(0,forwardRemaining)});
}

const credentialProofData=new WeakMap();
const credentialProofScript='1698f5238d2ca735dee2cfad7c5ed1238f396866220aeebf3624bab560edecca',credentialProofWorkflow='a56f91a0b2637b7b618fa32f3a0ccf373b4d69ee3a47bc9c31bbcfe1814da071';
const proofTrue=['validationAccepted','accountCreated','taskCreated','baselineRan','changedRan','restoredRan','actualAccountSidMatched','passwordLogonPreserved','limitedPrincipalPreserved','nonActionDefinitionPreserved','taskSecurityPreserved','actionRestored','updateOmittedUserAndPassword','restoreOmittedUserAndPassword','allThreeActionFieldsChanged','taskRemoved','accountRemoved','ownProfileRemovedOrAbsent','ownBatchRightRemovedOrAbsent','ownFilesRemoved','cleanupVerified','deadlineBudgetAdmitted','forwardCompleted','finalDeadlineValid'];
const proofFalse=['existingTaskTouched','productionTouched','forwardDeadlineExceeded','cleanupDeadlineExceeded','hardDeadlineExceeded','credentialValueEmitted','rawIdentityOrPathEmitted'];
const proofResultKeys=['schemaVersion','issue','operation','complete','mode','failureCode','failedStage','cleanupFailureCode','sourceRevision','scriptSha256','approvalSha256','runId','runAttempt','attemptId','validationAccepted','accountCreated','taskCreated','conditionalBatchRightAdded','baselineRan','changedRan','restoredRan','actualAccountSidMatched','passwordLogonPreserved','limitedPrincipalPreserved','nonActionDefinitionPreserved','taskSecurityPreserved','actionRestored','updateOmittedUserAndPassword','restoreOmittedUserAndPassword','allThreeActionFieldsChanged','windowsBuild','taskRemoved','accountRemoved','ownProfileRemovedOrAbsent','ownBatchRightRemovedOrAbsent','ownFilesRemoved','cleanupVerified','existingTaskTouched','productionTouched','deadlineBudgetAdmitted','forwardCompleted','finalDeadlineValid','forwardDeadlineExceeded','cleanupDeadlineExceeded','hardDeadlineExceeded','credentialValueEmitted','rawIdentityOrPathEmitted','nativeZBookAcceptanceCredit','diagnostics'];
const proofComponents=['FORWARD','TASK','ACCOUNT_DISABLE','BATCH_RIGHT','PROFILE','ACCOUNT_REMOVE','FILES','NONE'];
function proofNeed(condition){if(!condition)fail('ROTATION_CUTOVER_PROOF_REJECTED');}
function proofInteger(value,minimum,maximum){return Number.isSafeInteger(value)&&value>=minimum&&value<=maximum;}
function proofFault(value){
 if(value===null)return true;
 const domains={component:proofComponents,operation:['TASK_ACTION_UPDATE','TASK_ACTION_RESTORE','PROFILE_QUERY','PROFILE_REMOVE','PROFILE_READBACK','OTHER'],origin:['PRE_GUARD','CALL_THROW','POST_GUARD','SOURCE_REFUSAL','UNKNOWN'],callState:['NOT_ENTERED','THREW','RETURNED','NOT_APPLICABLE','UNKNOWN'],exceptionKind:['NONE','CIM','WIN32','COM','POWERSHELL','DOTNET','UNKNOWN']},numbers=['hresult','win32NativeCode','cimNativeCode','cimStatusCode','cimProviderErrorCode'];
 return exact(value,[...Object.keys(domains),...numbers])&&Object.entries(domains).every(([key,allowed])=>typeof value[key]==='string'&&allowed.includes(value[key]))&&numbers.every(key=>value[key]===null||proofInteger(value[key],key==='hresult'?-2147483648:0,key==='hresult'?2147483647:4294967295));
}
function proofResult(value){
 const failures=['PROOF_MODE_REQUIRED','PROOF_APPROVAL_REQUIRED','PROOF_CONTEXT_REQUIRED','PROOF_HOSTED_WINDOWS_REQUIRED','PROOF_HOSTED_ADMIN_REQUIRED','PROOF_OWN_OBJECT_COLLISION','PROOF_ACCOUNT_BOUNDARY_CHANGED','PROOF_BATCH_LOGON_REFUSED','PROOF_TASK_BOUNDARY_CHANGED','PROOF_EXECUTION_FAILED','PROOF_ACCOUNT_EXECUTION_MISMATCH','PROOF_JOB_BUDGET_REQUIRED','PROOF_CLOCK_INVALID','PROOF_HARD_DEADLINE','PROOF_FORWARD_DEADLINE','PROOF_FORWARD_RESERVE','PROOF_CLEANUP_DEADLINE','PROOF_CLEANUP_NOT_STARTED','PROOF_CLEANUP_FAILED','PROOF_OPERATION_FAILED'];
 const stages=['approval','platform','native-callback','account','batch-right','own-files','registration','baseline','action-update','changed-execution','action-restore','restored-execution','cleanup','final-deadline'];
 proofNeed(exact(value,proofResultKeys)&&value.schemaVersion===3&&value.issue===1218&&value.runAttempt===1&&value.nativeZBookAcceptanceCredit===0&&value.operation==='ephemeral-password-task-retention-proof'&&value.mode==='APPLY');
 proofNeed(['schemaVersion','issue','runAttempt','nativeZBookAcceptanceCredit'].every(k=>Number.isSafeInteger(value[k]))&&['complete','conditionalBatchRightAdded',...proofTrue,...proofFalse].every(k=>typeof value[k]==='boolean'));
 proofNeed(['sourceRevision','scriptSha256','approvalSha256'].every(k=>typeof value[k]==='string'&&new RegExp('^[a-f0-9]{'+(k==='sourceRevision'?40:64)+'}$').test(value[k]))&&typeof value.runId==='string'&&/^[1-9]\d{0,19}$/.test(value.runId)&&typeof value.attemptId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.attemptId)&&typeof value.windowsBuild==='string'&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value.windowsBuild));
 proofNeed(['failureCode','cleanupFailureCode'].every(k=>value[k]===null||typeof value[k]==='string'&&failures.includes(value[k]))&&(value.failedStage===null||typeof value.failedStage==='string'&&stages.includes(value.failedStage)));
 const d=value.diagnostics;proofNeed(exact(d,['version','forwardFailure','cleanupFailure','cleanupFailedComponents','profileCleanupState'])&&d.version===1&&Number.isSafeInteger(d.version)&&proofFault(d.forwardFailure)&&proofFault(d.cleanupFailure)&&Array.isArray(d.cleanupFailedComponents)&&d.cleanupFailedComponents.length<=6&&new Set(d.cleanupFailedComponents).size===d.cleanupFailedComponents.length&&d.cleanupFailedComponents.every(c=>typeof c==='string'&&proofComponents.includes(c)&&!['FORWARD','NONE'].includes(c))&&typeof d.profileCleanupState==='string'&&['NOT_CHECKED','QUERY_FAILED','SID_MISMATCH_REFUSED','SPECIAL_REFUSED','LOADED_REFUSED','REMOVE_FAILED','READBACK_FAILED','STILL_PRESENT','ABSENT_CONFIRMED','REMOVED_AND_ABSENT_CONFIRMED'].includes(d.profileCleanupState));
 proofNeed(!/S-\d-\d|[A-Za-z]:\\|grq25[a-f0-9]{12}/.test(JSON.stringify(value)));return value;
}
function proofCrc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function readCutoverProofArchive(bytes){
 try{
  proofNeed(Buffer.isBuffer(bytes)&&bytes.length>=22&&bytes.length<=16384);
  const end=bytes.length-22;proofNeed(bytes.readUInt32LE(end)===0x06054b50&&bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===1&&bytes.readUInt16LE(end+10)===1&&bytes.readUInt16LE(end+20)===0);
  const central=bytes.readUInt32LE(end+16),centralSize=bytes.readUInt32LE(end+12),name=Buffer.from('password-task-retention-proof.json');
  proofNeed(central>0&&central+centralSize===end&&centralSize===46+name.length&&bytes.readUInt32LE(central)===0x02014b50);
  const needed=bytes.readUInt16LE(central+6),flags=bytes.readUInt16LE(central+8),method=bytes.readUInt16LE(central+10),crc=bytes.readUInt32LE(central+16),packedSize=bytes.readUInt32LE(central+20),expandedSize=bytes.readUInt32LE(central+24),type=(bytes.readUInt32LE(central+38)>>>16)&0xf000;
  proofNeed([0,8].includes(method)&&(needed===20||method===0&&needed===10)&&(flags&~0x808)===0&&packedSize>0&&packedSize<=16384&&expandedSize>0&&expandedSize<=16384&&bytes.readUInt16LE(central+28)===name.length&&bytes.readUInt16LE(central+30)===0&&bytes.readUInt16LE(central+32)===0&&bytes.readUInt16LE(central+34)===0&&bytes.readUInt32LE(central+42)===0&&[0,0x8000].includes(type)&&(bytes.readUInt32LE(central+38)&0x10)===0&&bytes.subarray(central+46,central+46+name.length).equals(name));
  proofNeed(bytes.readUInt32LE(0)===0x04034b50&&bytes.readUInt16LE(4)===needed&&bytes.readUInt16LE(6)===flags&&bytes.readUInt16LE(8)===method&&bytes.readUInt16LE(26)===name.length&&bytes.readUInt16LE(28)===0&&bytes.subarray(30,30+name.length).equals(name));
  const begin=30+name.length,finish=begin+packedSize;proofNeed(finish<=central);
  if(flags&8)proofNeed(bytes.readUInt32LE(14)===0&&bytes.readUInt32LE(18)===0&&bytes.readUInt32LE(22)===0&&finish+16===central&&bytes.readUInt32LE(finish)===0x08074b50&&bytes.readUInt32LE(finish+4)===crc&&bytes.readUInt32LE(finish+8)===packedSize&&bytes.readUInt32LE(finish+12)===expandedSize);
  else proofNeed(finish===central&&bytes.readUInt32LE(14)===crc&&bytes.readUInt32LE(18)===packedSize&&bytes.readUInt32LE(22)===expandedSize);
  const packed=bytes.subarray(begin,finish);let expanded;
  if(method===8){const data=inflateRawSync(packed,{maxOutputLength:16384,info:true});proofNeed(data.engine.bytesWritten===packed.length);expanded=data.buffer;}else expanded=Buffer.from(packed);
  proofNeed(expanded.length===expandedSize&&proofCrc32(expanded)===crc);
  let wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(expanded);if(wire.startsWith('\uFEFF'))wire=wire.slice(1);if(wire.endsWith('\r\n'))wire=wire.slice(0,-2);else if(wire.endsWith('\n'))wire=wire.slice(0,-1);
  const result=JSON.parse(wire);proofNeed(object(result)&&JSON.stringify(result)===wire);proofResult(result);
  return frozenTree({result,resultSha256:hash(expanded),archiveSha256:hash(bytes),effectCapability:false});
 }catch{fail('ROTATION_CUTOVER_PROOF_ARCHIVE_REJECTED');}
}
function proofMetadata(bytes){
 const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);proofNeed(object(value));
 const stack=[],tokens=/"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*"|[{}[\],:]/g;let token;
 while((token=tokens.exec(wire))){const t=token[0];if(t==='{')stack.push({object:true,key:true,seen:new Set()});else if(t==='[')stack.push({object:false});else if(t==='}'||t===']')stack.pop();else if(t===','&&stack.at(-1)?.object)stack.at(-1).key=true;else if(t[0]==='"'&&stack.at(-1)?.object&&stack.at(-1).key){const key=JSON.parse(t),frame=stack.at(-1);proofNeed(!frame.seen.has(key));frame.seen.add(key);frame.key=false;}}
 const finite=(item,depth=0)=>{proofNeed(depth<=40);if(typeof item==='number')proofNeed(Number.isFinite(item));if(object(item)||Array.isArray(item))for(const child of Object.values(item))finite(child,depth+1);};finite(value);return value;
}
function proofDate(value){proofNeed(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value)));const stamp=Date.parse(value);proofNeed(new Date(stamp).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z')));return stamp;}
export async function verifyCutoverCredentialProof(data,fetcher=fetch,now=Date.now()){
 try{
  proofNeed(cutoverData.has(data)&&typeof fetcher==='function'&&Number.isFinite(now)&&Date.parse(data.grant.issuedAt)<=now&&now<Date.parse(data.grant.expiresAt));
  const g=data.grant.credentialProof,a=data.proofApproval,archive=readCutoverProofArchive(cutoverBytes(g.archiveBase64,16384)),r=archive.result;
  proofNeed(r.complete&&proofTrue.every(k=>r[k]===true)&&proofFalse.every(k=>r[k]===false)&&r.failureCode===null&&r.failedStage===null&&r.cleanupFailureCode===null&&r.sourceRevision===a.sourceRevision&&r.scriptSha256===credentialProofScript&&r.approvalSha256===hash(cutoverBytes(g.approvalBase64,1024))&&r.runId===g.runId&&r.attemptId===a.attemptId);
  const get=async url=>{const response=await fetcher(url,{method:'GET',headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});proofNeed(response.status===200&&response.ok===true&&response.redirected===false&&response.url===url&&typeof response.body?.[Symbol.asyncIterator]==='function');const chunks=[];let total=0;for await(const chunk of response.body){proofNeed(chunk instanceof Uint8Array);total+=chunk.byteLength;proofNeed(total<=65536);chunks.push(Buffer.from(chunk));}proofNeed(total>0);return Buffer.concat(chunks);};
  const base='https://api.github.com/repos/haji84/AI-/',run=proofMetadata(await get(base+'actions/runs/'+g.runId));
  proofNeed(proofInteger(run.id,1,Number.MAX_SAFE_INTEGER)&&String(run.id)===g.runId&&run.run_attempt===1&&run.name==='GORIQ 1218 Ephemeral Password Task Retention Proof'&&run.path==='.github/workflows/gai-owner-task-credential-proof-1218.yml'&&run.event==='workflow_dispatch'&&run.status==='completed'&&run.conclusion==='success'&&run.head_sha===a.sourceRevision&&run.head_branch==='main'&&run.repository?.full_name==='haji84/AI-'&&proofInteger(run.repository.id,1,Number.MAX_SAFE_INTEGER)&&run.head_repository?.full_name==='haji84/AI-'&&run.head_repository.id===run.repository.id&&run.actor?.login==='haji84'&&run.triggering_actor?.login==='haji84');
  const issued=Date.parse(a.issuedAt),expires=Date.parse(a.expiresAt),created=proofDate(run.created_at),updated=proofDate(run.updated_at);proofNeed(issued<=created&&created<=updated&&updated<=now);
  const jobs=proofMetadata(await get(base+'actions/runs/'+g.runId+'/attempts/1/jobs?per_page=100'));proofNeed(jobs.total_count===1&&Array.isArray(jobs.jobs)&&jobs.jobs.length===1);const job=jobs.jobs[0];
  proofNeed(proofInteger(job.id,1,Number.MAX_SAFE_INTEGER)&&String(job.id)===g.jobId&&job.run_id===run.id&&job.run_attempt===1&&job.head_sha===a.sourceRevision&&job.name==='proof'&&job.status==='completed'&&job.conclusion==='success'&&proofInteger(job.runner_id,1,Number.MAX_SAFE_INTEGER)&&typeof job.runner_name==='string'&&/^GitHub Actions \d+$/.test(job.runner_name)&&job.runner_group_name==='GitHub Actions'&&Array.isArray(job.labels)&&job.labels.includes('windows-2025')&&!job.labels.includes('self-hosted')&&Array.isArray(job.steps)&&job.steps.length<=100);
  const step=name=>{const matches=job.steps.filter(s=>object(s)&&s.name===name);proofNeed(matches.length===1);const s=matches[0];proofNeed(proofInteger(s.number,1,100)&&s.status==='completed'&&s.conclusion==='success');return {...s,start:proofDate(s.started_at),end:proofDate(s.completed_at)};};
  const source=step('Require exact current main with successful CI'),execute=step('Inert plan or separately approved isolated credential-retention fixture'),upload=step('Retain closed proof only'),jobStart=proofDate(job.started_at),jobEnd=proofDate(job.completed_at);
  proofNeed(created<=jobStart&&issued<=jobStart&&jobStart<=source.start&&source.start<=source.end&&source.end<=execute.start&&execute.start<execute.end&&execute.end<=upload.start&&upload.start<=upload.end&&upload.end<=jobEnd&&jobEnd<=updated&&jobEnd-jobStart<=900000&&execute.end-execute.start<=660000&&issued<=execute.start&&execute.end<=expires&&source.number<execute.number&&execute.number<upload.number);
  const artifacts=proofMetadata(await get(base+'actions/runs/'+g.runId+'/artifacts?per_page=100'));proofNeed(artifacts.total_count===1&&Array.isArray(artifacts.artifacts)&&artifacts.artifacts.length===1);const artifact=artifacts.artifacts[0];
  proofNeed(proofInteger(artifact.id,1,Number.MAX_SAFE_INTEGER)&&String(artifact.id)===g.artifactId&&artifact.name==='goriq-1218-password-task-retention-proof'&&artifact.expired===false&&proofInteger(artifact.size_in_bytes,1,16384)&&artifact.digest==='sha256:'+archive.archiveSha256&&artifact.workflow_run?.id===run.id&&artifact.workflow_run.repository_id===run.repository.id&&artifact.workflow_run.head_repository_id===run.repository.id&&artifact.workflow_run.head_branch==='main'&&artifact.workflow_run.head_sha===a.sourceRevision);
  const artifactCreated=proofDate(artifact.created_at),artifactUpdated=proofDate(artifact.updated_at);proofNeed(upload.start<=artifactCreated&&artifactCreated<=artifactUpdated&&artifactUpdated<=jobEnd&&proofDate(artifact.expires_at)>now);
  const raw='https://raw.githubusercontent.com/haji84/AI-/'+a.sourceRevision+'/';proofNeed(hash(await get(raw+'scripts/owner-code-task-credential-retention-proof-1218.ps1'))===credentialProofScript&&hash(await get(raw+'.github/workflows/gai-owner-task-credential-proof-1218.yml'))===credentialProofWorkflow);
  const evidence=frozenTree({kind:'VERIFIED_CREDENTIAL_PROOF_DATA',effectCapability:false,referenceContentsVerified:false,runId:g.runId,jobId:g.jobId,artifactId:g.artifactId,archiveSha256:archive.archiveSha256,resultSha256:archive.resultSha256,approvalSha256:r.approvalSha256,proofSourceRevision:a.sourceRevision,proofScriptSha256:credentialProofScript,proofWorkflowSha256:credentialProofWorkflow,executionStartedAt:execute.started_at,executionCompletedAt:execute.completed_at,dispatchLedgerSha256:g.dispatchLedgerSha256,independentVerdictSha256:g.independentVerdictSha256});
  credentialProofData.set(evidence,{originalGrantSha256:data.originalGrantSha256});return evidence;
 }catch{fail('ROTATION_CUTOVER_PROOF_REJECTED');}
}
export async function verifyPublicRotationSource(grant,fetcher=fetch){
 const get=async path=>{const response=await fetcher(path,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!response.body)fail('ROTATION_ENTRY_SOURCE_REJECTED');let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.byteLength;if(n>1048576)fail('ROTATION_ENTRY_SOURCE_REJECTED');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);};
 try{
  const base='https://api.github.com/repos/haji84/AI-/',main=JSON.parse((await get(base+'git/ref/heads/main')).toString()),run=JSON.parse((await get(base+'actions/runs/'+grant.ciRunId)).toString()),jobs=JSON.parse((await get(base+'actions/runs/'+grant.ciRunId+'/attempts/1/jobs?per_page=100')).toString());
  if(main.object?.sha!==grant.sourceRevision||String(run.id)!==grant.ciRunId||run.run_attempt!==1||run.name!=='CI'||run.path!=='.github/workflows/ci.yml'||run.event!=='push'||run.head_branch!=='main'||run.head_sha!==grant.sourceRevision||run.status!=='completed'||run.conclusion!=='success'||!Array.isArray(jobs.jobs)||jobs.jobs.length!==4||['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'].some(name=>jobs.jobs.filter(j=>j.name===name&&j.status==='completed'&&j.conclusion==='success').length!==1))fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_PUBLIC_SOURCE_FILES){if(hash(regular(join(root,file)))!==grant.sourceHashes[file]||hash(await get('https://raw.githubusercontent.com/haji84/AI-/'+grant.sourceRevision+'/'+file))!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');}
  return true;
 }catch{fail('ROTATION_ENTRY_SOURCE_REJECTED');}
}
export function bindRotationRunScope(scope,environment=process.env,now=Date.now()){
 if(!object(scope)||strings.some(key=>typeof scope[key]!=='string')||['maxAttempts','maxDurationSeconds','recoveryReserveSeconds'].some(key=>!Number.isInteger(scope[key])))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(scope.cohortAuthority?.kind==='original-cohort-digest'&&typeof scope.cohortAuthority.cohortSha256!=='string')fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 if(environment.GITHUB_ACTOR!=='haji84'||environment.GITHUB_REPOSITORY!=='haji84/AI-'||environment.GITHUB_REF!=='refs/heads/main'||typeof environment.GITHUB_SHA!=='string'||!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA)||typeof environment.GITHUB_RUN_ID!=='string'||!/^[1-9]\d*$/.test(environment.GITHUB_RUN_ID)||environment.GITHUB_RUN_ATTEMPT!=='1'||environment.JARVIS_PRODUCTION_CONFIG)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const hasRun=Object.hasOwn(scope,'workflowRunId'),hasAttempt=Object.hasOwn(scope,'workflowRunAttempt');
 if(hasRun!==hasAttempt||hasRun&&(typeof scope.workflowRunId!=='string'||scope.workflowRunId!==environment.GITHUB_RUN_ID||scope.workflowRunAttempt!==1))fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 if(scope.sourceRevision!==environment.GITHUB_SHA)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 try{validateRotationScope(scope,now);}catch{fail('ROTATION_ENTRY_SCOPE_REQUIRED');}
 return globalThis.structuredClone(hasRun?scope:{...scope,workflowRunId:environment.GITHUB_RUN_ID,workflowRunAttempt:1});
}
export function serializeRotationRunScope(scope){return JSON.stringify(scope);}
export function decodeRotationEntryDescriptor(encoded){
 try{
  if(typeof encoded!=='string'||encoded.length>87384||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))fail('ROTATION_ENTRY_SCOPE_REQUIRED');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length>65536||bytes.toString('base64')!==encoded)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
  const wire=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value=JSON.parse(wire);if(!object(value)||JSON.stringify(value)!==wire)fail('ROTATION_ENTRY_SCOPE_REQUIRED');return value;
 }catch{fail('ROTATION_ENTRY_SCOPE_REQUIRED');}
}
export function compileRotationEntryDescriptor(encoded,environment=process.env,now=Date.now()){
 const original=decodeRotationEntryDescriptor(encoded),scope=bindRotationRunScope(original,environment,now),wire=serializeRotationRunScope(scope);
 return {scope,scopeBase64:Buffer.from(wire).toString('base64'),originalDescriptorSha256:hash(JSON.stringify(original)),runtimeScopeSha256:hash(wire)};
}
export function buildRotationEntryEnvironment(environment,scopeBase64,descriptorSha256){
 const names=['OS','SystemRoot','SYSTEMROOT','WINDIR','Path','PATH','PATHEXT','COMSPEC','USERPROFILE','LOCALAPPDATA','TEMP','TMP','GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'];
 const clean=Object.fromEntries(names.filter(key=>typeof environment[key]==='string').map(key=>[key,environment[key]]));
 clean.GORIQ_OWNER_ROTATION_SCOPE_BASE64=scopeBase64;clean.GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256=descriptorSha256;return clean;
}
export async function runBoundedRotationPreparation(factory,{durationMs=30000,clock=Date.now}={}){
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>30000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return await new Promise(done=>{
  const started=clock();let child,output='',bytes=0,problem=null,settled=false;
  const failure=code=>({schemaVersion:1,complete:false,failureCode:code,profileMatchesEnvironment:false});
  const finish=record=>{if(settled)return;settled=true;clearTimeout(kill);clearTimeout(hard);done(record.complete&&clock()-started>durationMs?failure('ROTATION_ENTRY_TIMEOUT'):record);};
  const stop=code=>{problem??=code;try{child?.kill();}catch{}};
  const kill=setTimeout(()=>stop('ROTATION_ENTRY_TIMEOUT'),Math.max(1,durationMs-500)),hard=setTimeout(()=>{stop('ROTATION_ENTRY_TIMEOUT');finish(failure(problem));},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>1024){stop('ROTATION_ENTRY_PROTOCOL_FAILED');return;}output+=chunk;});child.stderr.on('data',()=>stop('ROTATION_ENTRY_PROTOCOL_FAILED'));child.on('error',()=>{stop('ROTATION_ENTRY_CHILD_UNAVAILABLE');finish(failure(problem));});
   child.on('close',exit=>{if(problem){finish(failure(problem));return;}try{const wire=output.trim(),r=JSON.parse(wire);if(JSON.stringify(r)!==wire||!exact(r,['schemaVersion','complete','failureCode','profileMatchesEnvironment'])||r.schemaVersion!==1||typeof r.complete!=='boolean'||typeof r.profileMatchesEnvironment!=='boolean'||exit!==(r.complete?0:1)||r.complete&&(r.failureCode!==null||!r.profileMatchesEnvironment)||!r.complete&&!prepCodes.includes(r.failureCode))fail('ROTATION_ENTRY_PROTOCOL_FAILED');finish(r);}catch{finish(failure('ROTATION_ENTRY_PROTOCOL_FAILED'));}});
  }catch{stop('ROTATION_ENTRY_CHILD_UNAVAILABLE');finish(failure(problem));}
 });
}

const fleetBooleans=['databaseBindingMatched','cohortAuthorityVerified','baselineCohortPreserved','fleetMetadataPreserved','identitiesPreserved','keysPreserved','workerLifecycleHistoryPreserved','auditRetainedHistoryPreserved','taskPayloadsPreserved','nonceProtectionPreserved'];
function projectController(value){
 const base=result('ROTATION_ENTRY_CONTROLLER_FAILED');
 if(exact(value,['schemaVersion','issue','complete','failureCode','wholeR06Verified'])&&value.schemaVersion===1&&value.issue===1218&&value.complete===false&&value.failureCode==='ROTATION_ACCEPTANCE_INCONCLUSIVE'&&value.wholeR06Verified===false)return base;
 if(!exact(value,['schemaVersion','issue','complete','rotation','fleetSqlitePreserved','fleet','pcSidecarsPreserved','wholeR06Verified','workerPrivateKeysVerified','sidecarAndCompassHistoryVerified'])||value.schemaVersion!==1||value.issue!==1218||typeof value.complete!=='boolean'||typeof value.fleetSqlitePreserved!=='boolean'||typeof value.pcSidecarsPreserved!=='boolean'||value.wholeR06Verified!==false||value.workerPrivateKeysVerified!==false||value.sidecarAndCompassHistoryVerified!==false)fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 validateRotationResult(value.rotation);
 let fleetChecks=null;
 if(value.fleet!==null){
  if(!object(value.fleet)||!['PASS','FAIL','INCONCLUSIVE'].includes(value.fleet.status)||fleetBooleans.some(key=>typeof value.fleet[key]!=='boolean'))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
  fleetChecks=Object.fromEntries(['status',...fleetBooleans].map(key=>[key,value.fleet[key]]));
 }
 if(value.fleetSqlitePreserved!==(fleetChecks?.status==='PASS')||fleetChecks===null&&value.pcSidecarsPreserved||fleetChecks?.status==='PASS'&&fleetBooleans.some(key=>!fleetChecks[key]))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 if(value.complete!==value.rotation.complete||(value.complete||value.rotation.rollbackVerified)&&(!value.fleetSqlitePreserved||!value.pcSidecarsPreserved||fleetChecks?.status!=='PASS'||fleetBooleans.some(key=>!fleetChecks[key])))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 return {...base,complete:value.complete,failureCode:value.complete?null:base.failureCode,rotation:value.rotation,fleetChecks,fleetSqlitePreserved:value.fleetSqlitePreserved,pcSidecarsPreserved:value.pcSidecarsPreserved};
}
export function rotationControllerDuration(scope,now=Date.now()){
 const expires=typeof scope?.expiresAt==='string'?Date.parse(scope.expiresAt):NaN,remaining=expires-now;
 // Narrow admission only; never rewrite the approved expiry. The controller's
 // own min(start+900s, expiry) deadline always precedes this transport bound.
 if(!Number.isFinite(remaining)||remaining<900000||remaining>1439000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return remaining+1000;
}
export function validateRotationJobBudget(data,scope,environment=process.env,now=Date.now()){
 bindRotationRunScope(scope,environment,now);rotationControllerDuration(scope,now);
 return validateAllocatedRotationJob(data,scope,environment,now);
}
function validateAllocatedRotationJob(data,scope,environment,now){
 if(!object(data)||!Array.isArray(data.jobs)||data.jobs.length>100||data.total_count!==data.jobs.length)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const matches=data.jobs.filter(job=>object(job)&&job.name==='inspect');
 if(matches.length!==1)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const job=matches[0],start=typeof job.started_at==='string'?Date.parse(job.started_at):NaN;
 if(!Number.isSafeInteger(job.id)||job.id<=0||!Number.isSafeInteger(job.run_id)||String(job.run_id)!==environment.GITHUB_RUN_ID||job.run_attempt!==1||job.head_sha!==scope.sourceRevision||job.status!=='in_progress'||job.completed_at!==null||!Number.isFinite(start)||start>now)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 const deadline=start+24*60000; // Existing25min job, with60s reserved for cleanup.
 if(Date.parse(scope.expiresAt)+1000>deadline)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
 return deadline;
}
export async function readRotationJobBudget(scope,environment=process.env,fetcher=fetch,clock=Date.now){
 try{
  bindRotationRunScope(scope,environment,clock());
  const response=await fetcher(`https://api.github.com/repos/haji84/AI-/actions/runs/${environment.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>65536)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');chunks.push(Buffer.from(chunk));}
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)));
  validateRotationJobBudget(record,scope,environment,clock());return record;
 }catch{fail('ROTATION_ENTRY_CONTEXT_REQUIRED');}
}
async function readPublicRotationJobBudget(grant,environment=process.env){
 try{
  const response=await fetch(`https://api.github.com/repos/haji84/AI-/actions/runs/${environment.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.body)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.byteLength;if(n>65536)fail('ROTATION_ENTRY_CONTEXT_REQUIRED');chunks.push(Buffer.from(chunk));}
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));validateAllocatedRotationJob(record,grant,environment,Date.now());return record;
 }catch{fail('ROTATION_ENTRY_CONTEXT_REQUIRED');}
}
function projectExerciseController(value){
 if(!exact(value,['schemaVersion','issue','complete','exercise','fleetSqlitePreserved','fleet','pcSidecarsPreserved','wholeR06Verified','workerPrivateKeysVerified','sidecarAndCompassHistoryVerified'])||value.schemaVersion!==2||value.issue!==1218||value.wholeR06Verified!==false||value.workerPrivateKeysVerified!==false||value.sidecarAndCompassHistoryVerified!==false||typeof value.fleetSqlitePreserved!=='boolean'||typeof value.pcSidecarsPreserved!=='boolean')fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 validateRotationExerciseResult(value.exercise);
 let fleetChecks=null;
 if(value.fleet!==null){if(!object(value.fleet)||!['PASS','FAIL','INCONCLUSIVE'].includes(value.fleet.status)||fleetBooleans.some(k=>typeof value.fleet[k]!=='boolean'))fail('ROTATION_ENTRY_PROTOCOL_FAILED');fleetChecks=Object.fromEntries(['status',...fleetBooleans].map(k=>[k,value.fleet[k]]));}
 if(value.complete!==value.exercise.complete||value.fleetSqlitePreserved!==(fleetChecks?.status==='PASS')||fleetChecks?.status==='PASS'&&fleetBooleans.some(k=>!fleetChecks[k])||(value.complete||value.exercise.restoration.recoveryVerified||value.exercise.rotation.rollbackVerified)&&(!value.fleetSqlitePreserved||!value.pcSidecarsPreserved))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
 return {complete:value.complete,exercise:value.exercise,fleetChecks,fleetSqlitePreserved:value.fleetSqlitePreserved,pcSidecarsPreserved:value.pcSidecarsPreserved};
}
// Never truncate the unchanged controller's recovery window for startup delay,
// stderr or bad output. A live invocation must bind its unchanged receipt here.
export async function runBoundedRotationController(factory,{scope,durationMs=905000,clock=Date.now,exercise=false}={}){
 const started=clock();if(scope)durationMs=rotationControllerDuration(scope,started);
 if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>1440000)fail('ROTATION_ENTRY_SCOPE_REQUIRED');
 return await new Promise(done=>{
  let child,output='',bytes=0,problem=null,settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);done(value);};
  const timer=setTimeout(()=>{try{child?.kill();}catch{}finish(result('ROTATION_ENTRY_TIMEOUT'));},durationMs);
  try{
   child=factory();child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>65536){problem='ROTATION_ENTRY_PROTOCOL_FAILED';return;}if(!problem)output+=chunk;});
   child.stderr.on('data',()=>{problem='ROTATION_ENTRY_PROTOCOL_FAILED';});
   child.on('error',()=>{problem='ROTATION_ENTRY_CHILD_UNAVAILABLE';});
   child.on('close',exit=>{
    if(clock()-started>durationMs){finish(result('ROTATION_ENTRY_TIMEOUT'));return;}
    if(problem){finish({...result(problem),childCleanupVerified:true});return;}
    try{
     const wire=output.trim(),value=JSON.parse(wire);if(JSON.stringify(value)!==wire||exit!==(value.complete?0:1))fail('ROTATION_ENTRY_PROTOCOL_FAILED');
     finish({...(exercise?projectExerciseController(value):projectController(value)),childCleanupVerified:true});
    }catch{finish({...result('ROTATION_ENTRY_PROTOCOL_FAILED'),childCleanupVerified:true});}
   });
  }catch{finish(result('ROTATION_ENTRY_CHILD_UNAVAILABLE'));}
 });
}

function regular(path,limit=1048576){const metadata=lstatSync(path);if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>limit||realpathSync.native(path).toLowerCase()!==resolve(path).toLowerCase())fail('ROTATION_ENTRY_SOURCE_REJECTED');return readFileSync(path);}
function result(code){return {schemaVersion:1,issue:1218,operation:'authorized-rotation-acceptance',complete:false,failureCode:code,sourceRevision:null,originalDescriptorSha256:null,runtimeScopeSha256:null,childCleanupVerified:false,rotation:null,fleetChecks:null,wholeR06Verified:false};}
function publicResult(code){return {schemaVersion:2,issue:1218,operation:'rotation-restoration-exercise',complete:false,failureCode:code,sourceRevision:null,originalGrantSha256:null,workflowRunId:null,workflowRunAttempt:null,publicSourceVerified:false,localScopeBound:false,claimConsumed:false,actualWindowsOwnerContextVerified:false,childCleanupVerified:false,exercise:null,fleetChecks:null,fleetSqlitePreserved:false,pcSidecarsPreserved:false,wholeR06Verified:false};}
async function run(){
 let compiled;const answer=publicResult('ROTATION_ENTRY_SCOPE_REQUIRED');
 try{
  compiled=compilePublicRotationGrant(process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64??'');const {grant}=compiled;
  answer.sourceRevision=grant.sourceRevision;answer.originalGrantSha256=compiled.originalGrantSha256;answer.workflowRunId=process.env.GITHUB_RUN_ID;answer.workflowRunAttempt=1;
  if(process.platform!=='win32'||resolve(process.cwd()).toLowerCase()!==root.toLowerCase())fail('ROTATION_ENTRY_CONTEXT_REQUIRED');
  rotationControllerDuration(grant);await verifyPublicRotationSource(grant);answer.publicSourceVerified=true;
  const jobBudget=await readPublicRotationJobBudget(grant);
  const env=buildRotationEntryEnvironment(process.env,process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64,compiled.originalGrantSha256);env.GITHUB_WORKFLOW_REF=process.env.GITHUB_WORKFLOW_REF;
  const shell=win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const preparation=await runBoundedRotationPreparation(()=>spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-File',join(root,'scripts','owner-code-rotation-native-1218.ps1'),'-PreparePublic'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env}));
  if(!preparation.complete)fail(preparation.failureCode);
  const stage=win32.join(process.env.USERPROFILE,`.goriq-owner-rotation-1218-${grant.approvalId}`),receipt=win32.join(stage,'.gai-results','owner-code-rotation-scope.json'),scopeBytes=regular(receipt,65536),scope=bindRotationRunScope(JSON.parse(scopeBytes.toString('utf8')),process.env);
  const retainedGrant=regular(win32.join(stage,'.gai-results','original-grant.json'),65536);
  if(hash(retainedGrant)!==compiled.originalGrantSha256||scope.attemptId!==grant.approvalId||scope.issuedAt!==grant.issuedAt||scope.expiresAt!==grant.expiresAt||scope.sourceRevision!==grant.sourceRevision||hash(scope.ownerSid)!==grant.ownerSidSha256)fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_PUBLIC_SOURCE_FILES)if(hash(regular(win32.join(stage,file)))!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');
  for(const file of ROTATION_SOURCE_FILES)if(scope.sourceHashes[file]!==grant.sourceHashes[file])fail('ROTATION_ENTRY_SOURCE_REJECTED');
  const claim=JSON.parse(regular(stage+'.claim',4096).toString('utf8'));
  if(!exact(claim,['schemaVersion','attemptId','originalDescriptorSha256','runtimeScopeSha256','sourceRevision','workflowRunId','workflowRunAttempt'])||claim.schemaVersion!==1||claim.attemptId!==grant.approvalId||claim.originalDescriptorSha256!==compiled.originalGrantSha256||claim.runtimeScopeSha256!==hash(scopeBytes)||claim.sourceRevision!==scope.sourceRevision||claim.workflowRunId!==scope.workflowRunId||claim.workflowRunAttempt!==1)fail('ROTATION_ENTRY_ATTEMPT_CONSUMED');
  if(hash(regular(process.execPath,268435456))!==scope.nodeSha256)fail('ROTATION_ENTRY_NODE_REJECTED');
  answer.localScopeBound=true;answer.claimConsumed=true;answer.actualWindowsOwnerContextVerified=true;
  validateRotationJobBudget(jobBudget,scope);
  const controller=await runBoundedRotationController(()=>spawn(process.execPath,['--disable-warning=ExperimentalWarning',win32.join(stage,'scripts','owner-code-rotation-exercise.mjs'),'--apply','--authorization',receipt],{cwd:stage,windowsHide:false,stdio:['ignore','pipe','pipe'],env}),{scope,exercise:true});
  for(const key of ['complete','childCleanupVerified','exercise','fleetChecks','fleetSqlitePreserved','pcSidecarsPreserved'])if(Object.hasOwn(controller,key))answer[key]=controller[key];
  answer.failureCode=answer.complete?null:codes.includes(controller.failureCode)?controller.failureCode:'ROTATION_ENTRY_CONTROLLER_FAILED';return answer;
 }catch(error){answer.failureCode=codes.includes(error.message)?error.message:'ROTATION_ENTRY_SCOPE_REQUIRED';return answer;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===2)console.log('PLAN ONLY: live rotation requires fresh separate High approval and an exact real-run-bound protected receipt.');
 else if(process.argv.length===3&&process.argv[2]==='--verify-public-grant'){try{const {grant}=compilePublicRotationGrant(process.env.GORIQ_OWNER_ROTATION_SCOPE_BASE64??'');await verifyPublicRotationSource(grant);console.log('PUBLIC_ROTATION_GRANT_VERIFIED');}catch{console.log('PUBLIC_ROTATION_GRANT_REFUSED');process.exitCode=1;}}
 else{const value=process.argv.length===3&&process.argv[2]==='--run'?await run():result('ROTATION_ENTRY_CONTEXT_REQUIRED');console.log(JSON.stringify(value));if(!value.complete)process.exitCode=1;}
}
