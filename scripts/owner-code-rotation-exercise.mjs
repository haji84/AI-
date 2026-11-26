// Operation-specific owner-local acceptance. The nine legacy dependencies stay immutable.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {dirname,resolve,join,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROTATION_SOURCE_FILES,validateRotationScope,validateRotationResult} from './owner-code-rotation-acceptance.mjs';
export {validateRotationResult};
const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),exact=(v,k)=>object(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const reject=code=>{throw new Error(code);},hash=v=>createHash('sha256').update(v).digest('hex');
export {RotationExerciseFleetSession as RotationFleetSession};
export function validateRotationExerciseResult(value){
 const keys=['attempted','complete','atomicRestorationVerified','oldLoginVerified','runtimeVerified','preservationVerified','finalOriginalConfigurationVerified','encryptedCandidateRetained','recoveryAttempted','recoveryVerified'];
 if(!exact(value,['schemaVersion','issue','operation','complete','failureCode','failedStage','rotation','restoration'])||value.schemaVersion!==2||value.issue!==1218||value.operation!=='rotation-restoration-exercise'||typeof value.complete!=='boolean'||!exact(value.restoration,[...keys,'failureCode'])||keys.some(k=>typeof value.restoration[k]!=='boolean')||![null,'ROTATION_EXERCISE_INCOMPLETE','ROTATION_REJECTED','ROTATION_CONTEXT_UNAVAILABLE'].includes(value.failureCode)||![null,'rotation','planned-restoration','result','context'].includes(value.failedStage)||![null,'ROTATION_PLANNED_RESTORE_FAILED'].includes(value.restoration.failureCode))reject('ROTATION_RESULT_REJECTED');
 validateRotationResult(value.rotation);const r=value.restoration;
 if(value.complete&&(!value.rotation.complete||!keys.filter(k=>!['recoveryAttempted','recoveryVerified'].includes(k)).every(k=>r[k])||r.recoveryAttempted||r.recoveryVerified||r.failureCode!==null||value.failureCode!==null||value.failedStage!==null))reject('ROTATION_RESULT_REJECTED');
 if(!value.complete&&(value.failureCode===null||value.failedStage===null)||r.complete&&(!value.complete||!value.rotation.complete)||!value.rotation.complete&&(r.attempted||r.recoveryAttempted||r.complete)||r.recoveryVerified&&(!r.recoveryAttempted||!r.oldLoginVerified||!r.runtimeVerified||!r.preservationVerified||!r.finalOriginalConfigurationVerified||!r.encryptedCandidateRetained||value.complete))reject('ROTATION_RESULT_REJECTED');
 return value;
}
export class RotationExerciseFleetSession{
 #scope;#approvalHash;#baseline;#phase='initial';#comparison=null;
 constructor(scope,approvalSha256){this.#scope=scope;this.#approvalHash=approvalSha256;}
 accept(message){
  if(!exact(message,['event'])||!['before-rotation','before-commit','after-rollback','before-planned-restore','after-planned-restore'].includes(message.event))reject('ROTATION_PROTOCOL_REJECTED');
  const next={initial:['before-rotation'],baseline:['before-commit','after-rollback'],checked:['after-rollback','before-planned-restore','after-planned-restore'],planned:['after-planned-restore'],restored:[],'planned-restored':[]}[this.#phase];
  if(!next.includes(message.event)||message.event==='before-planned-restore'&&this.#comparison?.status!=='PASS')reject('ROTATION_PROTOCOL_REJECTED');
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
   else{this.#comparison=compareFleetSnapshots(this.#baseline,after);this.#phase=message.event==='after-rollback'?'restored':message.event==='after-planned-restore'?'planned-restored':message.event==='before-planned-restore'?'planned':'checked';accepted=this.#comparison.status==='PASS';}
  }catch{this.#phase=message.event==='before-rotation'?'restored':message.event==='after-rollback'?'restored':message.event==='after-planned-restore'?'planned-restored':message.event==='before-planned-restore'?'planned':'checked';}
  return {event:message.event,accepted};
 }
 finishExercise(value){
  validateRotationExerciseResult(value);
  if(value.rotation.rollbackVerified&&(this.#phase!=='restored'||this.#comparison?.status!=='PASS'))reject('ROTATION_RESULT_REJECTED');
  if((value.complete||value.restoration.recoveryVerified||value.restoration.finalOriginalConfigurationVerified)&&(this.#phase!=='planned-restored'||this.#comparison?.status!=='PASS'))reject('ROTATION_RESULT_REJECTED');
  return {schemaVersion:2,issue:1218,complete:value.complete,exercise:value,fleetSqlitePreserved:this.#comparison?.status==='PASS',fleet:this.#comparison,pcSidecarsPreserved:this.#comparison?.pcSidecars?.status==='PASS',wholeR06Verified:false,workerPrivateKeysVerified:false,sidecarAndCompassHistoryVerified:false};
 }

}

function readBounded(path,limit=1048576){const meta=lstatSync(path);if(!meta.isFile()||meta.isSymbolicLink()||meta.nlink!==1||meta.size>limit||realpathSync.native(path).toLowerCase()!==resolve(path).toLowerCase())reject('ROTATION_EXERCISE_REFUSED');return readFileSync(path);}
export async function runRotationRestorationAcceptance(authorizationPath){
 if(process.platform!=='win32'||process.env.GITHUB_ACTOR!=='haji84'||process.env.GITHUB_REPOSITORY!=='haji84/AI-'||process.env.GITHUB_REF!=='refs/heads/main')reject('ROTATION_EXERCISE_REFUSED');
 const bytes=readBounded(authorizationPath,65536),scope=validateRotationScope(JSON.parse(bytes.toString('utf8')));
 const {compilePublicRotationGrant,ROTATION_PUBLIC_SOURCE_FILES}=await import('./owner-code-rotation-native-1218.mjs');
 const grantBytes=readBounded(join(dirname(authorizationPath),'original-grant.json'),65536),{grant,originalGrantSha256}=compilePublicRotationGrant(grantBytes.toString('base64'));
 const claimPath=dirname(dirname(authorizationPath))+'.claim',claimBytes=readBounded(claimPath,4096),claim=JSON.parse(claimBytes.toString('utf8'));
 if(!exact(claim,['schemaVersion','attemptId','originalDescriptorSha256','runtimeScopeSha256','sourceRevision','workflowRunId','workflowRunAttempt'])||claim.schemaVersion!==1||claim.attemptId!==scope.attemptId||claim.originalDescriptorSha256!==originalGrantSha256||claim.runtimeScopeSha256!==hash(bytes)||claim.sourceRevision!==scope.sourceRevision||claim.workflowRunId!==scope.workflowRunId||scope.workflowRunId!==process.env.GITHUB_RUN_ID||claim.workflowRunAttempt!==1||scope.workflowRunAttempt!==1||process.env.GITHUB_RUN_ATTEMPT!=='1'||grant.approvalId!==scope.attemptId||grant.sourceRevision!==scope.sourceRevision||grant.issuedAt!==scope.issuedAt||grant.expiresAt!==scope.expiresAt||hash(scope.ownerSid)!==grant.ownerSidSha256)reject('ROTATION_EXERCISE_REFUSED');
 for(const flag of ['credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval'])if(scope[flag]!==grant[flag])reject('ROTATION_EXERCISE_REFUSED');
 const verify=()=>{
  if(hash(readBounded(authorizationPath,65536))!==hash(bytes)||hash(readBounded(claimPath,4096))!==hash(claimBytes)||hash(readBounded(join(dirname(authorizationPath),'original-grant.json'),65536))!==originalGrantSha256||hash(readBounded(process.execPath,268435456))!==scope.nodeSha256)reject('ROTATION_EXERCISE_REFUSED');
  for(const file of ROTATION_PUBLIC_SOURCE_FILES)if(hash(readBounded(join(root,file)))!==grant.sourceHashes[file]||ROTATION_SOURCE_FILES.includes(file)&&scope.sourceHashes[file]!==grant.sourceHashes[file])reject('ROTATION_EXERCISE_REFUSED');
 };
 verify();const session=new RotationExerciseFleetSession(scope,hash(bytes)),hardEnd=Math.min(Date.now()+900000,Date.parse(scope.expiresAt));
 const shell=win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const child=spawn(shell,['-NoLogo','-NoProfile','-STA','-NonInteractive','-File',join(root,'scripts','owner-code-rotation-exercise.ps1'),'-Apply','-AuthorizationPath',resolve(authorizationPath)],{windowsHide:false,stdio:['pipe','pipe','pipe'],env:{...process.env,GORIQ_OWNER_EXERCISE_HARD_END:new Date(hardEnd).toISOString()}});
 return await new Promise((fulfil,rejectPromise)=>{
  let pending='',failed=false,final=null,stderr=false;
  const timer=setTimeout(()=>{failed=true;child.kill();},Math.max(1,hardEnd-Date.now()));
  child.stderr.on('data',()=>{stderr=true;});child.stdout.setEncoding('utf8');
  const abort=()=>{failed=true;child.stdin.end();};
  child.stdout.on('data',chunk=>{
   if(failed)return;pending+=chunk;if(pending.length>16384){abort();return;}let end;
   while((end=pending.indexOf('\n'))!==-1){const line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);try{
    if(final||line.length>8192||Date.now()>=hardEnd)reject('ROTATION_EXERCISE_REFUSED');verify();const message=JSON.parse(line);
    if(exact(message,['event','result'])&&message.event==='result')final=session.finishExercise(message.result);
    else child.stdin.write(JSON.stringify(session.accept(message))+'\n');
   }catch{abort();return;}}
  });
  child.stdin.on('error',()=>{failed=true;});child.on('error',()=>{clearTimeout(timer);rejectPromise(new Error('ROTATION_EXERCISE_REFUSED'));});
  child.on('close',code=>{clearTimeout(timer);if(failed||stderr||pending.trim()||!final||code!==(final.complete?0:1))rejectPromise(new Error('ROTATION_EXERCISE_REFUSED'));else fulfil(final);});
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===2)console.log('PLAN ONLY: public OriginalGrant and protected local scope are required; no Owner state is accessed.');
 else try{if(process.argv.length!==5||process.argv[2]!=='--apply'||process.argv[3]!=='--authorization')reject('ROTATION_EXERCISE_REFUSED');const result=await runRotationRestorationAcceptance(process.argv[4]);console.log(JSON.stringify(result));if(!result.complete)process.exitCode=1;}catch{console.log(JSON.stringify({schemaVersion:2,issue:1218,complete:false,failureCode:'ROTATION_EXERCISE_REFUSED'}));process.exitCode=1;}
}
