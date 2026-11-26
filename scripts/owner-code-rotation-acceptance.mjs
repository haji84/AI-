// Owner-local controller. Default is inert; private snapshots stay in this process.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const ROTATION_SOURCE_FILES=Object.freeze(['owner-code-rotation-acceptance.mjs','owner-code-fleet-preservation.mjs','owner-code-pc-preservation.mjs','owner-code-rotation-worker.ps1','rotate-jarvis-owner-code-windows.ps1','read-jarvis-production-config.ps1','validate-jarvis-production-config.mjs','jarvis-production-config.mjs','jarvis-windows-install-paths.mjs'].map(name=>'scripts/'+name));
const flags=['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'];
const scopeFields=['scopeId','ownerSid','issuedAt','expiresAt','sourceRevision','sourceHashes','configSha256','taskSha256','nodeSha256','runtimeRevision','dbPath','attemptId','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars',...flags];
const bools=['complete','confirmationVerified','sessionInvalidationWarningVerified','configurationValidated','credentialGenerated','atomicReplacementVerified','protectedBackupVerified','newLoginVerified','rollbackAttempted','rollbackVerified','oldLoginVerified','cleanupFailed'];
const digest=/^[a-f0-9]{64}$/;
const revision=/^[a-f0-9]{40}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reject=code=>{throw new Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const localPath=value=>typeof value==='string'&&/^[A-Za-z]:\\[^:\r\n\0]*$/.test(value)&&!value.split('\\').some(part=>part==='..'||part==='.'||/[. ]$/.test(part));

export function validateRotationScope(scope,now=Date.now()){
 const optional=object(scope)&&Object.hasOwn(scope,'workflowRunId')?['workflowRunId','workflowRunAttempt']:[];
 if(!exact(scope,[...scopeFields,...optional]))reject('ROTATION_APPROVAL_REQUIRED');
 const issued=Date.parse(scope.issuedAt),expires=Date.parse(scope.expiresAt);
 if(scope.scopeId!=='issue:1218:owner-code-rotation'||!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(scope.ownerSid)||
  !Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires-issued>7200000||
  scope.maxAttempts!==1||scope.maxDurationSeconds!==900||scope.recoveryReserveSeconds!==120||expires-now<900000||
  !revision.test(scope.sourceRevision)||!revision.test(scope.runtimeRevision)||![scope.configSha256,scope.taskSha256,scope.nodeSha256].every(v=>typeof v==='string'&&digest.test(v))||
  !localPath(scope.dbPath)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(scope.attemptId)||flags.some(key=>scope[key]!==true)||
  !exact(scope.sourceHashes,ROTATION_SOURCE_FILES)||Object.values(scope.sourceHashes).some(v=>typeof v!=='string'||!digest.test(v)))reject('ROTATION_APPROVAL_REQUIRED');
 const pc=scope.pcSidecars;
 if(!exact(pc,['profile','expectedTaskFile','expectedObservationFile'])||pc.profile!=='jarvis-pc-sidecars-v1'||!['present','absent'].includes(pc.expectedTaskFile)||!['present','absent'].includes(pc.expectedObservationFile))reject('ROTATION_APPROVAL_REQUIRED');
 const cohort=scope.cohortAuthority;
 if(!object(cohort)||cohort.expectedCount!==38||!(cohort.kind==='approved-active-capture'&&exact(cohort,['kind','expectedCount'])||cohort.kind==='original-cohort-digest'&&exact(cohort,['kind','expectedCount','cohortSha256'])&&digest.test(cohort.cohortSha256)))reject('ROTATION_APPROVAL_REQUIRED');
 if(optional.length&&(!/^\d+$/.test(scope.workflowRunId)||scope.workflowRunAttempt!==1))reject('ROTATION_APPROVAL_REQUIRED');
 return scope;
}

export function validateRotationResult(result){
 const fields=['schemaVersion','issue',...bools,'failureCode','failedStage'];
 const stages=['approval','context','confirmation','configuration','before-rotation','candidate','replace','restart','new-login','before-commit','rollback','result','cleanup','protocol'];
 const codes=['ROTATION_SCOPE_REQUIRED','ROTATION_CONTEXT_UNAVAILABLE','ROTATION_REJECTED','ROTATION_FAILED_RECOVERED','ROTATION_RECOVERY_FAILED','ROTATION_CANCELLED','ROTATION_CLEANUP_FAILED','ROTATION_PROTOCOL_FAILED'];
 if(!exact(result,fields)||result.schemaVersion!==1||result.issue!==1218||bools.some(key=>typeof result[key]!=='boolean')||
  !(result.failedStage===null||stages.includes(result.failedStage))||!(result.failureCode===null||codes.includes(result.failureCode)))reject('ROTATION_RESULT_REJECTED');
 if(result.complete&&(!['confirmationVerified','sessionInvalidationWarningVerified','configurationValidated','credentialGenerated','atomicReplacementVerified','protectedBackupVerified','newLoginVerified'].every(key=>result[key])||result.rollbackAttempted||result.rollbackVerified||result.oldLoginVerified||result.cleanupFailed||result.failureCode!==null||result.failedStage!==null))reject('ROTATION_RESULT_REJECTED');
 if(!result.complete&&result.failureCode===null||result.rollbackVerified&&(!result.rollbackAttempted||!result.oldLoginVerified))reject('ROTATION_RESULT_REJECTED');
 if(result.failureCode==='ROTATION_FAILED_RECOVERED'&&!result.rollbackVerified)reject('ROTATION_RESULT_REJECTED');
 return result;
}

export class RotationFleetSession{
 #scope;#approvalHash;#baseline;#phase='initial';#comparison=null;
 constructor(scope,approvalSha256){this.#scope=scope;this.#approvalHash=approvalSha256;}
 accept(message){
  if(!exact(message,['event'])||!['before-rotation','before-commit','after-rollback'].includes(message.event))reject('ROTATION_PROTOCOL_REJECTED');
  const next={initial:['before-rotation'],baseline:['before-commit','after-rollback'],checked:['after-rollback'],restored:[]}[this.#phase];
  if(!next.includes(message.event))reject('ROTATION_PROTOCOL_REJECTED');
  const {captureFleetSnapshot,compareFleetSnapshots,fleetSnapshotSummary}=require('./owner-code-fleet-preservation.mjs');
  const scope=this.#scope;
  const options={schemaProfile:'jarvis-control-plane-sqlite-v1',databaseBinding:{path:scope.dbPath,configSha256:scope.configSha256,taskSha256:scope.taskSha256,releaseRevision:scope.runtimeRevision},cohortAuthority:{...scope.cohortAuthority,approvalSha256:this.#approvalHash},pcSidecars:scope.pcSidecars};
  let accepted=false;
  // A failed later observation must never inherit an earlier PASS.
  if(message.event!=='before-rotation')this.#comparison=null;
  try{
   const after=captureFleetSnapshot(scope.dbPath,options);
   if(message.event==='before-rotation'){
    const pc=fleetSnapshotSummary(after).pcSidecars;
    if(!pc||pc.taskFilePresent!==(scope.pcSidecars.expectedTaskFile==='present')||pc.observationFilePresent!==(scope.pcSidecars.expectedObservationFile==='present'))reject('ROTATION_BASELINE_REJECTED');
    this.#baseline=after;this.#phase='baseline';accepted=true;
   }
   else{this.#comparison=compareFleetSnapshots(this.#baseline,after);this.#phase=message.event==='after-rollback'?'restored':'checked';accepted=this.#comparison.status==='PASS';}
  }catch{this.#phase=message.event==='before-rotation'?'restored':message.event==='after-rollback'?'restored':'checked';}
  return {event:message.event,accepted};
 }
 finish(result){
  validateRotationResult(result);
  if(result.complete&&(this.#phase!=='checked'||this.#comparison?.status!=='PASS'))reject('ROTATION_RESULT_REJECTED');
  if(result.rollbackVerified&&(this.#phase!=='restored'||this.#comparison?.status!=='PASS'))reject('ROTATION_RESULT_REJECTED');
  return {schemaVersion:1,issue:1218,complete:result.complete,rotation:result,fleetSqlitePreserved:this.#comparison?.status==='PASS',fleet:this.#comparison,pcSidecarsPreserved:this.#comparison?.pcSidecars?.status==='PASS',wholeR06Verified:false,workerPrivateKeysVerified:false,sidecarAndCompassHistoryVerified:false};
 }
}

// Hash only bounded, regular source files. Windows path/DACL checks also run in
// the worker, before it asks this parent to open the explicitly bound SQLite DB.
function verifySources(scope){
 for(const relative of ROTATION_SOURCE_FILES){
  const path=resolve(root,relative),metadata=lstatSync(path);
  if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>1048576||realpathSync(path)!==path||hash(readFileSync(path))!==scope.sourceHashes[relative])reject('ROTATION_SOURCE_REJECTED');
 }
 if(hash(readFileSync(process.execPath))!==scope.nodeSha256)reject('ROTATION_SOURCE_REJECTED');
}

export async function runRotationAcceptance(authorizationPath){
 if(process.platform!=='win32'||process.env.GITHUB_ACTOR!=='haji84'||process.env.GITHUB_REPOSITORY!=='haji84/AI-'||process.env.GITHUB_REF!=='refs/heads/main')reject('ROTATION_CONTEXT_REQUIRED');
 const metadata=lstatSync(authorizationPath);
 if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>65536)reject('ROTATION_APPROVAL_REQUIRED');
 const bytes=readFileSync(authorizationPath),scope=validateRotationScope(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
 if(scope.sourceRevision!==process.env.GITHUB_SHA||process.env.GITHUB_RUN_ID&&(scope.workflowRunId!==process.env.GITHUB_RUN_ID||scope.workflowRunAttempt!==Number(process.env.GITHUB_RUN_ATTEMPT)))reject('ROTATION_CONTEXT_REQUIRED');
 verifySources(scope);
 const shell=win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const session=new RotationFleetSession(scope,hash(bytes));
 const child=spawn(shell,['-NoLogo','-NoProfile','-STA','-NonInteractive','-File',join(root,'scripts','owner-code-rotation-worker.ps1'),'-Apply','-AuthorizationPath',resolve(authorizationPath)],{windowsHide:false,stdio:['pipe','pipe','pipe']});
 const hardEnd=Math.min(Date.now()+scope.maxDurationSeconds*1000,Date.parse(scope.expiresAt));
 return await new Promise((fulfil,rejectPromise)=>{
  let pending='',protocolFailed=false,final=null,stderrObserved=false;
  const timer=setTimeout(()=>{protocolFailed=true;child.kill();},Math.max(1,hardEnd-Date.now()));
  const abort=()=>{protocolFailed=true;child.stdin.end();};
  child.stderr.on('data',()=>{stderrObserved=true;});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   if(protocolFailed)return;
   pending+=chunk;
   if(pending.length>16384){abort();return;}
   let end;
   while((end=pending.indexOf('\n'))!==-1){
    const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);
    try{
     if(final||line.length>8192)reject('ROTATION_PROTOCOL_REJECTED');
     if(Date.now()>=hardEnd||hash(readFileSync(authorizationPath))!==hash(bytes))reject('ROTATION_APPROVAL_REQUIRED');
     verifySources(scope);
     const message=JSON.parse(line);
     if(exact(message,['event','result'])&&message.event==='result'){final=session.finish(message.result);}
     else child.stdin.write(JSON.stringify(session.accept(message))+'\n');
    }catch{abort();return;}
   }
  });
  child.stdin.on('error',()=>{protocolFailed=true;});
  child.on('error',()=>{clearTimeout(timer);rejectPromise(new Error('ROTATION_WORKER_UNAVAILABLE'));});
  child.on('close',code=>{
   clearTimeout(timer);
   if(protocolFailed||stderrObserved||pending.trim()||!final||code!==(final.complete?0:1))rejectPromise(new Error('ROTATION_ACCEPTANCE_INCONCLUSIVE'));
   else fulfil(final);
  });
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===2)console.log('PLAN ONLY: separate exact-source rotation approval is required; no credential, task or database is accessed.');
 else{
  try{
   if(process.argv.length!==5||process.argv[2]!=='--apply'||process.argv[3]!=='--authorization')reject('ROTATION_APPROVAL_REQUIRED');
   const result=await runRotationAcceptance(process.argv[4]);console.log(JSON.stringify(result));if(!result.complete)process.exitCode=1;
  }catch{console.log(JSON.stringify({schemaVersion:1,issue:1218,complete:false,failureCode:'ROTATION_ACCEPTANCE_INCONCLUSIVE',wholeR06Verified:false}));process.exitCode=1;}
 }
}
