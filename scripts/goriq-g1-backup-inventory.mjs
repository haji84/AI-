// Read-only, bounded G1 recovery inventory. Never exports Goal/Job contents,
// filesystem paths, credential values, SQLite bytes or backup payloads.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
const MAX_HISTORY_ROWS = 100;
const MAX_JSON_NODES = 10000;
const STATES = new Set(['QUEUED','PLANNING','RUNNING','VERIFYING','RECOVERING','HUMAN_GATE','BLOCKED','COMPLETED','FAILED']);
const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function within(root,path) {
  const delta = relative(root,path);
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..'+sep));
}
// Only locally created refusals can supply detail. External error messages or
// similarly named properties never become diagnostic reasons or source roles.
const pathRefusals=new WeakMap();
function refusePath(reason,role) {
  const error=new Error('UNSAFE_PATH');
  pathRefusals.set(error,{reason,role});
  throw error;
}
function safePath(path,kind,maxBytes=MAX_JSON_BYTES,allowEmpty=false,role='PATH') {
  const st=lstatSync(path);
  // Preserve the original short-circuit order and every refusal condition.
  if(ownerUid===null)refusePath('OWNER_UNAVAILABLE',role);
  if(st.uid!==ownerUid)refusePath('OWNER_MISMATCH',role);
  if(st.isSymbolicLink())refusePath('SYMLINK',role);
  if(kind==='directory') {
    if(!st.isDirectory())refusePath('WRONG_KIND',role);
    if((st.mode&0o077)!==0)refusePath('NONPRIVATE_PERMISSIONS',role);
  }else {
    if(!st.isFile())refusePath('WRONG_KIND',role);
    if(st.nlink!==1)refusePath('LINK_COUNT',role);
    if((st.mode&0o077)!==0)refusePath('NONPRIVATE_PERMISSIONS',role);
    if(st.size<(allowEmpty?0:1))refusePath('EMPTY_FILE',role);
    if(st.size>maxBytes)refusePath('OVERSIZED_FILE',role);
  }
  if(realpathSync(path)!==path)refusePath('PATH_ALIAS',role);
  return st;
}
function privateJson(path,limit=MAX_JSON_BYTES) {
  const before=safePath(path,'file',limit);
  const raw=readFileSync(path);
  const after=lstatSync(path);
  if(raw.length!==before.size || before.ino!==after.ino || before.mtimeMs!==after.mtimeMs)throw Error('CHANGED');
  return JSON.parse(raw.toString('utf8'));
}
function diagnosticReason(error) {
  if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return 'MISSING';
  if(error?.code==='EACCES'||error?.code==='EPERM')return 'ACCESS_DENIED';
  if(error?.message==='UNSAFE_PATH'||error?.message==='CHANGED'||error?.message==='BUDGET_EXHAUSTED'||error?.message==='JOURNAL_PRESENT')return error.message;
  if(error instanceof SyntaxError)return 'INVALID_JSON';
  return 'UNAVAILABLE_OR_INVALID';
}
function checkBudget(budgetUntil) {
  if(Date.now()>budgetUntil)throw Error('BUDGET_EXHAUSTED');
}
function columnsOf(db,table) {
  return new Set(db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name));
}
function inspectCurrentCompass(db,tables,goalId) {
  if(!tables.has('goal')||!tables.has('state'))return {status:'SCHEMA_UNCONFIRMED'};
  const columns=columnsOf(db,'state'), goalColumns=columnsOf(db,'goal');
  if(!columns.has('active')||!columns.has('project_id')||!['id','title','description'].every(x=>goalColumns.has(x)))
    return {status:'SCHEMA_UNCONFIRMED'};
  const goalBytes=db.prepare('SELECT length(CAST(title AS BLOB))+length(CAST(description AS BLOB)) AS n FROM goal WHERE id=1').get()?.n;
  if(goalBytes!==undefined && (!Number.isSafeInteger(goalBytes)||goalBytes>MAX_ACTIVE_BYTES))return {status:'GOAL_BYTE_LIMIT'};
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
}
// Only structured goalId/jobId properties are discovery leads. Human prose,
// partial IDs and coincidental string values never establish record identity.
function exactIdentifiers(text,goalId,jobId,budgetUntil) {
  const value=JSON.parse(text), stack=[[value,0]];
  let nodes=0,goal=false,job=false;
  while(stack.length) {
    checkBudget(budgetUntil);
    const [item,depth]=stack.pop();
    if(++nodes>MAX_JSON_NODES||depth>32)throw Error('JSON_STRUCTURE_LIMIT');
    if(!item||typeof item!=='object')continue;
    if(!Array.isArray(item)) {
      if(item.goalId===goalId)goal=true;
      if(item.jobId===jobId)job=true;
    }
    for(const child of Object.values(item))stack.push([child,depth+1]);
  }
  return {goal,job};
}
function inspectHistoricalTable(db,tables,table,goalId,jobId,budgetUntil) {
  const result={status:'READONLY_SQLITE',rowsChecked:0,goalMatches:0,jobMatches:0,invalidRecords:0};
  try {
    checkBudget(budgetUntil);
    if(!tables.has(table))return {...result,status:'TABLE_UNAVAILABLE'};
    const columns=columnsOf(db,table);
    // These are the JSON columns written by CompassStore. summary, next_action,
    // task_status and other arbitrary text are deliberately never searched.
    const fields=(table==='verification'?['evidence']:table==='state'?['active','completed','blockers','decisions','deliverables']:['completed','blockers','decisions','deliverables'])
      .filter(x=>columns.has(x));
    if(!fields.length || !columns.has(table==='state'?'project_id':'id'))return {...result,status:'SCHEMA_UNCONFIRMED'};
    const select=fields.join(','),where=table==='state'?" WHERE project_id='default'":'';
    const limit=table==='state'?2:MAX_HISTORY_ROWS+1;
    const query='SELECT '+select+' FROM '+table+where+(table==='state'?'':' ORDER BY id DESC')+' LIMIT '+limit;
    const lengths=fields.map(x=>'coalesce(length(CAST('+x+' AS BLOB)),0)').join('+');
    const sizes=db.prepare('SELECT '+lengths+' AS n FROM ('+query+')').all();
    if(sizes.length>(table==='state'?1:MAX_HISTORY_ROWS))return {...result,status:'ROW_LIMIT'};
    if(sizes.some(x=>!Number.isSafeInteger(x.n))||sizes.reduce((sum,x)=>sum+x.n,0)>MAX_ACTIVE_BYTES)
      return {...result,status:'BYTE_LIMIT'};
    for(const row of db.prepare(query).all()) {
      checkBudget(budgetUntil);
      let goal=false,job=false,invalid=false;
      for(const field of fields) {
        if(row[field]===null)continue;
        try {
          const found=exactIdentifiers(row[field],goalId,jobId,budgetUntil);
          goal ||= found.goal;job ||= found.job;
        }catch(error) {
          if(error?.message==='BUDGET_EXHAUSTED')throw error;
          invalid=true;
        }
      }
      result.rowsChecked++;
      if(goal)result.goalMatches++;
      if(job)result.jobMatches++;
      if(invalid)result.invalidRecords++;
    }
    return result;
  }catch(error){return {...result,status:diagnosticReason(error)};}
}
// Even SQLite readOnly connections can change a live WAL -shm read mark.
// Observe only a bounded private copy; source files are never opened by SQLite.
function copyCompassSnapshot(path,budgetUntil) {
  if(existsSync(path+'-journal'))throw Error('JOURNAL_PRESENT');
  const paths=[path,...(existsSync(path+'-wal')?[path+'-wal']:[])];
  const before=paths.map((source,index)=>safePath(source,'file',MAX_DB_BYTES,index===1,index===1?'ACTIVE_COMPASS_WAL':'ACTIVE_COMPASS'));
  const bytes=paths.map(source=>{checkBudget(budgetUntil);return readFileSync(source);});
  for(let i=0;i<paths.length;i++) {
    const after=safePath(paths[i],'file',MAX_DB_BYTES,i===1,i===1?'ACTIVE_COMPASS_WAL':'ACTIVE_COMPASS'),prior=before[i];
    if(bytes[i].length!==prior.size || ['dev','ino','size','mtimeMs','ctimeMs','uid','mode','nlink'].some(key=>after[key]!==prior[key]))throw Error('CHANGED');
  }
  if(existsSync(path+'-wal')!==(paths.length===2)||existsSync(path+'-journal'))throw Error('CHANGED');
  checkBudget(budgetUntil);
  return privateCompassSnapshot(bytes);
}
function privateCompassSnapshot(bytes) {
  const directory=mkdtempSync(join(tmpdir(),'goriq-g1-readonly-'));
  try {
    const snapshot=join(directory,'compass.db');
    for(let i=0;i<bytes.length;i++)writeFileSync(snapshot+(i===1?'-wal':''),bytes[i],{flag:'wx',mode:0o600});
    return {directory,snapshot};
  }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
function inspectCompass(path,goalId,jobId,budgetUntil) {
  let db,copy;
  try {
    checkBudget(budgetUntil);
    copy=copyCompassSnapshot(path,budgetUntil);
    db=new DatabaseSync(copy.snapshot,{readOnly:true});
    db.exec('PRAGMA query_only=ON; BEGIN');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goal','state','history','verification')").all().map(x=>x.name));
    let current;
    try {current=inspectCurrentCompass(db,tables,goalId);}catch(error){current={status:diagnosticReason(error)};}
    const historicalLeads={evidenceClass:'HISTORICAL_LEADS_ONLY',authenticatedOriginal:false};
    for(const table of ['state','history','verification'])
      historicalLeads[table]=inspectHistoricalTable(db,tables,table,goalId,jobId,budgetUntil);
    return {current,historicalLeads};
  } catch(error) {return {current:{status:diagnosticReason(error)},historicalLeads:null,refusal:pathRefusals.get(error)};}
  finally {
    try{if(db?.isTransaction)db.exec('ROLLBACK');}catch{}
    try{db?.close();}catch{}
    if(copy)rmSync(copy.directory,{recursive:true,force:true});
  }
}
function inspectSidecars(compassPath,goalId,jobId,budgetUntil) {
  const base=join(dirname(compassPath),'self-development');
  let jobs={status:'UNAVAILABLE'}, changes={status:'UNAVAILABLE'};
  const diagnostics={jobs:'SCHEMA_UNCONFIRMED',changes:'SCHEMA_UNCONFIRMED'};
  try {
    checkBudget(budgetUntil);
    const j=privateJson(join(base,'jobs.json'));
    if(j?.version===1 && Array.isArray(j.jobs) && j.jobs.length<=2000) {
      const matched=j.jobs.filter(x=>x?.jobId===jobId && x?.goalId===goalId);
      jobs={status:'READONLY_JSON',matches:matched.length,attempts:matched.reduce((sum,x)=>sum+(Array.isArray(x.attempts)?x.attempts.length:0),0),
        transitions:matched.reduce((sum,x)=>sum+(Array.isArray(x.history)?x.history.length:0),0)};
      diagnostics.jobs='READONLY_JSON';
    }
  }catch(error){diagnostics.jobs=diagnosticReason(error);}
  try {
    checkBudget(budgetUntil);
    const c=privateJson(join(base,'change-sets.json'));
    if(c?.version===1 && Array.isArray(c.changeSets) && c.changeSets.length<=2000) {
      const matched=c.changeSets.filter(x=>x?.jobId===jobId);
      changes={status:'READONLY_JSON',matches:matched.length,rejected:matched.filter(x=>x?.status==='REJECTED').length};
      diagnostics.changes='READONLY_JSON';
    }
  }catch(error){diagnostics.changes=diagnosticReason(error);}
  return {jobs,changes,diagnostics};
}
async function verifyGeneration(directory,id,budgetUntil,goalId) {
  checkBudget(budgetUntil);
  safePath(directory,'directory');
  const metadata=privateJson(join(directory,'generation.json'),8192);
  if(metadata?.id!==id || metadata.status!=='ready' || metadata.activationAuthorized!==false ||
     !Array.isArray(metadata.stores)||metadata.stores.length!==2 ||
     metadata.stores[0]?.store!=='broker'||metadata.stores[1]?.store!=='compass')throw Error('GENERATION_INVALID');
  const stores=metadata.stores;
  let summary;
  for (const entry of stores) {
    if(!HASH.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes<1 || entry.sizeBytes>MAX_DB_BYTES)throw Error('CATALOG_INVALID');
    const path=join(directory,entry.store+'.sqlite');
    if(['-wal','-shm','-journal'].some(suffix=>existsSync(path+suffix)))throw Error('GENERATION_SIDECAR_UNVERIFIED');
    checkBudget(budgetUntil);
    const stat=safePath(path,'file',MAX_DB_BYTES);
    if(stat.size!==entry.sizeBytes)throw Error('SIZE_MISMATCH');
    const manifest=privateJson(path+'.manifest.json',8192);
    if(manifest.formatVersion!==1||manifest.databaseFile!==entry.store+'.sqlite'||manifest.sha256!==entry.sha256||
       manifest.sizeBytes!==entry.sizeBytes||manifest.generationId!==id||manifest.quickCheck!=='ok')throw Error('MANIFEST_INVALID');
    const before=lstatSync(path), bytes=readFileSync(path), after=lstatSync(path);
    if(bytes.length!==before.size||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||sha256(bytes)!==entry.sha256)throw Error('DIGEST_MISMATCH');
    let db,copy;
    try {
      // Inspect exactly the manifest-verified bytes. A later source replacement
      // or unmanifested WAL must never enter the verified generation summary.
      copy=privateCompassSnapshot([bytes]);
      db=new DatabaseSync(copy.snapshot,{readOnly:true});db.exec('PRAGMA query_only=ON; BEGIN');
      if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('QUICK_CHECK_FAILED');
      if(entry.store==='compass') {
        checkBudget(budgetUntil);
        const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goal','state')").all().map(x=>x.name));
        try {summary=inspectCurrentCompass(db,tables,goalId);}catch(error){summary={status:diagnosticReason(error)};}
      }
    } finally {
      try{if(db?.isTransaction)db.exec('ROLLBACK');}catch{}
      try{db?.close();}catch{}
      if(copy)rmSync(copy.directory,{recursive:true,force:true});
    }
  }
  return {summary,verified:true};
}
export async function inspectCandidate({label,brokerPath,compassPath,goalId=GOAL,jobId=JOB,home=homedir(),budgetUntil=Date.now()+110000,scanManaged=true,standalone=false}) {
  const result={label,status:'NOT_FOUND',backupsChecked:0,backupsInvalid:0,backupGoalMatches:0,backupWorkRunMatches:0,active:null,sidecars:null,diagnostics:null,historicalLeads:null};
  if(!within(home,brokerPath)||!within(home,compassPath))return {...result,status:'OUTSIDE_HOME_REFUSED'};
  if(Date.now()>budgetUntil)return {...result,status:'BUDGET_EXHAUSTED',diagnostics:{compass:'BUDGET_EXHAUSTED'}};
  const {current,historicalLeads,refusal}=inspectCompass(compassPath,goalId,jobId,budgetUntil);
  if(current.status==='READONLY_SQLITE')result.active=current;
  const {jobs,changes,diagnostics}=inspectSidecars(compassPath,goalId,jobId,budgetUntil);
  result.sidecars={jobs,changes};
  result.diagnostics={compass:current.status,sidecars:diagnostics,...(refusal?{compassRefusal:refusal}:{})};
  result.historicalLeads=historicalLeads;
  if(standalone)return {...result,status:'STANDALONE_COMPASS_ONLY'};
  if(!scanManaged)return {...result,status:'ALTERNATE_COMPASS_ONLY'};
  const root=brokerPath+'.state-backups';
  if(!existsSync(root))return {...result,status:'NO_MANAGED_BACKUP_ROOT'};
  try {
    safePath(root,'directory');
    const entries=readdirSync(root).filter(name=>name!=='.operation.sqlite');
    if(entries.length>MAX_GENERATIONS || entries.some(n=>!UUID.test(n)))return {...result,status:'CATALOG_UNSAFE'};
    for(const id of entries.sort()) {
      if(Date.now()>budgetUntil)return {...result,status:'BUDGET_EXHAUSTED'};
      try {
        const {summary}=await verifyGeneration(join(root,id),id,budgetUntil,goalId);
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
    ['mac-persistent-configured-legacy',join(home,'.goriq','state','jarvis.db')],
    ['mac-current-repo-default',join(cwd,'.jarvis','jarvis.db')],
    ['mac-canonical-repo-default',join(home,'JARVIS-AI-','.jarvis','jarvis.db')],
    ['mac-canonical-repo-configured',join(home,'JARVIS-AI-','.jarvis','jarvis.db')],
    ['mac-application-support',join(home,'Library','Application Support','JARVIS','jarvis.db')],
    ['mac-gai-worker',join(home,'Library','Application Support','GAIWorker','jarvis.db')],
    ['mac-current-standalone-compass',join(cwd,'.jarvis','jarvis.db'),join(cwd,'.compass','compass.db')],
    ['mac-canonical-standalone-compass',join(home,'JARVIS-AI-','.jarvis','jarvis.db'),join(home,'JARVIS-AI-','.compass','compass.db')],
  ];
  const ownerConfig=ownerFileConfiguredPaths(home);
  if(typeof ownerConfig.JARVIS_DB_PATH==='string')known.unshift(['owner-config-file',ownerConfig.JARVIS_DB_PATH]);
  if(typeof env.GORIQ_DB_CONFIGURED_PATH==='string' && isAbsolute(env.GORIQ_DB_CONFIGURED_PATH))known.unshift(['configured-production',resolve(env.GORIQ_DB_CONFIGURED_PATH)]);
  if(typeof env.JARVIS_DB_PATH==='string' && isAbsolute(env.JARVIS_DB_PATH))known.unshift(['configured-broker',resolve(env.JARVIS_DB_PATH)]);
  const unique=new Set();
  return known.map(([label,brokerPath,standalonePath])=>({label,brokerPath,...(standalonePath?{standalone:true}:{}),
    compassPath:standalonePath || (label==='configured-broker' && typeof env.JARVIS_COMPASS_DB_PATH==='string' && isAbsolute(env.JARVIS_COMPASS_DB_PATH)
      ? resolve(env.JARVIS_COMPASS_DB_PATH) :
      label==='owner-config-file' && typeof ownerConfig.JARVIS_COMPASS_DB_PATH==='string'
      ? ownerConfig.JARVIS_COMPASS_DB_PATH :
      ['mac-persistent-state','mac-current-repo-default','mac-canonical-repo-default'].includes(label)
      ? join(dirname(brokerPath),'compass.db') : brokerPath+'.compass.sqlite')}))
    .filter(({brokerPath,compassPath})=>{
      const key=brokerPath+'\0'+compassPath;
      if(!within(home,brokerPath)||!within(home,compassPath)||unique.has(key))return false;
      unique.add(key);return true;
    });
}
export async function scan({home=homedir(),cwd=process.cwd(),env=process.env,goalId=GOAL,jobId=JOB}={}) {
  const started=Date.now();
  if(process.platform==='win32'||ownerUid===null)return {status:'UNSUPPORTED_PLATFORM',readOnly:true,productionGoalRecovered:false};
  const rows=[], scannedRoots=new Set();
  for(const entry of candidates({home,cwd,env})) {
    const scanManaged=!entry.standalone&&!scannedRoots.has(entry.brokerPath);
    if(!entry.standalone)scannedRoots.add(entry.brokerPath);
    rows.push(await inspectCandidate({...entry,home,goalId,jobId,budgetUntil:started+110000,scanManaged}));
  }
  return {status:'OBSERVATION_ONLY',readOnly:true,productionGoalRecovered:false,goalSelected:true,
    checkedCandidates:rows.length,managedGenerationsChecked:rows.reduce((n,x)=>n+x.backupsChecked,0),
    matchingGoalBackups:rows.reduce((n,x)=>n+x.backupGoalMatches,0),
    matchingWorkRuns:rows.reduce((n,x)=>n+x.backupWorkRunMatches,0),candidates:rows};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
  scan().then(x=>process.stdout.write('GORIQ_G1_BACKUP_INVENTORY='+JSON.stringify(x)+'\n'))
    .catch(()=>{process.stdout.write('GORIQ_G1_BACKUP_INVENTORY={"status":"INSPECTION_UNAVAILABLE","readOnly":true,"productionGoalRecovered":false}\n');process.exitCode=2;});
}
