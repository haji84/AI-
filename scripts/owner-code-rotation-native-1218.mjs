// Inert transport to the existing High-gated rotation controller. A mode is not approval.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
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
