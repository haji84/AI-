// Read-only original-state recovery evidence for Issue #1219.
// Never imports/migrates a Goal, starts a service, grants a lease or writes records.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readSync, fstatSync, statSync, realpathSync, constants } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PHASES = new Set(['QUEUED','RUNNING','PLANNING','IMPLEMENTING','WAITING_FOR_CONNECTIVITY',
  'WAITING_FOR_RESOURCE','VERIFYING','RECOVERING','READY_TO_PUBLISH','PUBLISHING',
  'HUMAN_GATE','BLOCKED','COMPLETED','CANCELLED','FAILED']);
const phase = value => PHASES.has(value) ? value : null;
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{5,159}$/.test(value) && !value.includes('..');
const validSelection = value => validId(value?.goalId) && validId(value?.jobId);

// Only the already authenticated, explicitly selected HTTP404 branch may
// access local source/store metadata. Successful reads and other failures
// keep their original output and never add disk/process access.
export async function attachOwnerStoreEvidence(result, request, inspect = collectOwnerStoreEvidence) {
  if (request?.mode !== 'broker' || !validSelection(request) || result?.status !== 'HOLD' ||
      result.reason !== 'GOAL_RUN_NOT_AUTHENTICATED_OR_FOUND' || result.brokerAuthenticated !== true ||
      result.readFailure?.kind !== 'HTTP' || result.readFailure.httpStatus !== 404) return result;
  let sourceObservation;
  try { sourceObservation = await inspect({goalId:request.goalId, jobId:request.jobId}); }
  catch { sourceObservation = {status:'INSPECTION_UNAVAILABLE', executionAuthorized:false}; }
  return {...result,sourceObservation};
}

export function summarizeActive(active,goalId) {
  if (!Array.isArray(active)) return {status:'INVALID_ACTIVE_SCHEMA'};
  const envelopes=active.filter(x=>x?.kind==='jarvis-work-runs');
  if (envelopes.length>1) return {status:'AMBIGUOUS_WORKRUN_ENVELOPE'};
  if (!envelopes.length) return {status:'NO_WORKRUN_ENVELOPE_OBSERVED',selectedWorkRunCount:0,selectedWorkRunPhase:null};
  const envelope=envelopes[0];
  if(envelope.version!==1||!Array.isArray(envelope.runs))return {status:'INVALID_WORKRUN_SCHEMA'};
  const selected=envelope.runs.filter(x=>x?.goalId===goalId);
  return {status:'STORED_WORKRUN_OBSERVATION_ONLY',selectedWorkRunCount:selected.length,
    selectedWorkRunPhase:selected.length===1?phase(selected[0].phase):null};
}

