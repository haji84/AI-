import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
const modulePath='../scripts/goriq-zbook-bridge-original-read.mjs';
const reader=existsSync(new URL(modulePath,import.meta.url))?await import(modulePath):{};
const title='Fixture private Goal',description='PRIVATE_GOAL_CONTRACT';
const goalId='goal-'+createHash('sha256').update(JSON.stringify({title,description})).digest('hex').slice(0,16);
const jobId='rotation-recovery-37',privateText='PRIVATE_STOP_APPROVAL_PAYLOAD';
function fixture(t,{active=[],status='PAUSED',jobs=true,changes=true,wal=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'bridge-reader-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const dir of ['source','raw','work'])mkdirSync(join(root,dir));
 const source=join(root,'source','compass.sqlite'),db=new DatabaseSync(source);
 if(wal)db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
 db.exec('CREATE TABLE goal(id INTEGER,title TEXT,description TEXT,success_criteria TEXT,constraints TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE state(project_id TEXT,status TEXT,active TEXT,blockers TEXT,completed TEXT,decisions TEXT,deliverables TEXT,phase TEXT,verification_summary TEXT,next_action TEXT,updated_at TEXT);CREATE TABLE history(id INTEGER,completed TEXT,blockers TEXT,decisions TEXT,deliverables TEXT);CREATE TABLE verification(id INTEGER,evidence TEXT)');
 db.prepare("INSERT INTO goal(id,title,description,success_criteria,constraints,created_at,updated_at) VALUES (1,?,?,?,?,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')").run(title,description,JSON.stringify([privateText]),'[]');
 db.prepare('INSERT INTO state(project_id,status,active,blockers,completed,decisions,deliverables) VALUES (?,?,?,?,?,?,?)').run('default',status,JSON.stringify(active),JSON.stringify([privateText]),'[]','[]','[]');
 db.prepare('INSERT INTO history VALUES (1,?,?,?,?)').run(JSON.stringify([{goalId,jobId}]),'[]','[]','[]');
 db.prepare('INSERT INTO verification VALUES (1,?)').run(JSON.stringify([{goalId,jobId}]));
 const originalFiles=[source,...(existsSync(source+'-wal')?[source+'-wal']:[])];
 for(const path of originalFiles)for(const dir of ['raw','work'])copyFileSync(path,join(root,dir,path.endsWith('-wal')?'compass.sqlite-wal':'compass.sqlite'));
 if(wal)t.after(()=>db.close());else db.close();
 const job={version:1,jobId,goalId,phase:'HUMAN_GATE',approvalScope:{taskScopeId:privateText,maxRisk:'high',expiresAt:'2020-01-01T00:00:00Z'},attempts:[{signature:privateText,strategyId:'private-strategy',hypothesis:privateText,recordedAt:'2020-01-01T00:00:00Z'}],history:[{transitionId:'a',to:'HUMAN_GATE',reason:privateText}],blockers:[privateText]};
 if(jobs)writeFileSync(join(root,'work','jobs.json'),JSON.stringify({version:1,jobs:[job]}));
 if(changes)writeFileSync(join(root,'work','change-sets.json'),JSON.stringify({version:1,changeSets:[{version:1,jobId,changeSetId:'a',status:'REJECTED',rollback:{reference:privateText}}]}));
 return {root,source,db:wal?db:null,job,originalFiles,query:()=>reader.inspectWorkingBundle(root,{goalId,jobId})};
}
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
test('fixed bridge copied-state reader exists',()=>assert.equal(typeof reader.inspectWorkingBundle,'function'));
test('real SQLite query opens working copy only, keeps original and frozen raw bytes unchanged, retains controls privately',t=>{
 const f=fixture(t,{active:[{kind:'jarvis-work-runs',version:1,runs:[{goalId,phase:'HUMAN_GATE',blockers:[privateText]}]},{kind:'gai-work-state',version:1,goalId,state:{goalId,blockers:[privateText]},events:[]}]});
 const paths=[...f.originalFiles,join(f.root,'raw','compass.sqlite')],before=paths.map(digest);
 const r=f.query();assert.equal(r.public.status,'COPIED_STATE_READ');assert.equal(r.public.currentGoalMatches,true);assert.equal(r.public.jobMatches,1);assert.equal(r.public.attemptCount,1);assert.equal(r.public.changeSetMatches,1);assert.equal(r.public.paused,true);assert.equal(r.public.workRunPhase,'HUMAN_GATE');assert.equal(r.public.originalGoalRecovered,false);assert.equal(r.public.g1,'HOLD');
 assert.equal(r.private.state.status,'PAUSED');assert.equal(r.private.jobs[0].approvalScope.expiresAt,'2020-01-01T00:00:00Z');assert.deepEqual(paths.map(digest),before);
 for(const s of [title,description,privateText,f.root,goalId,jobId])assert.ok(!JSON.stringify(r.public).includes(s));
});
test('committed WAL content is read from the second copy without changing frozen WAL bytes',t=>{
 const f=fixture(t,{wal:true});const raw=join(f.root,'raw','compass.sqlite-wal'),before=digest(raw);
 assert.equal(f.query().public.currentGoalMatches,true);assert.equal(digest(raw),before);
});
test('current mismatch still reports structured historical leads, never prose identity',t=>{
 const f=fixture(t);const db=new DatabaseSync(join(f.root,'work','compass.sqlite'));db.prepare('UPDATE goal SET title=?').run('other');db.prepare('INSERT INTO history VALUES (2,?,?,?,?)').run(JSON.stringify([`prose ${goalId} ${jobId}`]),'[]','[]','[]');db.close();
 const r=f.query().public;assert.equal(r.currentGoalMatches,false);assert.equal(r.historicalGoalRows,2);assert.equal(r.historicalJobRows,2);assert.equal(r.originalGoalRecovered,false);
});
for(const [name,change] of [
 ['duplicate workrun',a=>a.push({kind:'jarvis-work-runs',version:1,runs:[]},{kind:'jarvis-work-runs',version:1,runs:[]})],
 ['invalid envelope version',a=>a.push({kind:'goriq-goal-execution-context',version:2,records:[]})],
 ['inconsistent workstate Goal',a=>a.push({kind:'gai-work-state',version:1,goalId,state:{goalId:'other'},events:[]})],
 ['duplicate selected runs',a=>a.push({kind:'jarvis-work-runs',version:1,runs:[{goalId},{goalId}]})],
 ['excessively deep JSON',a=>{let v={};a.push(v);for(let i=0;i<34;i++){v.next={};v=v.next;}}],
])test(name+' returns fixed incomplete without leaking raw records',t=>{const a=[];change(a);const r=fixture(t,{active:a}).query();assert.equal(r.public.status,'INCOMPLETE');assert.equal(r.public.queryVerified,false);assert.doesNotMatch(JSON.stringify(r.public),/PRIVATE/);});
test('duplicate job or mismatched Goal linkage is ambiguous rather than a valid match',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'work','jobs.json'),JSON.stringify({version:1,jobs:[f.job,{...f.job,goalId:'other'}]}));
 const r=f.query().public;assert.equal(r.status,'INCOMPLETE');assert.equal(r.jobMatches,null);
});
test('missing sidecars stay missing with null counts and incomplete correlation',t=>{
 const r=fixture(t,{jobs:false,changes:false}).query().public;assert.equal(r.status,'COPIED_STATE_READ');assert.equal(r.jobsPresent,false);assert.equal(r.jobMatches,null);assert.equal(r.changeSetMatches,null);assert.equal(r.authorityComplete,false);
});
test('malformed SQLite and invalid JSON preserve raw evidence and emit fixed failure only',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'work','compass.sqlite'),'PRIVATE_BAD_DB');const before=digest(join(f.root,'raw','compass.sqlite'));
 const r=f.query().public;assert.equal(r.status,'INCOMPLETE');assert.equal(r.failureCode,'COPIED_QUERY_INVALID');assert.equal(digest(join(f.root,'raw','compass.sqlite')),before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|bridge-reader/);
});
test('JSON byte and historical row caps refuse incomplete rather than absence',t=>{
 const f=fixture(t);const db=new DatabaseSync(join(f.root,'work','compass.sqlite'));for(let i=2;i<103;i++)db.prepare('INSERT INTO history VALUES (?, ?,?,?,?)').run(i,'[]','[]','[]','[]');db.close();assert.equal(f.query().public.status,'INCOMPLETE');
});
test('no original or frozen path is accepted by copied-state query entry',t=>{
 const f=fixture(t);rmSync(join(f.root,'work'),{recursive:true});assert.equal(f.query().public.status,'INCOMPLETE');assert.equal(digest(f.source),digest(join(f.root,'raw','compass.sqlite')));
});
test('workflow has a separate false-default action-free fixed reader mode and keeps native locator pinned',()=>{
 const w=readFileSync('.github/workflows/goriq-pc-private-network-probe.yml','utf8');assert.match(w,/zbook_bridge_original_only:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
 assert.match(w,/GORIQ_ZBOOK_BRIDGE_ORIGINAL_ONLY/);assert.match(w,/goriq-zbook-bridge-original-read.ps1/);assert.match(w,/goriq-zbook-bridge-original-read.mjs/);
 assert.match(w,/a7ca4f50c60a6da54feab92f14f50308899858ff7e932b85d6eb971707748590/);
 const job=w.split('\n  zbook_bridge_original:')[1]?.split('\n  zbook_native:')[0];assert.ok(job);assert.doesNotMatch(job,/uses:|checkout|setup-node|upload-artifact/);assert.match(job,/timeout-minutes: 3/);
});
test('original Goal criteria, constraints and unresolved raw lineage remain private without synthesized provenance',t=>{
 const f=fixture(t);const r=f.query();assert.equal(JSON.parse(r.private.goal.success_criteria)[0],privateText);assert.equal(r.private.changeSets[0].artifactDigest,undefined);assert.equal(r.private.unresolvedExternalReferences[0].artifactRef,null);assert.equal(r.public.authorityComplete,false);
});
for(const [label,value] of [['invalid jobs JSON','PRIVATE_INVALID_JSON'],['invalid jobs version',JSON.stringify({version:2,jobs:[]})],['oversized jobs',JSON.stringify({version:1,jobs:[],text:'x'.repeat(4*1024*1024)})]])test(label+' is a fixed incomplete result',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'work','jobs.json'),value);const r=f.query().public;assert.equal(r.status,'INCOMPLETE');assert.equal(r.jobMatches,null);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('duplicate raw ChangeSet IDs refuse correlation',t=>{
 const f=fixture(t);writeFileSync(join(f.root,'work','change-sets.json'),JSON.stringify({version:1,changeSets:[{version:1,changeSetId:'a',jobId},{version:1,changeSetId:'a',jobId}]}));assert.equal(f.query().public.status,'INCOMPLETE');
});
test('real working-sidecar hardlink aliases are refused before reading JSON',async t=>{
 const f=fixture(t);const {linkSync}=await import('node:fs');linkSync(join(f.root,'work','jobs.json'),join(f.root,'alias.json'));assert.equal(f.query().public.status,'INCOMPLETE');
});
test('real working-directory symlink aliases are refused without opening frozen SQLite',async t=>{
 const f=fixture(t);const {symlinkSync}=await import('node:fs');rmSync(join(f.root,'work'),{recursive:true});symlinkSync(join(f.root,'raw'),join(f.root,'work'),'junction');const before=digest(join(f.root,'raw','compass.sqlite'));assert.equal(f.query().public.status,'INCOMPLETE');assert.equal(digest(join(f.root,'raw','compass.sqlite')),before);
});
for(const [name,mutate] of [
 ['duplicate transition identity',j=>{j.history=[{transitionId:'same'},{transitionId:'same'}];}],
 ['invalid attempt record',j=>{j.attempts=[privateText];}],
 ['numeric approval expiry',j=>{j.approvalScope.expiresAt=1;}],
])test(name+' cannot become a verified Job correlation',t=>{
 const f=fixture(t);mutate(f.job);writeFileSync(join(f.root,'work','jobs.json'),JSON.stringify({version:1,jobs:[f.job]}));assert.equal(f.query().public.status,'INCOMPLETE');
});
test('standalone runtime accepts installed Node readOnly SQLite API versions without requiring repository engine24.19',()=>{
 assert.equal(typeof reader.supportsReadOnlySqlite,'function');
 for(const version of ['22.12.0','22.16.0','23.2.0','24.0.0','24.19.0','25.0.0'])assert.equal(reader.supportsReadOnlySqlite(version),true,version);
 for(const version of ['20.19.0','22.5.0','22.11.9','23.0.0','23.1.0','unverified'])assert.equal(reader.supportsReadOnlySqlite(version),false,version);
});

