// Fixed approved maintenance entry; no arbitrary command, path or Goal input.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODE_APPROVAL, MODE_APPROVAL_ID, MODE_WORKFLOW, validateModeRepairEvidence, createSpecificModeGate } from './goriq-g1-compass-mode-authorization.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const MODE_SOURCE_FILES=Object.freeze([
 MODE_WORKFLOW,'scripts/goriq-g1-compass-mode-authorization.mjs','scripts/goriq-g1-compass-mode-entry.mjs',
 'scripts/goriq-g1-compass-mode-repair.mjs','scripts/goriq-g1-compass-mode-native.mjs',
 'scripts/goriq-g1-compass-mode-native.py','scripts/goriq-g1-compass-mode-metadata.c',
 'tests/goriq-g1-compass-mode-darwin.test.py',
 'scripts/goriq-g1-backup-inventory.mjs','.github/workflows/ci.yml',
 'scripts/jarvis-verifier-live-ci.mjs','scripts/jarvis-independent-check-runner.mjs',
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=reason=>{throw Error('MODE_ENTRY_'+reason);};
const CLOSED_REASONS=new Set(['MODES_NARROWED','MODES_RESTORED','HUMAN_APPROVAL_REQUIRED','INVALID_SCOPE','INVALID_INPUT',
 'PRECONDITION_FAILED','HANDLE_UNCONFIRMED','IDENTITY_AMBIGUOUS','JOURNAL_UNCONFIRMED','FACTS_CHANGED',
 'PERMIT_EXPIRED','PERMIT_REJECTED','PERMIT_REPLAY','PLAN_UNAVAILABLE','PLAN_HANDLE_UNCONFIRMED','PLAN_ALREADY_ATTEMPTED',
 'OPS_UNAVAILABLE','CLOCK_UNAVAILABLE','APPLY_UNAVAILABLE','MODE_OUTCOME_UNCONFIRMED','ROLLBACK_BLOCKED',
 'ROLLBACK_ALREADY_ATTEMPTED','RECOVERY_HANDLE_UNCONFIRMED','ROLLBACK_NOT_ADMITTED','MODE_ENTRY_UNAVAILABLE']);
