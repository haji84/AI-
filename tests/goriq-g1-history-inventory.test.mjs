import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync, linkSync, truncateSync, lstatSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectCandidate, candidates, scan } from '../scripts/goriq-g1-backup-inventory.mjs';
const goalId='goal-history-fixture', jobId='job-history-fixture';
const secret='PRIVATE_HISTORY_CANARY_NEVER_EMIT';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
 const home=mkdtempSync(join(tmpdir(),'goriq-g1-history-'));chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const brokerPath=join(home,'repo','.jarvis','jarvis.db'),compassPath=join(dirname(brokerPath),'compass.db');
 mkdirSync(dirname(compassPath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(compassPath);
 db.exec(`CREATE TABLE goal (id INTEGER, title TEXT, description TEXT);
 CREATE TABLE state (project_id TEXT, active TEXT, completed TEXT, blockers TEXT, decisions TEXT, deliverables TEXT);
 CREATE TABLE history (id INTEGER PRIMARY KEY, summary TEXT, completed TEXT, blockers TEXT, decisions TEXT, deliverables TEXT);
 CREATE TABLE verification (id INTEGER PRIMARY KEY, summary TEXT, evidence TEXT);`);
 db.prepare('INSERT INTO state VALUES (?,?,?,?,?,?)').run('default','[]','[]','[]','[]','[]');
 db.close();chmodSync(compassPath,0o600);
 return {home,brokerPath,compassPath};
}
const inspect=f=>inspectCandidate({...f,label:'fixture',goalId,jobId});
function update(f,action) {const db=new DatabaseSync(f.compassPath);try{action(db);}finally{db.close();}}

test('Compass diagnostics distinguish missing, unsafe, invalid SQLite and absent state without exposing source paths',async t=>{
 const f=fixture(t);
 update(f,db=>db.exec('DELETE FROM state'));
 assert.equal((await inspect(f)).diagnostics?.compass,'STATE_UNAVAILABLE');
 rmSync(f.compassPath);
 assert.equal((await inspect(f)).diagnostics?.compass,'MISSING');
 writeFileSync(f.compassPath,secret,{mode:0o600});
 assert.equal((await inspect(f)).diagnostics?.compass,'UNAVAILABLE_OR_INVALID');
 chmodSync(f.compassPath,0o644);
 const unsafe=await inspect(f);
 assert.equal(unsafe.diagnostics?.compass,'UNSAFE_PATH');
 for(const value of [secret,f.home,f.compassPath])assert.ok(!JSON.stringify(unsafe).includes(value));
});

test('sidecar diagnostics distinguish absent files, invalid JSON, unsupported schema and unsafe symlinks',async t=>{
 const f=fixture(t),base=join(dirname(f.compassPath),'self-development');
 assert.deepEqual((await inspect(f)).diagnostics?.sidecars,{jobs:'MISSING',changes:'MISSING'});
 mkdirSync(base,{mode:0o700});
 writeFileSync(join(base,'jobs.json'),'{private invalid',{mode:0o600});
 writeFileSync(join(base,'change-sets.json'),JSON.stringify({version:2,changeSets:[]}),{mode:0o600});
 assert.deepEqual((await inspect(f)).diagnostics?.sidecars,{jobs:'INVALID_JSON',changes:'SCHEMA_UNCONFIRMED'});
 rmSync(join(base,'jobs.json'));symlinkSync(f.compassPath,join(base,'jobs.json'));
 assert.equal((await inspect(f)).diagnostics.sidecars.jobs,'UNSAFE_PATH');
});

test('historical discovery counts exact structured IDs across real Compass columns but never free-text mentions',async t=>{
 const f=fixture(t);
 update(f,db=>{
  db.prepare("UPDATE state SET completed=?, decisions=?, deliverables=? WHERE project_id='default'")
   .run(JSON.stringify([{goalId,private:secret}]),JSON.stringify([{nested:{jobId}}]),JSON.stringify([{goalId:goalId+'suffix',note:jobId}]));
  db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)').run(1,secret+' '+goalId,'[]','[]',JSON.stringify([{goalId,jobId}]),'[]');
  db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)').run(2,goalId+' '+jobId,JSON.stringify([{goalId:goalId+'suffix'}]),'[]','[]','[]');
  db.prepare('INSERT INTO verification VALUES (?,?,?)').run(1,secret,JSON.stringify({binding:{goalId,jobId},message:secret}));
  db.prepare('INSERT INTO verification VALUES (?,?,?)').run(2,jobId,secret+' '+goalId);
 });
 const before=hash(readFileSync(f.compassPath)),files=readdirSync(dirname(f.compassPath));
 const result=await inspect(f),leads=result.historicalLeads;
 assert.equal(leads?.evidenceClass,'HISTORICAL_LEADS_ONLY');assert.equal(leads?.authenticatedOriginal,false);
 assert.deepEqual(leads?.state,{status:'READONLY_SQLITE',rowsChecked:1,goalMatches:1,jobMatches:1,invalidRecords:0});
 assert.deepEqual(leads?.history,{status:'READONLY_SQLITE',rowsChecked:2,goalMatches:1,jobMatches:1,invalidRecords:0});
 assert.deepEqual(leads?.verification,{status:'READONLY_SQLITE',rowsChecked:2,goalMatches:1,jobMatches:1,invalidRecords:1});
 assert.equal(result.active.goalPresent,false);assert.equal(result.backupGoalMatches,0);
 const summary=JSON.stringify(result);
 for(const value of [secret,f.home,goalId,jobId])assert.ok(!summary.includes(value));
 assert.equal(hash(readFileSync(f.compassPath)),before);assert.deepEqual(readdirSync(dirname(f.compassPath)),files);
});

