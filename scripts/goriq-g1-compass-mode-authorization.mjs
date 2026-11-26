// A fixed recovery-maintenance port for the owner's specific chat approval.
// It is not a recovered Goal contract, signature issuer or general permission API.
import { createHash } from 'node:crypto';

export const MODE_APPROVAL=Object.freeze({
 version:1,kind:'OWNER_CHAT_SPECIFIC_RECOVERY_MAINTENANCE',issue:1219,pr:1918,
 goalId:'goal-fcc81c97e09153f7',jobId:'rotation-recovery-37',
 labels:Object.freeze(['owner-config-file','mac-canonical-repo-default']),
 operation:'compass-mode-narrowing',owner:'haji84',repository:'haji84/AI-',repositoryId:1338437857,
 recordedAt:'2026-11-15T14:40:55.000Z',eligibleUntil:'2026-11-15T20:40:55.000Z',
 provenance:'Specific owner chat approval relayed by the authorized task operator; not a GitHub-owner signature or original Goal permit.',
 reference:'https://github.com/haji84/AI-/issues/1219#issuecomment-6890852588',
 runnerId:22,runnerName:'MacBook',maxConsumptions:1,maxPlanLifetimeMs:1800000,
});
export const MODE_APPROVAL_ID=createHash('sha256').update(JSON.stringify(MODE_APPROVAL)).digest('hex');
export const MODE_WORKFLOW='.github/workflows/goriq-g1-compass-mode-repair.yml';
export const MODE_WORKFLOW_NAME='GORIQ Approved Two-Leaf Compass Repair';
const checks=['repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures'];
const verified=new WeakSet(),opaque=()=>Object.freeze(Object.create(null));
const fail=reason=>{throw Error('MODE_ENTRY_'+reason);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>Number.isSafeInteger(value)&&value>0;
const isOpaque=value=>value&&typeof value==='object'&&Object.getPrototypeOf(value)===null&&Object.isFrozen(value)&&Reflect.ownKeys(value).length===0;
const repo=value=>value?.full_name===MODE_APPROVAL.repository&&value?.id===MODE_APPROVAL.repositoryId;
const owner=value=>value?.login===MODE_APPROVAL.owner;
function time(now) {
 if(!Number.isSafeInteger(now)||now<Date.parse(MODE_APPROVAL.recordedAt)||now>=Date.parse(MODE_APPROVAL.eligibleUntil))fail('APPROVAL_EXPIRED');
}
function completeJobs(value) {
 if(!value||!Array.isArray(value.jobs)||value.total_count!==value.jobs.length||value.jobs.length>100)fail('JOBS_UNCONFIRMED');
 return value.jobs;
}
function trustedRun(run,revision) {
 return id(run?.id)&&repo(run.repository)&&repo(run.head_repository)&&owner(run.actor)&&owner(run.triggering_actor)&&
  run.head_branch==='main'&&run.head_sha===revision;
}

// Call only on bounded JSON obtained from the fixed public GitHub API by the
// trusted entry. A report copied/serialized out of this module is not authority.
export function validateModeRepairEvidence({context:c,event,main,ci,ciJobs,pr,run,runJobs,stage,now}) {
 time(now);
 if(!['hosted','mac'].includes(stage)||!c||c.actions!=='true'||c.repository!==MODE_APPROVAL.repository||c.actor!==MODE_APPROVAL.owner||
  c.triggeringActor!==MODE_APPROVAL.owner||c.eventName!=='workflow_run'||c.ref!=='refs/heads/main'||!sha(c.revision)||
  !/^[1-9][0-9]{0,19}$/.test(c.runId??'')||c.runAttempt!=='1'||
  c.workflowRef!==MODE_APPROVAL.repository+'/'+MODE_WORKFLOW+'@refs/heads/main')fail('CONTEXT_REJECTED');
 if(!repo(event?.repository)||main?.object?.type!=='commit'||main.object.sha!==c.revision)fail('SOURCE_CHANGED');
 const trigger=event?.workflow_run;
 if(!trustedRun(ci,c.revision)||ci.name!=='CI'||ci.workflow_id!==337018160||ci.path!=='.github/workflows/ci.yml'||
  ci.event!=='push'||ci.status!=='completed'||ci.conclusion!=='success'||!id(ci.run_attempt)||
  !trigger||trigger.id!==ci.id||trigger.run_attempt!==ci.run_attempt||trigger.head_sha!==ci.head_sha||
  trigger.name!=='CI'||trigger.event!=='push'||trigger.head_branch!=='main'||trigger.conclusion!=='success')fail('CI_REJECTED');
 const jobs=completeJobs(ciJobs);
 if(jobs.length!==checks.length||checks.some(name=>jobs.filter(job=>job.name===name).length!==1)||
  jobs.some(job=>!id(job.id)||job.run_id!==ci.id||job.run_attempt!==ci.run_attempt||job.head_sha!==c.revision||
   job.status!=='completed'||job.conclusion!=='success'))fail('CI_JOBS_REJECTED');
 const verifier=jobs.find(job=>job.name==='independent-verifier-container');
 for(const name of ['Real restricted-container six-check verification','Retain hosted-container evidence']) {
  const steps=verifier.steps?.filter(step=>step.name===name);
  if(steps?.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')fail('CI_AUDIT_REJECTED');
 }
 if(pr?.number!==1918||pr.state!=='closed'||pr.merged!==true||pr.draft!==false||pr.merge_commit_sha!==c.revision||
  !owner(pr.user)||!owner(pr.merged_by)||pr.base?.ref!=='main'||!repo(pr.base?.repo)||!repo(pr.head?.repo)||
  pr.head.ref!=='work/1219-g1-permission-proposal-20261115'||!sha(pr.head.sha))fail('MERGE_REJECTED');
 if(!trustedRun(run,c.revision)||String(run.id)!==c.runId||run.run_attempt!==1||run.event!=='workflow_run'||
  run.name!==MODE_WORKFLOW_NAME||run.path!==MODE_WORKFLOW||run.status!=='in_progress'||run.conclusion!==null)fail('RUN_REJECTED');
 const ownJobs=completeJobs(runJobs),authorize=ownJobs.filter(job=>job.name==='authorize'),repair=ownJobs.filter(job=>job.name==='repair');
 if(authorize.length!==1||ownJobs.some(job=>job.run_id!==run.id||job.run_attempt!==1||job.head_sha!==c.revision))fail('HOST_REJECTED');
 if(stage==='hosted') {
  if(c.runnerEnvironment!=='github-hosted'||c.runnerOS!=='Linux'||c.platform!=='linux'||authorize[0].status!=='in_progress')fail('HOST_REJECTED');
 } else {
  if(c.platform!=='darwin'||c.runnerOS!=='macOS'||c.runnerEnvironment!=='self-hosted'||c.runnerName!=='MacBook'||
   authorize[0].status!=='completed'||authorize[0].conclusion!=='success'||repair.length!==1||repair[0].status!=='in_progress'||
   repair[0].runner_id!==22||repair[0].runner_name!=='MacBook'||repair[0].runner_group_id!==1||
   !Array.isArray(repair[0].labels)||['self-hosted','macOS','ARM64'].some(label=>!repair[0].labels.includes(label)))fail('HOST_REJECTED');
 }
 const evidence=Object.freeze({sourceRevision:c.revision,ciRunId:String(ci.id),ciRunAttempt:ci.run_attempt,
  workflowRunId:c.runId,workflowRunAttempt:1,stage,approvalId:MODE_APPROVAL_ID,verifiedAt:now,
  productionAcceptance:false,originalGoalRecovered:false});
 verified.add(evidence);return evidence;
}

export function createSpecificModeGate({evidence,scope,verifySource,claim,now=Date.now}={}) {
 if(!verified.has(evidence)||evidence.stage!=='mac'||typeof verifySource!=='function'||typeof claim!=='function'||
  !scope||scope.sourceRevision!==evidence.sourceRevision||!hash(scope.artifactDigest)||typeof scope.hostId!=='string'||
  scope.hostId.length<1||scope.hostId.length>128||!Number.isSafeInteger(scope.ownerUid)||scope.ownerUid<=0||
  !Number.isSafeInteger(scope.expiresAt))fail('GATE_CONTEXT_REJECTED');
 const pinned=Object.freeze({...scope}),created=now();time(created);
 if(pinned.expiresAt<=created||pinned.expiresAt-created>MODE_APPROVAL.maxPlanLifetimeMs||
  pinned.expiresAt>Date.parse(MODE_APPROVAL.eligibleUntil))fail('GATE_CONTEXT_REJECTED');
 const permit=opaque();let reserved=false,binding=null,receipt=null;
 function assertAuthority() {const current=now();time(current);if(current>=pinned.expiresAt)fail('PERMIT_EXPIRED');}
 function checkBinding(value) {
  if(!value||!Object.isFrozen(value)||!isOpaque(value.plan)||!hash(value.proposalDigest)||!hash(value.factsDigest)||
   Object.keys(pinned).some(key=>value[key]!==pinned[key])||value.operation!=='compass-mode-narrowing'||
   value.permissionChange!==true||value.risk!=='HIGH'||value.requiresHumanApproval!==true)fail('BINDING_REJECTED');
 }
 const gate=Object.freeze({
  async consume(value,proposed) {
   assertAuthority();checkBinding(proposed);
   if(value!==permit||reserved)fail('PERMIT_REJECTED');
   reserved=true;
   await verifySource();assertAuthority();checkBinding(proposed);
   // The native port also requires this exact retained PLANNED object, and
   // strips its in-process plan handle only for the private worker wire.
   const claimReceipt=await claim(proposed);
   assertAuthority();if(!isOpaque(claimReceipt))fail('CONSUMPTION_UNCONFIRMED');
   binding=proposed;receipt=opaque();return receipt;
  },
  async verify(value,expected,phase) {
   assertAuthority();
   if(!receipt||value!==receipt||expected!==binding||!['apply','rollback'].includes(phase))fail('PERMIT_REJECTED');
   await verifySource();assertAuthority();return receipt;
  },
 });
 return Object.freeze({permit,gate,assertAuthority});
}