export function deriveConfiguredPaths(config,cwd) {
  const a=typeof config?.JARVIS_DB_PATH==='string'?config.JARVIS_DB_PATH.trim():'';
  const b=typeof config?.JARVIS_COMPASS_DB_PATH==='string'?config.JARVIS_COMPASS_DB_PATH.trim():'';
  if ([a,b].some(x=>/[$`\r\n\0]/.test(x))) return {status:'UNRESOLVED_CONFIG_EXPANSION',broker:null,compass:null};
  return {status:'CONFIG_FILE_RULE_DERIVATION_ONLY',broker:resolve(cwd,a||'.jarvis/jarvis.db'),
    compass:resolve(cwd,b||(a?a+'.compass.sqlite':'.jarvis/compass.db'))};
}

export function entrySourceFromCommand(command,cwd) {
  // ps is a text view, not an argv attestation. Reject ambiguous quoting/space cases.
  if (typeof command!=='string' || command.length>8192 || /["'`\r\n]/.test(command)) return null;
  const args=command.trim().split(/\s+/);
  if (basename(args[0]??'')!=='node') return null;
  const candidates=args.slice(1).filter(x=>/^(?:[A-Za-z0-9_.-]+\/|\/)[A-Za-z0-9_/.:+-]*scripts\/jarvis-broker\.ts$/.test(x)||x==='scripts/jarvis-broker.ts');
  return candidates.length===1?resolve(cwd,candidates[0]):null;
}

export function parseLsof(text) {
  const rows=[];let row=null;
  for(const line of String(text).split('\n')) {
    if(/^p[0-9]+$/.test(line)){row={pid:Number(line.slice(1)),names:[]};rows.push(row);}
    else if(row&&line.startsWith('n'))row.names.push(line.slice(1));
  }
  return rows;
}

function boundedFile(path,maxBytes) {
  const fd=openSync(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before=fstatSync(fd);
    if(!before.isFile()||before.size>maxBytes)throw Error('BOUNDED_FILE_REQUIRED');
    const bytes=Buffer.alloc(maxBytes+1);let length=0;
    while(length<bytes.length){const n=readSync(fd,bytes,length,bytes.length-length,length);if(n===0)break;length+=n;}
    const after=fstatSync(fd);
    if(length>maxBytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('FILE_CHANGED_OR_TOO_LARGE');
    return bytes.subarray(0,length);
  } finally {closeSync(fd);}
}

export async function inspectCompass(path,goalId) {
  let db;
  const evidence={readOnly:true,executionAuthorized:false};
  try {
    const stat=statSync(path);
    if(!stat.isFile())return {...evidence,status:'FILE_NOT_AVAILABLE'};
  } catch {return {...evidence,status:'FILE_NOT_AVAILABLE'};}
  try {
    const {DatabaseSync}=await import('node:sqlite');
    db=new DatabaseSync(path,{readOnly:true});
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
    const table=db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='state'").get();
    if(!table)return {...evidence,status:'COMPASS_SCHEMA_NOT_CONFIRMED'};
    const columns=db.prepare('PRAGMA table_info(state)').all().map(x=>x.name);
    if(!columns.includes('project_id')||!columns.includes('active'))return {...evidence,status:'COMPASS_SCHEMA_NOT_CONFIRMED'};
    const size=db.prepare("SELECT length(CAST(active AS BLOB)) AS bytes FROM state WHERE project_id='default'").get();
    if(!size)return {...evidence,status:'DEFAULT_STATE_NOT_OBSERVED'};
    if(!Number.isSafeInteger(size.bytes)||size.bytes>1048576)return {...evidence,status:'ACTIVE_PAYLOAD_BOUND_EXCEEDED'};
    const row=db.prepare("SELECT active FROM state WHERE project_id='default'").get();
    const goalTable=db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='goal'").get();
    let currentGoalPresent=null,selectedGoalMatchesCurrent=null;
    if(goalTable) {
      const goalColumns=new Set(db.prepare('PRAGMA table_info(goal)').all().map(item=>item.name));
      if(['id','title','description'].every(name=>goalColumns.has(name))) {
        const sizes=db.prepare("SELECT length(CAST(title AS BLOB))+coalesce(length(CAST(description AS BLOB)),0) AS bytes FROM goal WHERE id=1").get();
        currentGoalPresent=Boolean(sizes);
        if(sizes && Number.isSafeInteger(sizes.bytes) && sizes.bytes<=262144) {
          const goal=db.prepare("SELECT title,description FROM goal WHERE id=1").get();
          if(typeof goal.title==='string' && (goal.description===null || typeof goal.description==='string')) {
            // Same identity projection as goalWorkStateId; only a comparison,
            // not a replacement Goal or proof of loaded runtime behavior.
            selectedGoalMatchesCurrent=('goal-'+fingerprint(JSON.stringify({title:goal.title,description:goal.description??''})).slice(0,16))===goalId;
          }
        }
      }
    }
    let stopStatus=null;
    if(columns.includes('status')) {
      const status=db.prepare("SELECT status FROM state WHERE project_id='default'").get()?.status;
      if(['PAUSED','CANCELLED','HUMAN_GATE','RUNNING','BLOCKED','COMPLETED','NOT_ACHIEVED','ACHIEVED'].includes(status))stopStatus=status;
    }
    return {...evidence,...summarizeActive(JSON.parse(row.active),goalId),currentGoalPresent,selectedGoalMatchesCurrent,stopStatus};
  } catch {return {...evidence,status:'READONLY_DB_INSPECTION_UNAVAILABLE'};}
  finally {if(db){try{db.exec('ROLLBACK');}catch{}try{db.close();}catch{}}}
}

export function inspectJobs(path,goalId,jobId) {
  const evidence={pathBasis:'CURRENT_MAIN_RULE_NOT_RUNNING_CODE_ATTESTATION',executionAuthorized:false};
  try {
    const snapshot=JSON.parse(boundedFile(path,4194304).toString('utf8'));
    if(snapshot?.version!==1||!Array.isArray(snapshot.jobs))return {...evidence,status:'JOB_SNAPSHOT_SCHEMA_NOT_CONFIRMED'};
    const selected=snapshot.jobs.filter(x=>x?.jobId===jobId&&x?.goalId===goalId);
    return {...evidence,status:'STORED_JOB_OBSERVATION_ONLY',selectedJobMatchCount:selected.length,
      selectedJobPhase:selected.length===1?phase(selected[0].phase):null};
  } catch {return {...evidence,status:'JOB_FILE_UNAVAILABLE_OR_INVALID'};}
}

function nativeCommand(file,args) {
  const r=spawnSync(file,args,{encoding:'utf8',timeout:2500,maxBuffer:262144,
    env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},windowsHide:true});
  if(r.error||r.status!==0)throw Error('LOCAL_INSPECTION_UNAVAILABLE');
  return r.stdout;
}
function real(path){try{return realpathSync(path);}catch{return null;}}
function inHome(path,home){const rel=relative(home,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);}

export async function collectOwnerStoreEvidence(selection, {config=process.env,runCommand=nativeCommand,platform=process.platform,
  ownerUid=userInfo().uid,home=homedir(),referenceBrokerPath=fileURLToPath(new URL('./jarvis-broker.ts',import.meta.url))}={}) {
  const result={status:'INCONCLUSIVE',sourceEvidence:'ON_DISK_ONLY_NOT_LOADED_BYTES',
    loadedSourceVerified:false,configFileIsProcessEnvironmentProof:false,executionAuthorized:false};
  if(!validSelection(selection))return {...result,status:'SELECTION_INVALID'};
  if(platform!=='darwin')return {...result,status:'NATIVE_INSPECTION_NOT_SUPPORTED'};
  try {
    const listenerArgs=['-nP','-a','-iTCP:8787','-sTCP:LISTEN','-Fpn'];
    const listeners=()=>parseLsof(runCommand('/usr/sbin/lsof',listenerArgs)).filter(x=>x.names.includes('127.0.0.1:8787'));
    const first=listeners();
    if(first.length!==1)return {...result,status:'SINGLE_LOOPBACK_LISTENER_NOT_CONFIRMED'};
    const pid=first[0].pid;
    if(Number(runCommand('/bin/ps',['-p',String(pid),'-o','uid=']).trim())!==ownerUid)return {...result,status:'LISTENER_OWNER_NOT_CONFIRMED'};
    const started=runCommand('/bin/ps',['-p',String(pid),'-o','lstart=']).trim();
    const cwdRows=parseLsof(runCommand('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-d','cwd','-Fpn']));
    const cwd=cwdRows.length===1?cwdRows[0].names[0]:null;
    if(!cwd||!isAbsolute(cwd)||!inHome(cwd,home))return {...result,status:'BROKER_CWD_NOT_CONFIRMED'};
    result.brokerCwdFingerprint=fingerprint(cwd);
    const command=runCommand('/bin/ps',['-ww','-p',String(pid),'-o','args=']).trim();
    const candidate=entrySourceFromCommand(command,cwd);
    const source=candidate&&real(candidate);
    result.entryPathRecognized=Boolean(source&&inHome(source,home));
    if(result.entryPathRecognized) {
      const bytes=boundedFile(source,1048576);
      result.entryPathFingerprint=fingerprint(source);result.entryGitBlob=gitBlob(bytes);
      try { result.entryFileMatchesCheckout=result.entryGitBlob===gitBlob(boundedFile(referenceBrokerPath,1048576)); }
      catch { result.entryFileMatchesCheckout=null; }
      try {
        const revision=runCommand('/usr/bin/git',['--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',dirname(dirname(source)),'rev-parse','HEAD']).trim();
        result.onDiskGitRevision=/^[a-f0-9]{40}$/.test(revision)?revision:null;
      }catch{result.onDiskGitRevision=null;}
    }
    const fileRows=parseLsof(runCommand('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-Fpn']));
    if(fileRows.length!==1||fileRows[0].pid!==pid)return {...result,status:'OPEN_FILES_NOT_BOUND_TO_LISTENER'};
    const openPaths=new Set(fileRows[0].names.filter(x=>isAbsolute(x)).map(real).filter(Boolean));
    const configured=deriveConfiguredPaths(config,cwd);
    result.configPathDerivation=configured.status;
    const desired=configured.compass&&real(configured.compass);
    result.configuredCompassOpenByListener=desired?openPaths.has(desired):null;
    if(desired)result.configuredCompassFingerprint=fingerprint(desired);
    const candidates=[...openPaths].filter(x=>inHome(x,home)&&
      (x===desired||/compass[^/]*\.(?:db|sqlite)$/.test(basename(x))));
    result.openCompassCandidateCount=candidates.length;
    if(candidates.length===1) {
      const actual=candidates[0];result.openCompassFingerprint=fingerprint(actual);
      result.openCompassObservation=await inspectCompass(actual,selection.goalId);
      const jobs=real(join(dirname(actual),'self-development','jobs.json'));
      result.derivedJobObservation=jobs&&inHome(jobs,home)?inspectJobs(jobs,selection.goalId,selection.jobId):
        {status:'DERIVED_JOB_FILE_NOT_CONFIRMED',executionAuthorized:false};
    }
    const last=listeners();
    const endStarted=runCommand('/bin/ps',['-p',String(pid),'-o','lstart=']).trim();
    result.listenerStableDuringObservation=last.length===1&&last[0].pid===pid&&started===endStarted;
    result.status=result.listenerStableDuringObservation?'NATIVE_OBSERVATION_ONLY':'PROCESS_CHANGED_OBSERVATIONS_NOT_BOUND';
    return result;
  } catch {return {...result,status:'NATIVE_INSPECTION_UNAVAILABLE'};}
}

