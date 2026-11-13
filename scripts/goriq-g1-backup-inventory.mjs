// Read-only, bounded G1 recovery inventory. Never exports Goal/Job contents,
// filesystem paths, credential values, SQLite bytes or backup payloads.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const GOAL = 'goal-fcc81c97e09153f7';
const JOB = 'rotation-recovery-37';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_GENERATIONS = 32;
const MAX_DB_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_BYTES = 1024 * 1024;
const STATES = new Set(['QUEUED','PLANNING','RUNNING','VERIFYING','RECOVERING','HUMAN_GATE','BLOCKED','COMPLETED','FAILED']);
const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function within(root,path) {
  const delta = relative(root,path);
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..'+sep));
}
function safePath(path,kind,maxBytes=MAX_JSON_BYTES) {
  const st=lstatSync(path);
  if (ownerUid===null || st.uid!==ownerUid || st.isSymbolicLink() ||
      (kind==='directory' ? !st.isDirectory() || (st.mode & 0o077)!==0 :
        !st.isFile() || st.nlink!==1 || (st.mode & 0o077)!==0 || st.size<1 || st.size>maxBytes)) throw Error('UNSAFE');
  if (realpathSync(path)!==path) throw Error('ALIAS');
  return st;
}
function privateJson(path,limit=MAX_JSON_BYTES) {
  const before=safePath(path,'file',limit);
  const raw=readFileSync(path);
  const after=lstatSync(path);
  if(raw.length!==before.size || before.ino!==after.ino || before.mtimeMs!==after.mtimeMs)throw Error('CHANGED');
  return JSON.parse(raw.toString('utf8'));
}
function inspectCompass(path,goalId) {
  let db;
  try {
    safePath(path,'file',MAX_DB_BYTES);
    db=new DatabaseSync(path,{readOnly:true});
    db.exec('PRAGMA query_only=ON');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goal','state')").all().map(x=>x.name));
    if(!tables.has('goal')||!tables.has('state'))return {status:'SCHEMA_UNCONFIRMED'};
    const columns=new Set(db.prepare('PRAGMA table_info(state)').all().map(x=>x.name));
    if(!columns.has('active')||!columns.has('project_id'))return {status:'SCHEMA_UNCONFIRMED'};
    const goal=db.prepare('SELECT title, description FROM goal WHERE id=1').get();
    const goalPresent=!!goal;
    const goalMatches=goalPresent && typeof goal.title==='string' && typeof goal.description==='string'
      ? ('goal-'+sha256(JSON.stringify({title:goal.title,description:goal.description})).slice(0,16))===goalId
      : null;
    const len=db.prepare("SELECT length(CAST(active AS BLOB)) AS n FROM state WHERE project_id='default'").get()?.n;
    if(!Number.isSafeInteger(len)||len<1||len>MAX_ACTIVE_BYTES)return {status:'STATE_UNAVAILABLE',goalPresent,goalMatches};
    const raw=db.prepare("SELECT active FROM state WHERE project_id='default'").get()?.active;
    const active=JSON.parse(raw);
    if(!Array.isArray(active))return {status:'STATE_UNAVAILABLE',goalPresent,goalMatches};
    const envelopes=active.filter(x=>x?.kind==='jarvis-work-runs');
    if(envelopes.length>1)return {status:'AMBIGUOUS_WORKRUN',goalPresent,goalMatches};
    if(envelopes.length===1 && (envelopes[0]?.version!==1 || !Array.isArray(envelopes[0]?.runs)))
      return {status:'WORKRUN_SCHEMA_UNCONFIRMED',goalPresent,goalMatches};
    const runs=envelopes.length ? envelopes[0].runs.filter(x=>x?.goalId===goalId) : [];
    return {status:'READONLY_SQLITE',goalPresent,goalMatches,selectedWorkRuns:runs.length,
      selectedPhase:runs.length===1 && STATES.has(runs[0]?.phase)?runs[0].phase:null};
  } catch {return {status:'UNAVAILABLE_OR_INVALID'};}
  finally {try{db?.close();}catch{}}
}
function inspectSidecars(compassPath,goalId,jobId) {
  const base=join(dirname(compassPath),'self-development');
  let jobs={status:'UNAVAILABLE'}, changes={status:'UNAVAILABLE'};
  try {
    const j=privateJson(join(base,'jobs.json'));
    if(j?.version===1 && Array.isArray(j.jobs) && j.jobs.length<=2000) {
      const matched=j.jobs.filter(x=>x?.jobId===jobId && x?.goalId===goalId);
      jobs={status:'READONLY_JSON',matches:matched.length,attempts:matched.reduce((sum,x)=>sum+(Array.isArray(x.attempts)?x.attempts.length:0),0),
        transitions:matched.reduce((sum,x)=>sum+(Array.isArray(x.history)?x.history.length:0),0)};
    }
  }catch{}
  try {
    const c=privateJson(join(base,'change-sets.json'));
    if(c?.version===1 && Array.isArray(c.changeSets) && c.changeSets.length<=2000) {
      const matched=c.changeSets.filter(x=>x?.jobId===jobId);
      changes={status:'READONLY_JSON',matches:matched.length,rejected:matched.filter(x=>x?.status==='REJECTED').length};
    }
  }catch{}
  return {jobs,changes};
}
async function verifyGeneration(directory,id) {
  safePath(directory,'directory');
  const metadata=privateJson(join(directory,'generation.json'),8192);
  if(metadata?.id!==id || metadata.status!=='ready' || metadata.activationAuthorized!==false ||
     !Array.isArray(metadata.stores)||metadata.stores.length!==2 ||
     metadata.stores[0]?.store!=='broker'||metadata.stores[1]?.store!=='compass')throw Error('GENERATION_INVALID');
  const stores=metadata.stores;
  for (const entry of stores) {
    if(!HASH.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes<1 || entry.sizeBytes>MAX_DB_BYTES)throw Error('CATALOG_INVALID');
    const path=join(directory,entry.store+'.sqlite');
    const stat=safePath(path,'file',MAX_DB_BYTES);
    if(stat.size!==entry.sizeBytes)throw Error('SIZE_MISMATCH');
    const manifest=privateJson(path+'.manifest.json',8192);
    if(manifest.formatVersion!==1||manifest.databaseFile!==entry.store+'.sqlite'||manifest.sha256!==entry.sha256||
       manifest.sizeBytes!==entry.sizeBytes||manifest.generationId!==id||manifest.quickCheck!=='ok')throw Error('MANIFEST_INVALID');
    const before=lstatSync(path), bytes=readFileSync(path), after=lstatSync(path);
    if(bytes.length!==before.size||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||sha256(bytes)!==entry.sha256)throw Error('DIGEST_MISMATCH');
    let db;
    try {db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON');if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('QUICK_CHECK_FAILED');}
    finally {db?.close();}
  }
  return {path:join(directory,'compass.sqlite'),verified:true};
}
export async function inspectCandidate({label,brokerPath,compassPath,goalId=GOAL,jobId=JOB,home=homedir(),budgetUntil=Date.now()+110000}) {
  const result={label,status:'NOT_FOUND',backupsChecked:0,backupsInvalid:0,backupGoalMatches:0,backupWorkRunMatches:0,active:null,sidecars:null};
  if(!within(home,brokerPath)||!within(home,compassPath))return {...result,status:'OUTSIDE_HOME_REFUSED'};
  const current=inspectCompass(compassPath,goalId);
  if(current.status==='READONLY_SQLITE')result.active=current;
  result.sidecars=inspectSidecars(compassPath,goalId,jobId);
  const root=brokerPath+'.state-backups';
  if(!existsSync(root))return {...result,status:'NO_MANAGED_BACKUP_ROOT'};
  try {
    safePath(root,'directory');
    const entries=readdirSync(root).filter(name=>name!=='.operation.sqlite');
    if(entries.length>MAX_GENERATIONS || entries.some(n=>!UUID.test(n)))return {...result,status:'CATALOG_UNSAFE'};
    for(const id of entries.sort()) {
      if(Date.now()>budgetUntil)return {...result,status:'BUDGET_EXHAUSTED'};
      try {
        const gen=await verifyGeneration(join(root,id),id);
        const summary=inspectCompass(gen.path,goalId);
        result.backupsChecked++;
        if(summary.status==='READONLY_SQLITE'){
          if(summary.goalMatches===true)result.backupGoalMatches++;
          result.backupWorkRunMatches+=summary.selectedWorkRuns;
        }else result.backupsInvalid++;
      }catch{result.backupsInvalid++;}
    }
    return {...result,status:result.backupsInvalid?'PARTIAL_CATALOG': 'CATALOG_VERIFIED'};
  }catch{return {...result,status:'CATALOG_UNAVAILABLE_OR_UNSAFE'};}
}
export function ownerFileConfiguredPaths(home) {
  // Parse only two literal pathname assignments. Never source/evaluate an env
  // file: it may also contain tokens and executable shell syntax.
  const config=join(home,'Library','Application Support','JARVIS','jarvis.env');
  try {
    const text=privateJsonText(config,65536);
    const result={};
    for(const line of text.split(/\r?\n/)) {
      const match=line.match(/^\s*(?:export\s+)?(JARVIS_DB_PATH|JARVIS_COMPASS_DB_PATH)=("[^"]*"|'[^']*'|[^\s#]+)\s*$/);
      if(!match)continue;
      const literal=match[2].replace(/^(?:"|')|(?:"|')$/g,'');
      if(literal.length>1 && literal.length<=1024 && isAbsolute(literal) && within(home,literal) && !/[`$\\\0]/.test(literal))result[match[1]]=resolve(literal);
    }
    return result;
  } catch {return {};}
}
function privateJsonText(path,limit) {
  const before=safePath(path,'file',limit),bytes=readFileSync(path),after=lstatSync(path);
  if(bytes.length!==before.size || before.ino!==after.ino || before.mtimeMs!==after.mtimeMs)throw Error('CHANGED');
  return bytes.toString('utf8');
}
export function candidates({home=homedir(),cwd=process.cwd(),env=process.env}={}) {
  const known=[
    ['mac-persistent-state',join(home,'.goriq','state','jarvis.db')],
    ['mac-current-repo-default',join(cwd,'.jarvis','jarvis.db')],
    ['mac-canonical-repo-default',join(home,'JARVIS-AI-','.jarvis','jarvis.db')],
    ['mac-application-support',join(home,'Library','Application Support','JARVIS','jarvis.db')],
    ['mac-gai-worker',join(home,'Library','Application Support','GAIWorker','jarvis.db')],
  ];
  const ownerConfig=ownerFileConfiguredPaths(home);
  if(typeof ownerConfig.JARVIS_DB_PATH==='string')known.unshift(['owner-config-file',ownerConfig.JARVIS_DB_PATH]);
  if(typeof env.GORIQ_DB_CONFIGURED_PATH==='string' && isAbsolute(env.GORIQ_DB_CONFIGURED_PATH))known.unshift(['configured-production',resolve(env.GORIQ_DB_CONFIGURED_PATH)]);
  if(typeof env.JARVIS_DB_PATH==='string' && isAbsolute(env.JARVIS_DB_PATH))known.unshift(['configured-broker',resolve(env.JARVIS_DB_PATH)]);
  const unique=new Set();
  return known.filter(([,path])=>{if(!within(home,path)||unique.has(path))return false;unique.add(path);return true;}).map(([label,brokerPath])=>({label,brokerPath,
    compassPath:label==='configured-broker' && typeof env.JARVIS_COMPASS_DB_PATH==='string' && isAbsolute(env.JARVIS_COMPASS_DB_PATH)
      ? resolve(env.JARVIS_COMPASS_DB_PATH) :
      label==='owner-config-file' && typeof ownerConfig.JARVIS_COMPASS_DB_PATH==='string'
      ? ownerConfig.JARVIS_COMPASS_DB_PATH :
      (label==='mac-current-repo-default'||label==='mac-canonical-repo-default')
      ? join(dirname(brokerPath),'compass.db') : brokerPath+'.compass.sqlite'}));
}
export async function scan({home=homedir(),cwd=process.cwd(),env=process.env,goalId=GOAL,jobId=JOB}={}) {
  const started=Date.now();
  if(process.platform==='win32'||ownerUid===null)return {status:'UNSUPPORTED_PLATFORM',readOnly:true,productionGoalRecovered:false};
  const rows=[];
  for(const entry of candidates({home,cwd,env}))rows.push(await inspectCandidate({...entry,home,goalId,jobId,budgetUntil:started+110000}));
  return {status:'OBSERVATION_ONLY',readOnly:true,productionGoalRecovered:false,goalSelected:true,
    checkedCandidates:rows.length,managedGenerationsChecked:rows.reduce((n,x)=>n+x.backupsChecked,0),
    matchingGoalBackups:rows.reduce((n,x)=>n+x.backupGoalMatches,0),
    matchingWorkRuns:rows.reduce((n,x)=>n+x.backupWorkRunMatches,0),candidates:rows};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
  scan().then(x=>process.stdout.write('GORIQ_G1_BACKUP_INVENTORY='+JSON.stringify(x)+'\n'))
    .catch(()=>{process.stdout.write('GORIQ_G1_BACKUP_INVENTORY={"status":"INSPECTION_UNAVAILABLE","readOnly":true,"productionGoalRecovered":false}\n');process.exitCode=2;});
}