test('missing original raw stop and Goal contract fields are incomplete with null control flags',t=>{
 const f=fixture(t);const path=join(f.root,'work','compass.sqlite');rmSync(path);const db=new DatabaseSync(path);db.exec("CREATE TABLE goal(id INTEGER,title TEXT,description TEXT);CREATE TABLE state(project_id TEXT,active TEXT);INSERT INTO goal VALUES(1,'x','y');INSERT INTO state VALUES('default','[]')");db.close();const r=f.query().public;assert.equal(r.status,'INCOMPLETE');assert.equal(r.queryVerified,false);assert.equal(r.paused,null);assert.equal(r.blockerCount,null);
});
test('legitimate nullable initial status is retained as unknown rather than a false stop flag',t=>{
 const f=fixture(t,{status:null});const r=f.query();assert.equal(r.public.status,'COPIED_STATE_READ');assert.equal(r.public.paused,null);assert.equal(r.private.state.status,null);
});
test('actual copied CLI entry emits closed refusal for valid hash and literal-percent path characters',t=>{
 const f=fixture(t);for(const name of ['has#hash','has%20percent']){
  const dir=join(f.root,name);mkdirSync(dir);for(const file of ['goriq-zbook-bridge-original-read.mjs','goriq-g1-backup-inventory.mjs'])copyFileSync(join('scripts',file),join(dir,file));
  const child=spawnSync(process.execPath,[join(dir,'goriq-zbook-bridge-original-read.mjs')],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).originalGoalRecovered,false);
 }
});
