// Fixed bridge G1 copied-state query. The Windows adapter alone acquires originals.
// Only work/ is opened here; raw/ is retained and never opened by SQLite.
import { readFileSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { inspectCurrentCompass, inspectHistoricalTable, exactIdentifiers } from './goriq-g1-backup-inventory.mjs';
const GOAL='goal-fcc81c97e09153f7',JOB='rotation-recovery-37';
const MAX_JSON=4*1024*1024,MAX_ACTIVE=1024*1024;
const PHASES=new Set(['QUEUED','PLANNING','IMPLEMENTING','RUNNING','WAITING_FOR_CONNECTIVITY','WAITING_FOR_RESOURCE','VERIFYING','RECOVERING','READY_TO_PUBLISH','PUBLISHING','HUMAN_GATE','BLOCKED','COMPLETED','CANCELLED','FAILED']);
// DatabaseSync.readOnly: Node22.12 and Node23.2 (reviewed archived Node API docs).
// This dependency-free reader does not require the application's Node24.19 floor.
export function supportsReadOnlySqlite(version) {
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return false;
 const [major,minor]=version.split('.').map(Number);return major>=24||(major===23&&minor>=2)||(major===22&&minor>=12);
}
export function emptySummary() {
 return {version:1,mode:'FIXED_BRIDGE_COPIED_STATE',status:'INCOMPLETE',failureCode:'COPIED_QUERY_INVALID',readOnly:true,preserved:false,preservationMode:null,queryVerified:false,currentGoalMatches:null,jobMatches:null,attemptCount:null,transitionCount:null,changeSetMatches:null,workRunCount:null,workRunPhase:null,paused:null,blockerCount:null,approvalRecorded:null,jobsPresent:false,changesPresent:false,historicalGoalRows:null,historicalJobRows:null,authorityComplete:false,originalGoalRecovered:false,g1:'HOLD'};
}
function requireCondition(value) {if(!value)throw Error('COPIED_QUERY_INVALID');}
function boundedJson(raw,limit,budgetUntil) {
 requireCondition(typeof raw==='string'&&Buffer.byteLength(raw)<=limit);
 exactIdentifiers(raw,GOAL,JOB,budgetUntil); // shared node/depth/budget checks, no prose search
 return JSON.parse(raw);
}
function copiedFile(root,name,limit) {
 const path=join(root,'work',name),st=lstatSync(path);
 requireCondition(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size<=limit&&realpathSync(path)===path);
 const bytes=readFileSync(path);requireCondition(bytes.length===st.size);return bytes;
}
function sidecar(root,name,field,budgetUntil) {
 let bytes;try{bytes=copiedFile(root,name,MAX_JSON);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const value=boundedJson(bytes.toString('utf8'),MAX_JSON,budgetUntil);
 requireCondition(value?.version===1&&Array.isArray(value[field])&&value[field].length<=2000);
 const ids=new Set();const key=field==='jobs'?'jobId':'changeSetId';
 for(const record of value[field]){requireCondition(record&&typeof record[key]==='string'&&!ids.has(record[key])&&record.version===1);ids.add(record[key]);}
 return value[field];
}
function envelopes(active,goalId) {
 requireCondition(Array.isArray(active));const selected={};
 const singleton=new Set(['jarvis-work-runs','gai-goal-controller-decisions','gai-shared-context','goriq-goal-execution-context','goriq-goal-bridge-events','jarvis-owner-requirements']);
 for(const kind of [...singleton,'gai-work-state']) {
  const all=active.filter(x=>x?.kind===kind);
  if(singleton.has(kind))requireCondition(all.length<=1);
  const envelopeIds=new Set();
  for(const item of all) {
   requireCondition(item.version===1);
   if(kind==='gai-work-state'){
    requireCondition(typeof item.goalId==='string'&&!envelopeIds.has(item.goalId)&&item.state?.goalId===item.goalId&&Array.isArray(item.events)&&item.events.length<=100);envelopeIds.add(item.goalId);
    if(item.goalId===goalId)selected.workState=item;continue;
   }
   const field=kind==='jarvis-work-runs'?'runs':kind==='goriq-goal-bridge-events'?'events':'records';
   requireCondition(Array.isArray(item[field]));const ids=new Set();
   for(const record of item[field]) {
    const id=kind==='jarvis-work-runs'||kind==='goriq-goal-execution-context'?record?.goalId:kind==='gai-goal-controller-decisions'?record?.keyDigest:record?.id;
    requireCondition(typeof id==='string'&&!ids.has(id));ids.add(id);
    if(kind==='gai-goal-controller-decisions')requireCondition(/^[a-f0-9]{64}$/.test(id)&&typeof record?.decision?.goalId==='string');
   }
   selected[kind]=item[field].filter(r=>(kind==='gai-goal-controller-decisions'?r.decision?.goalId:r.goalId)===goalId);
  }
 }
 return selected;
}
// The configurable IDs are a pure correlation seam for real SQLite fixtures;
// the sole production CLI below always selects the two fixed original IDs.
export function inspectWorkingBundle(root,{goalId=GOAL,jobId=JOB}={}) {
 const summary=emptySummary(),privateResult={};let db;
 try {
  requireCondition(resolve(root)===root&&realpathSync(root)===root);
  copiedFile(root,'compass.sqlite',64*1024*1024);
  const work=join(root,'work');requireCondition(lstatSync(work).isDirectory()&&!lstatSync(work).isSymbolicLink()&&realpathSync(work)===work);
  for(const suffix of ['-wal','-shm','-journal']) {
   try {if(suffix==='-journal'){lstatSync(join(work,'compass.sqlite'+suffix));throw Error('COPIED_QUERY_INVALID');}copiedFile(root,'compass.sqlite'+suffix,suffix==='-shm'?4*1024*1024:64*1024*1024);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const budgetUntil=Date.now()+30000;
  db=new DatabaseSync(join(work,'compass.sqlite'),{readOnly:true});
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0; PRAGMA trusted_schema=OFF; BEGIN');
  requireCondition(db.prepare('PRAGMA query_only').get()?.query_only===1);
  requireCondition(db.prepare('PRAGMA quick_check(1)').get()?.quick_check==='ok');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goal','state','history','verification')").all().map(r=>r.name));
  requireCondition(tables.has('goal')&&tables.has('state'));
  const expectedGoal=['id','title','description','success_criteria','constraints','created_at','updated_at'];
  const expectedState=['project_id','phase','status','completed','active','blockers','decisions','deliverables','verification_summary','next_action','updated_at'];
  const actualGoal=new Set(db.prepare('PRAGMA table_info(goal)').all().map(r=>r.name)),actualState=new Set(db.prepare('PRAGMA table_info(state)').all().map(r=>r.name));
  requireCondition(expectedGoal.every(x=>actualGoal.has(x))&&expectedState.every(x=>actualState.has(x)));
  const current=inspectCurrentCompass(db,tables,goalId);requireCondition(current.status==='READONLY_SQLITE');
  const stateColumns=db.prepare('PRAGMA table_info(state)').all().map(r=>r.name);
  const lengths=stateColumns.map(x=>'coalesce(length(CAST("'+x.replaceAll('"','""')+'" AS BLOB)),0)').join('+');
  const sizes=db.prepare("SELECT "+lengths+" AS n FROM state WHERE project_id='default' LIMIT 2").all();
  requireCondition(sizes.length===1&&Number.isSafeInteger(sizes[0].n)&&sizes[0].n<=MAX_ACTIVE);
  const state=db.prepare("SELECT * FROM state WHERE project_id='default'").get();
  requireCondition(state.status===null||typeof state.status==='string');
  const goalColumns=db.prepare('PRAGMA table_info(goal)').all().map(r=>r.name);
  const goalLengths=goalColumns.map(x=>'coalesce(length(CAST("'+x.replaceAll('"','""')+'" AS BLOB)),0)').join('+');
  requireCondition(db.prepare('SELECT '+goalLengths+' AS n FROM goal WHERE id=1 LIMIT 2').all().every(r=>Number.isSafeInteger(r.n)&&r.n<=MAX_ACTIVE));
  const goal=db.prepare('SELECT * FROM goal WHERE id=1').get()??null;
  for(const field of ['success_criteria','constraints'])if(goal)requireCondition(Array.isArray(boundedJson(goal[field],MAX_ACTIVE,budgetUntil)));
  requireCondition(db.prepare('SELECT count(*) AS n FROM goal WHERE id=1').get().n<=1);
  for(const field of ['active','completed','blockers','decisions','deliverables'])requireCondition(Array.isArray(boundedJson(state[field],MAX_ACTIVE,budgetUntil)));
  const selected=envelopes(boundedJson(state.active,MAX_ACTIVE,budgetUntil),goalId);
  const historical={};let historicalGoalRows=0,historicalJobRows=0;
  for(const table of ['state','history','verification']) {
   const result=inspectHistoricalTable(db,tables,table,goalId,jobId,budgetUntil);historical[table]=result;
   requireCondition(['READONLY_SQLITE','TABLE_UNAVAILABLE'].includes(result.status)&&result.invalidRecords===0);
   historicalGoalRows+=result.goalMatches;historicalJobRows+=result.jobMatches;
  }
  const jobs=sidecar(root,'jobs.json','jobs',budgetUntil),changes=sidecar(root,'change-sets.json','changeSets',budgetUntil);
  const named=jobs?.filter(x=>x.jobId===jobId)??[];requireCondition(named.every(x=>x.goalId===goalId));
  const job=named[0];if(job)requireCondition(PHASES.has(job.phase)&&Array.isArray(job.attempts)&&Array.isArray(job.history)&&Array.isArray(job.blockers)&&job.approvalScope&&typeof job.approvalScope.taskScopeId==='string'&&['low','medium','high','critical'].includes(job.approvalScope.maxRisk)&&(job.approvalScope.expiresAt===undefined||(typeof job.approvalScope.expiresAt==='string'&&Number.isFinite(Date.parse(job.approvalScope.expiresAt)))));
  if(job){
   const ids=new Set();
   for(const transition of job.history){requireCondition(transition&&typeof transition.transitionId==='string'&&!ids.has(transition.transitionId)&&PHASES.has(transition.to)&&typeof transition.reason==='string');ids.add(transition.transitionId);}
   for(const attempt of job.attempts)requireCondition(attempt&&typeof attempt==='object'&&['signature','strategyId','hypothesis','recordedAt'].every(k=>typeof attempt[k]==='string')&&Number.isFinite(Date.parse(attempt.recordedAt)));
  }
  const linked=job?changes?.filter(x=>x.jobId===jobId)??[]:[];
  const runs=selected['jarvis-work-runs']??[];requireCondition(runs.length<=1&&runs.every(r=>PHASES.has(r.phase)));
  Object.assign(privateResult,{goal,state,selected,jobs:named,changeSets:linked,historical,current,unresolvedExternalReferences:linked.map(x=>({changeSetId:x.changeSetId,artifactRef:x.artifactRef??null,evidenceDigest:x.evidenceDigest??null,lineageComplete:false})),authorityComplete:false});
  Object.assign(summary,{status:'COPIED_STATE_READ',failureCode:'NONE',queryVerified:true,currentGoalMatches:current.goalMatches,jobMatches:jobs?named.length:null,attemptCount:job?.attempts.length??(jobs?0:null),transitionCount:job?.history.length??(jobs?0:null),changeSetMatches:changes&&job?linked.length:null,workRunCount:runs.length,workRunPhase:runs[0]?.phase??null,paused:state.status===null?null:state.status==='PAUSED',blockerCount:JSON.parse(state.blockers).length,approvalRecorded:job?true:null,jobsPresent:jobs!==null,changesPresent:changes!==null,historicalGoalRows,historicalJobRows});
 }catch(error){privateResult.failure=String(error?.stack??error);}
 finally{try{if(db)db.exec('ROLLBACK');}catch{}try{db?.close();}catch{}}
 return {public:summary,private:privateResult};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 // Paths are supplied only by the pinned adapter, never workflow inputs.
 let result={public:emptySummary(),private:{}};
 try {
  requireCondition(process.platform==='win32'&&supportsReadOnlySqlite(process.versions.node)&&process.argv.length===3);
  result=inspectWorkingBundle(process.argv[2]);
  const output=join(process.argv[2],'interpretation.json'),st=lstatSync(output);
  requireCondition(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size===0&&realpathSync(output)===output);
  result.private.runtime={path:process.execPath,version:process.version};
  writeFileSync(output,JSON.stringify(result.private),{flag:'r+'});
 }catch{result.public=emptySummary();}
 process.stdout.write(JSON.stringify(result.public)+'\n');
}