test('history discovery refuses row overflow instead of reporting a misleading complete zero',async t=>{
 const f=fixture(t);
 update(f,db=>{
  const insert=db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)');
  for(let i=1;i<=101;i++)insert.run(i,secret,'[]','[]','[]','[]');
 });
 assert.deepEqual((await inspect(f)).historicalLeads?.history,{status:'ROW_LIMIT',rowsChecked:0,goalMatches:0,jobMatches:0,invalidRecords:0});
});

test('history discovery bounds JSON bytes and nesting and retains incomplete evidence reasons',async t=>{
 const f=fixture(t);
 update(f,db=>{
  db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)').run(1,secret,'[]','[]',JSON.stringify([{private:'a'.repeat(1048576),goalId}]),'[]');
  db.prepare('INSERT INTO verification VALUES (?,?,?)').run(1,secret,'{"nested":'.repeat(40)+'{"goalId":"'+goalId+'"}'+'}'.repeat(40));
 });
 const result=await inspect(f);
 assert.equal(result.historicalLeads?.history.status,'BYTE_LIMIT');
 assert.deepEqual(result.historicalLeads?.verification,{status:'READONLY_SQLITE',rowsChecked:1,goalMatches:0,jobMatches:0,invalidRecords:1});
});

test('standalone Compass roots reveal retained history without inventing managed backup roots',async t=>{
 const f=fixture(t),cwd=join(f.home,'repo');
 const found=candidates({home:f.home,cwd,env:{}});
 const current=found.find(x=>x.label==='mac-current-standalone-compass');
 const canonical=found.find(x=>x.label==='mac-canonical-standalone-compass');
 assert.equal(current?.compassPath,join(cwd,'.compass','compass.db'));
 assert.equal(canonical?.compassPath,join(f.home,'JARVIS-AI-','.compass','compass.db'));
 mkdirSync(dirname(current.compassPath),{mode:0o700});
 writeFileSync(current.compassPath,readFileSync(f.compassPath),{mode:0o600});
 const result=await scan({home:f.home,cwd,env:{},goalId,jobId});
 const row=result.candidates.find(x=>x.label==='mac-current-standalone-compass');
 assert.equal(row.status,'STANDALONE_COMPASS_ONLY');assert.equal(row.historicalLeads.state.rowsChecked,1);
 assert.equal(result.managedGenerationsChecked,0);assert.equal(result.productionGoalRecovered,false);
 const same=candidates({home:f.home,cwd:join(f.home,'JARVIS-AI-'),env:{}});
 assert.equal(same.filter(x=>x.compassPath===canonical.compassPath).length,1);
});

test('expired discovery budget prevents reading retained history or sidecars',async t=>{
 const f=fixture(t);
 const result=await inspectCandidate({...f,label:'fixture',goalId,jobId,budgetUntil:Date.now()-1});
 assert.equal(result.status,'BUDGET_EXHAUSTED');assert.equal(result.diagnostics?.compass,'BUDGET_EXHAUSTED');
 assert.equal(result.historicalLeads,null);assert.equal(result.active,null);assert.equal(result.sidecars,null);
});

test('history survives an absent current state and ignores other projects and unsupported free-text columns',async t=>{
 const f=fixture(t);
 update(f,db=>{
  db.exec('DELETE FROM state');
  db.prepare('INSERT INTO state VALUES (?,?,?,?,?,?)').run('other',JSON.stringify([{goalId,jobId}]),'[]','[]','[]','[]');
  db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)').run(1,JSON.stringify({goalId,jobId}),'[]','[]',JSON.stringify([{goalId}]),'[]');
 });
 const result=await inspect(f);
 assert.equal(result.active,null);assert.equal(result.diagnostics.compass,'STATE_UNAVAILABLE');
 assert.equal(result.historicalLeads.state.rowsChecked,0);assert.equal(result.historicalLeads.state.goalMatches,0);
 assert.equal(result.historicalLeads.history.goalMatches,1);assert.equal(result.historicalLeads.history.jobMatches,0);
});