const boundedCount=value=>Number.isInteger(value)&&value>=0&&value<=2?value:0;
export function publicModeResult(result) {
 return Object.freeze({status:['PLANNED','APPLIED','ROLLED_BACK','RECOVERY_REQUIRED','HOLD'].includes(result?.status)?result.status:'HOLD',
  reason:CLOSED_REASONS.has(result?.reason)?result.reason:'MODE_ENTRY_UNAVAILABLE',
  targetCount:boundedCount(result?.targetCount),changedCount:boundedCount(result?.changedCount),restoredCount:boundedCount(result?.restoredCount),
  recoveryRequired:result?.status==='RECOVERY_REQUIRED',permissionChange:true,risk:'HIGH',
  productionAcceptance:false,originalGoalRecovered:false});
}
function inside(home,path) {
 if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path||path.includes('\0')||path.length>2048)return false;
 const delta=relative(home,path);return delta!==''&&!isAbsolute(delta)&&delta!=='..'&&!delta.startsWith('..'+sep);
}
export function selectRepairCandidates({home,ownerConfig}) {
 if(typeof home!=='string'||!isAbsolute(home)||normalize(home)!==home||home==='/'||!inside(home,ownerConfig?.JARVIS_DB_PATH))fail('TARGETS_UNCONFIRMED');
 const configured=ownerConfig.JARVIS_COMPASS_DB_PATH??ownerConfig.JARVIS_DB_PATH+'.compass.sqlite';
 if(!inside(home,configured))fail('TARGETS_UNCONFIRMED');
 return Object.freeze([
  Object.freeze({label:'owner-config-file',path:configured}),
  Object.freeze({label:'mac-canonical-repo-default',path:join(home,'JARVIS-AI-','.jarvis','compass.db')}),
 ]);
}
export function createModeSourceLease({revision,verifyLocal,readMain,now=Date.now}) {
 let checkedAt=null;
 function clock() {const value=now();if(!Number.isSafeInteger(value)||value<0)fail('CLOCK_REJECTED');return value;}
 return Object.freeze({
  async verify() {
   try {
    verifyLocal();const current=clock();
    if(checkedAt!==null&&current<checkedAt)fail('CLOCK_REJECTED');
    if(checkedAt===null||current-checkedAt>=5000) {
     checkedAt=null;
     const main=await readMain();
     if(main.object?.type!=='commit'||main.object.sha!==revision)fail('SOURCE_CHANGED');
     checkedAt=clock();
    }
   }catch(error){checkedAt=null;throw error;}
  },
  assertFresh() {
   const current=clock();
   if(checkedAt===null||current<checkedAt||current-checkedAt>45000)fail('SOURCE_LEASE_EXPIRED');
  },
 });
}
function git(args) {
 try{return execFileSync('git',args,{cwd:ROOT,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});}
 catch{fail('LOCAL_SOURCE_REJECTED');}
}
function sourceSnapshot(revision,expected) {
 if(git(['rev-parse','HEAD']).trim()!==revision||realpathSync(ROOT)!==realpathSync(git(['rev-parse','--show-toplevel']).trim()))fail('LOCAL_SOURCE_REJECTED');
 const hashes={};
 for(const file of MODE_SOURCE_FILES) {
  const path=join(ROOT,file),info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<1||info.size>2*1024*1024||realpathSync(path)!==path)fail('LOCAL_SOURCE_REJECTED');
  const bytes=readFileSync(path),committed=git(['show',revision+':'+file]);
  if(!bytes.equals(Buffer.from(committed,'utf8')))fail('LOCAL_SOURCE_REJECTED');
  hashes[file]=hash(bytes);
 }
 if(expected&&JSON.stringify(hashes)!==JSON.stringify(expected))fail('LOCAL_SOURCE_CHANGED');
 return Object.freeze(hashes);
}
async function github(path) {
 // No authorization header/new credential or additional token scope. Fixed API
 // origin, bounded body, redirects refused; API failures never become PASS.
 const response=await fetch('https://api.github.com/repos/haji84/AI-/'+path,{headers:{Accept:'application/vnd.github+json'},
  redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok||!response.body)fail('PUBLIC_EVIDENCE_UNAVAILABLE');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try {
  for(;;){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>2*1024*1024)fail('EVIDENCE_BOUND');chunks.push(item.value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function context(env) {
 return {actions:env.GITHUB_ACTIONS,repository:env.GITHUB_REPOSITORY,actor:env.GITHUB_ACTOR,triggeringActor:env.GITHUB_TRIGGERING_ACTOR,
  eventName:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,revision:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,
  workflowRef:env.GITHUB_WORKFLOW_REF,runnerName:env.RUNNER_NAME,runnerOS:env.RUNNER_OS,runnerEnvironment:env.RUNNER_ENVIRONMENT,platform:process.platform};
}
function readEvent(env) {
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==MODE_APPROVAL.repository||env.GITHUB_EVENT_NAME!=='workflow_run'||
  !isAbsolute(env.GITHUB_EVENT_PATH??'')||!/^\d+$/.test(env.GITHUB_RUN_ID??''))fail('CONTEXT_REJECTED');
 const info=lstatSync(env.GITHUB_EVENT_PATH);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('EVENT_REJECTED');
 const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
 if(!Number.isSafeInteger(event?.workflow_run?.id)||event.workflow_run.id<=0)fail('EVENT_REJECTED');
 return event;
}
async function admission(stage,env) {
 const event=readEvent(env),c=context(env);
 const [main,ci,ciJobs,pr,run,runJobs]=await Promise.all([
  github('git/ref/heads/main'),github('actions/runs/'+event.workflow_run.id),
  github('actions/runs/'+event.workflow_run.id+'/jobs?per_page=100'),github('pulls/1918'),
  github('actions/runs/'+c.runId),github('actions/runs/'+c.runId+'/jobs?per_page=100'),
 ]);
 const evidence=validateModeRepairEvidence({context:c,event,main,ci,ciJobs,pr,run,runJobs,stage,now:Date.now()});
 const sourceHashes=sourceSnapshot(c.revision);
 return {evidence,sourceHashes};
}
function emit(value) {process.stdout.write('GORIQ_G1_MODE_REPAIR='+JSON.stringify(value)+'\n');}

async function run(stage,env) {
 const {evidence,sourceHashes}=await admission(stage,env);
 if(stage==='hosted') {
  if(!isAbsolute(env.GITHUB_OUTPUT??''))fail('OUTPUT_UNAVAILABLE');
  appendFileSync(env.GITHUB_OUTPUT,'authorized=true\nrevision='+evidence.sourceRevision+'\n');
  emit({status:'SOURCE_ADMITTED',sourceRevision:evidence.sourceRevision,ciRunId:evidence.ciRunId,
   productionAcceptance:false,originalGoalRecovered:false});return;
 }
 const owner=userInfo();
 if(owner.uid<=0||owner.uid!==process.getuid()||owner.uid!==process.geteuid()||!isAbsolute(owner.homedir)||realpathSync(owner.homedir)!==owner.homedir)fail('OWNER_UNCONFIRMED');
 const {ownerFileConfiguredPaths,inspectCandidate}=await import('./goriq-g1-backup-inventory.mjs');
 const targets=selectRepairCandidates({home:owner.homedir,ownerConfig:ownerFileConfiguredPaths(owner.homedir)});
 const scope=Object.freeze({sourceRevision:evidence.sourceRevision,
  artifactDigest:hash(JSON.stringify({sourceHashes,ciRunId:evidence.ciRunId,ciRunAttempt:evidence.ciRunAttempt})),
  hostId:hash(JSON.stringify({runnerId:22,runnerName:'MacBook',home:owner.homedir,uid:owner.uid})),ownerUid:owner.uid,
  expiresAt:Math.min(Date.now()+MODE_APPROVAL.maxPlanLifetimeMs,Date.parse(MODE_APPROVAL.eligibleUntil))});
 let native,gate,lastNativeReason=null;
 // Observe currentmain again at actual native admission; the earlier parallel
 // API bundle is never dated as if it had just been fetched. Do not refetch
 // six immutable CI/PR/job bundles at every gate or conceal a failed read.
 const lease=createModeSourceLease({revision:scope.sourceRevision,
  verifyLocal:()=>sourceSnapshot(scope.sourceRevision,sourceHashes),readMain:()=>github('git/ref/heads/main')});
 const verifySource=lease.verify;
 const authorityCheck=()=>{
  lease.assertFresh();if(Date.now()>=scope.expiresAt)fail('PERMIT_EXPIRED');
  gate?.assertAuthority();
 };
 try {
  await verifySource();
  const {createCompassModeNative}=await import('./goriq-g1-compass-mode-native.mjs');
  native=await createCompassModeNative({scope,candidates:targets,approvalId:MODE_APPROVAL_ID,
   sessionId:'run-'+evidence.workflowRunId+'-1',authorityCheck});
  await verifySource();
  gate=createSpecificModeGate({evidence,scope,verifySource,claim:binding=>native.claim(binding)});
  const {createCompassModeRepair}=await import('./goriq-g1-compass-mode-repair.mjs');
  const guardedOps=Object.fromEntries(Object.entries(native.ops).map(([name,fn])=>[name,async(...args)=>{
   try{return await fn(...args);}catch(error){
    // Fixed native reason vocabulary only; raw stderr/path/errors stay private.
    const allowed=['NATIVE_PRECONDITION_REFUSED','NATIVE_PATH_REFUSED','NATIVE_METADATA_REFUSED','NATIVE_PARENT_REFUSED',
     'NATIVE_FACTS_CHANGED','NATIVE_REPLAY_REFUSED','NATIVE_PERMIT_EXPIRED','NATIVE_CLAIM_REFUSED','NATIVE_MODE_OUTCOME_UNCONFIRMED',
     'NATIVE_JOURNAL_REFUSED','NATIVE_START_REFUSED','NATIVE_PROCESS_EXITED','NATIVE_REQUEST_TIMEOUT'];
    lastNativeReason=allowed.includes(error?.message)?error.message:'NATIVE_OPERATION_UNAVAILABLE';throw error;
   }
  }]));
  const repair=createCompassModeRepair({ops:guardedOps,gate:gate.gate});
  const plan=await repair.plan(scope);
  let result=plan;
  if(plan.status==='PLANNED')result=await repair.apply(plan.handle,gate.permit);
  emit({...publicModeResult(result),...(lastNativeReason?{nativeRefusal:lastNativeReason}:{})});
  if(result.status!=='APPLIED'){process.exitCode=2;return;}
  const rows=[];
  for(const target of targets) {
   const row=await inspectCandidate({label:target.label,brokerPath:join(dirname(target.path),'jarvis.db'),compassPath:target.path,
    home:owner.homedir,budgetUntil:Date.now()+30000,scanManaged:false,standalone:true});
   rows.push(row);
  }
  // The existing inspector emits counts/status only and never authenticates
  // a complete original contract. Permission success does not change that.
  process.stdout.write('GORIQ_G1_REPAIRED_READBACK='+JSON.stringify({status:'OBSERVATION_ONLY',readOnly:true,
   productionGoalRecovered:false,checkedCandidates:rows.length,candidates:rows})+'\n');
 } finally {if(native)await native.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const arg=process.argv.slice(2);
 if(arg.length!==1||!['authorize','apply'].includes(arg[0])) {
  emit({status:'PLAN_ONLY',permissionChange:false,productionAcceptance:false,originalGoalRecovered:false});
 }else {
  run(arg[0]==='authorize'?'hosted':'mac',process.env).catch(()=>{
   emit({...publicModeResult({status:'HOLD',reason:'MODE_ENTRY_UNAVAILABLE'}),stage:arg[0]});process.exitCode=2;
  });
 }
}