test('unsupported historical tables remain explicitly unavailable while valid current observations are retained',async t=>{
 const f=fixture(t);
 update(f,db=>db.exec('DROP TABLE history; DROP TABLE verification; CREATE TABLE verification (id INTEGER, summary TEXT)'));
 const result=await inspect(f);
 assert.equal(result.active.status,'READONLY_SQLITE');
 assert.equal(result.historicalLeads.history.status,'TABLE_UNAVAILABLE');
 assert.equal(result.historicalLeads.verification.status,'SCHEMA_UNCONFIRMED');
});

test('history discovery rejects node floods instead of accepting early exact IDs from incomplete JSON inspection',async t=>{
 const f=fixture(t);
 update(f,db=>db.prepare('INSERT INTO verification VALUES (?,?,?)').run(1,secret,JSON.stringify({goalId,values:Array(10001).fill(null)})));
 const result=await inspect(f);
 assert.deepEqual(result.historicalLeads.verification,{status:'READONLY_SQLITE',rowsChecked:1,goalMatches:0,jobMatches:0,invalidRecords:1});
});

test('symlinked standalone Compass never exposes historical leads from its target',async t=>{
 const f=fixture(t),path=join(dirname(f.compassPath),'alias.db');
 symlinkSync(f.compassPath,path);
 const result=await inspectCandidate({...f,compassPath:path,label:'fixture',goalId,jobId,standalone:true});
 assert.equal(result.diagnostics.compass,'UNSAFE_PATH');assert.equal(result.historicalLeads,null);
});

test('read-only inventory retains WAL files and database bytes while observing committed WAL records',async t=>{
 const f=fixture(t),db=new DatabaseSync(f.compassPath);
 try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  db.prepare('INSERT INTO verification VALUES (?,?,?)').run(1,secret,JSON.stringify({goalId,jobId}));
  for(const suffix of ['','-wal','-shm'])chmodSync(f.compassPath+suffix,0o600);
  const before=['','-wal','-shm'].map(suffix=>hash(readFileSync(f.compassPath+suffix)));
  const files=readdirSync(dirname(f.compassPath));
  const result=await inspect(f);
  assert.equal(result.historicalLeads.verification.goalMatches,1);
  assert.deepEqual(['','-wal','-shm'].map(suffix=>hash(readFileSync(f.compassPath+suffix))),before);
  assert.deepEqual(readdirSync(dirname(f.compassPath)),files);
 }finally{db.close();}
});

test('an empty private WAL sidecar does not hide a valid Compass snapshot',async t=>{
 const f=fixture(t);
 writeFileSync(f.compassPath+'-wal','',{mode:0o600});
 const result=await inspect(f);
 assert.equal(result.diagnostics.compass,'READONLY_SQLITE');
 assert.equal(readFileSync(f.compassPath+'-wal').length,0);
});

test('an outstanding rollback journal is a discovery hold, never an accepted historical snapshot',async t=>{
 const f=fixture(t);
 writeFileSync(f.compassPath+'-journal',secret,{mode:0o600});
 const result=await inspect(f);
 assert.equal(result.diagnostics.compass,'JOURNAL_PRESENT');assert.equal(result.historicalLeads,null);
 assert.equal(readFileSync(f.compassPath+'-journal','utf8'),secret);
});

test('unsafe WAL sidecars cannot be followed during snapshot creation',async t=>{
 const f=fixture(t),target=join(dirname(f.compassPath),'private.txt');
 writeFileSync(target,secret,{mode:0o600});symlinkSync(target,f.compassPath+'-wal');
 const result=await inspect(f);
 assert.equal(result.diagnostics.compass,'UNSAFE_PATH');assert.equal(result.historicalLeads,null);
});


const refusalCases=[
 ['nonprivate permissions','NONPRIVATE_PERMISSIONS',f=>{chmodSync(f.compassPath,0o644);return f.compassPath;}],
 ['link count before permissions','LINK_COUNT',f=>{linkSync(f.compassPath,f.compassPath+'.linked');chmodSync(f.compassPath,0o644);return f.compassPath;}],
 ['leaf symlink','SYMLINK',f=>{const path=f.compassPath+'.alias';symlinkSync(f.compassPath,path);return path;}],
 ['ancestor alias','PATH_ALIAS',f=>{const alias=join(f.home,'alias');symlinkSync(dirname(f.compassPath),alias);return join(alias,'compass.db');}],
 ['wrong file kind before permissions','WRONG_KIND',f=>{rmSync(f.compassPath);mkdirSync(f.compassPath,{mode:0o755});return f.compassPath;}],
 ['empty file','EMPTY_FILE',f=>{truncateSync(f.compassPath,0);return f.compassPath;}],
 ['oversized file','OVERSIZED_FILE',f=>{truncateSync(f.compassPath,64*1024*1024+1);return f.compassPath;}],
];
for(const [name,reason,prepare] of refusalCases)test('unsafe Compass reports first '+name+' refusal without modifying or exposing the source',async t=>{
 const f=fixture(t),path=prepare(f);
 const before=lstatSync(path),beforeHash=before.isFile()?hash(readFileSync(path)):null;
 const result=await inspectCandidate({...f,compassPath:path,label:'fixture',goalId,jobId});
 assert.equal(result.diagnostics.compass,'UNSAFE_PATH');
 assert.deepEqual(result.diagnostics.compassRefusal,{role:'ACTIVE_COMPASS',reason});
 assert.equal(result.active,null);assert.equal(result.historicalLeads,null);
 const after=lstatSync(path);
 assert.equal(after.mode,before.mode);assert.equal(after.ino,before.ino);
 assert.equal(after.isFile()?hash(readFileSync(path)):null,beforeHash);
 for(const value of [secret,f.home,path])assert.ok(!JSON.stringify(result).includes(value));
 assert.equal(Object.hasOwn(result.diagnostics.compassRefusal,'uid'),false);
 assert.equal(Object.hasOwn(result.diagnostics.compassRefusal,'mode'),false);
});

test('unsafe WAL reports its fixed source role rather than blaming the active Compass',async t=>{
 const f=fixture(t),path=f.compassPath+'-wal';
 writeFileSync(path,secret,{mode:0o644});
 const beforeHash=hash(readFileSync(path)),beforeMode=lstatSync(path).mode;
 const result=await inspect(f);
 assert.equal(result.diagnostics.compass,'UNSAFE_PATH');
 assert.deepEqual(result.diagnostics.compassRefusal,{role:'ACTIVE_COMPASS_WAL',reason:'NONPRIVATE_PERMISSIONS'});
 assert.equal(hash(readFileSync(path)),beforeHash);assert.equal(lstatSync(path).mode,beforeMode);
});

for(const [name,getuid,reason] of [
 ['unavailable',undefined,'OWNER_UNAVAILABLE'],
 ['different',()=>processUid+1,'OWNER_MISMATCH'],
])test('unsafe Compass distinguishes '+name+' owner identity before later refusal conditions',async t=>{
 const f=fixture(t),original=process.getuid;
 chmodSync(f.compassPath,0o644);
 let module;
 try {
  process.getuid=getuid;
  module=await import('../scripts/goriq-g1-backup-inventory.mjs?owner-'+name);
 }finally {process.getuid=original;}
 const result=await module.inspectCandidate({...f,label:'fixture',goalId,jobId});
 assert.equal(result.diagnostics.compass,'UNSAFE_PATH');
 assert.deepEqual(result.diagnostics.compassRefusal,{role:'ACTIVE_COMPASS',reason});
});
const processUid=process.getuid();

test('external exceptions cannot spoof fixed path refusal details or expose their payload',async t=>{
 const f=fixture(t),original=fs.readFileSync;
 for(const [message,status] of [['NONPRIVATE_PERMISSIONS '+secret,'UNAVAILABLE_OR_INVALID'],['UNSAFE_PATH','UNSAFE_PATH']]) {
  const external=Object.assign(new Error(message),{role:'ACTIVE_COMPASS_WAL',reason:'OWNER_MISMATCH',privatePayload:secret});
  const read=t.mock.method(fs,'readFileSync',function(path,...args){
   if(path===f.compassPath)throw external;
   return Reflect.apply(original,this,[path,...args]);
  });
  let result;
  try {syncBuiltinESMExports();result=await inspect(f);}
  finally {read.mock.restore();syncBuiltinESMExports();}
  assert.equal(result.diagnostics.compass,status);
  assert.equal(result.diagnostics.compassRefusal,undefined);
  for(const value of [secret,f.home,external.reason])assert.ok(!JSON.stringify(result).includes(value));
 }
 const missing=await inspectCandidate({...f,compassPath:f.compassPath+'.missing',label:'fixture',goalId,jobId});
 assert.equal(missing.diagnostics.compass,'MISSING');assert.equal(missing.diagnostics.compassRefusal,undefined);
 assert.equal((await inspect(f)).diagnostics.compassRefusal,undefined);
});
