import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { inspectCandidate, candidates, scan, ownerFileConfiguredPaths } from '../scripts/goriq-g1-backup-inventory.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const generationId='12345678-1234-4123-8123-123456789abc';
const title='private fixture';
const description='nonpublic canary not to print';
const goalId='goal-'+hash(JSON.stringify({title,description})).slice(0,16);
const jobId='job-test-old';
const secret='DO_NOT_EMIT_HISTORIC_GOAL_PRIVATE_PAYLOAD';
function jsonFile(path,data) {writeFileSync(path,JSON.stringify(data),'utf8');chmodSync(path,0o600);}
function fixture(t,{backup=true,liveGoal=true,sidecars=true}={}) {
  const home=mkdtempSync(join(tmpdir(),'goriq-g1-backup-fixture-'));
  chmodSync(home,0o700);
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const brokerPath=join(home,'JARVIS-AI-','.jarvis','jarvis.db');
  const compassPath=brokerPath+'.compass.sqlite';
  mkdirSync(dirname(brokerPath),{recursive:true,mode:0o700});chmodSync(dirname(brokerPath),0o700);
  {
   const broker=new DatabaseSync(brokerPath);broker.exec('CREATE TABLE jarvis_state (id INTEGER, payload TEXT)');broker.prepare('INSERT INTO jarvis_state VALUES (1,?)').run(secret);broker.close();chmodSync(brokerPath,0o600);
   const db=new DatabaseSync(compassPath);db.exec('CREATE TABLE goal (id INTEGER, title TEXT, description TEXT);CREATE TABLE state (project_id TEXT, active TEXT)');
   if(liveGoal)db.prepare('INSERT INTO goal VALUES (1,?,?)').run(title,description);
   db.prepare('INSERT INTO state VALUES (?,?)').run('default',JSON.stringify([{kind:'jarvis-work-runs',version:1,runs:[{goalId,phase:'RECOVERING',attempts:[secret]}]}]));
   db.close();chmodSync(compassPath,0o600);
  }
  if(sidecars){
   const side=join(dirname(compassPath),'self-development');mkdirSync(side,{mode:0o700});chmodSync(side,0o700);
   jsonFile(join(side,'jobs.json'),{version:1,jobs:[{goalId,jobId,attempts:[{signature:secret}],history:[{to:'RECOVERING',reason:secret}]}]});
   jsonFile(join(side,'change-sets.json'),{version:1,changeSets:[{jobId,changeSetId:'change-1',status:'REJECTED',candidateRevision:secret}]});
  }
  const root=brokerPath+'.state-backups';
  if(backup){
   mkdirSync(root,{mode:0o700});chmodSync(root,0o700);
   const gen=join(root,generationId);mkdirSync(gen,{mode:0o700});chmodSync(gen,0o700);
   const stores=[];
   for(const store of ['broker','compass']){
    const source=store==='broker'?brokerPath:compassPath;
    const path=join(gen,store+'.sqlite');copyFileSync(source,path);chmodSync(path,0o600);
    const bytes=readFileSync(path),sha=hash(bytes), size=bytes.length;
    const meta={store,sha256:sha,sizeBytes:size,pagesTransferred:Math.ceil(size/4096)};
    stores.push(meta);
    jsonFile(path+'.manifest.json',{formatVersion:1,generationId,createdAt:'2026-11-01T00:00:00.000Z',databaseFile:store+'.sqlite',hashAlgorithm:'sha256',sha256:sha,sizeBytes:size,pagesTransferred:meta.pagesTransferred,quickCheck:'ok'});
   }
   jsonFile(join(gen,'generation.json'),{id:generationId,createdAt:'2026-11-01T00:00:00.000Z',status:'ready',stores,activationAuthorized:false});
  }
  return {home,brokerPath,compassPath,root,gen:join(root,generationId)};
}

test('read-only inventory verifies existing backup and counts matched original records without exposing plaintext',async t=>{
 const f=fixture(t);
 const before=[f.brokerPath,f.compassPath,join(f.gen,'compass.sqlite'),join(f.gen,'generation.json')].map(p=>hash(readFileSync(p)));
 const result=await inspectCandidate({label:'fixture',brokerPath:f.brokerPath,compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(result.status,'CATALOG_VERIFIED');assert.equal(result.backupsChecked,1);assert.equal(result.backupGoalMatches,1);assert.equal(result.backupWorkRunMatches,1);
 assert.deepEqual(result.sidecars.jobs,{status:'READONLY_JSON',matches:1,attempts:1,transitions:1});
 assert.deepEqual(result.sidecars.changes,{status:'READONLY_JSON',matches:1,rejected:1});
 assert.deepEqual(result.active,{status:'READONLY_SQLITE',goalPresent:true,goalMatches:true,selectedWorkRuns:1,selectedPhase:'RECOVERING'});
 const summary=JSON.stringify(result);
 for(const s of [secret,title,description,f.home,f.brokerPath,f.compassPath,jobId,goalId])assert.ok(!summary.includes(s));
 assert.deepEqual([f.brokerPath,f.compassPath,join(f.gen,'compass.sqlite'),join(f.gen,'generation.json')].map(p=>hash(readFileSync(p))),before);
});
test('an archived Goal may survive when active Compass is empty',async t=>{
 const f=fixture(t,{liveGoal:true});
 const db=new DatabaseSync(f.compassPath);db.prepare('DELETE FROM goal').run();db.prepare('DELETE FROM state').run();db.close();
 const r=await inspectCandidate({label:'fixture',brokerPath:f.brokerPath,compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(r.active,null); // an empty active DB is not a recovery source
 assert.equal(r.backupGoalMatches,1);
});
test('a missing backup root is not interpreted as deletion of historic Goal',async t=>{
 const f=fixture(t,{backup:false});
 const r=await inspectCandidate({label:'fixture',brokerPath:f.brokerPath,compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(r.status,'NO_MANAGED_BACKUP_ROOT');assert.equal(r.backupsChecked,0);
});
test('tampered backup metadata cannot be counted as a verified match',async t=>{
 const f=fixture(t);
 const p=join(f.gen,'compass.sqlite.manifest.json');const meta=JSON.parse(readFileSync(p));meta.sha256='a'.repeat(64);jsonFile(p,meta);
 const r=await inspectCandidate({label:'fixture',brokerPath:f.brokerPath,compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(r.status,'PARTIAL_CATALOG');assert.equal(r.backupsInvalid,1);assert.equal(r.backupGoalMatches,0);
});
test('symbolic backup files cannot be followed',async t=>{
 const f=fixture(t);
 const p=join(f.gen,'compass.sqlite');rmSync(p);symlinkSync(f.compassPath,p);
 const r=await inspectCandidate({label:'fixture',brokerPath:f.brokerPath,compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(r.backupsInvalid,1);assert.equal(r.backupGoalMatches,0);
});
test('foreign or out-of-home configured path is not read',async t=>{
 const f=fixture(t,{backup:false});const r=await inspectCandidate({label:'fixture',brokerPath:'/etc/passwd',compassPath:f.compassPath,goalId,jobId,home:f.home});
 assert.equal(r.status,'OUTSIDE_HOME_REFUSED');
 const entries=candidates({home:f.home,cwd:f.home,env:{JARVIS_DB_PATH:'/etc/passwd'}});
 assert.ok(!entries.some(x=>x.label==='configured-broker'));
});
test('scan uses named candidates only and does not claim production recovery',async t=>{
 const f=fixture(t);
 const r=await scan({home:f.home,cwd:f.home,goalId,jobId,env:{JARVIS_DB_PATH:f.brokerPath,JARVIS_COMPASS_DB_PATH:f.compassPath}});
 assert.equal(r.readOnly,true);assert.equal(r.productionGoalRecovered,false);assert.equal(r.matchingGoalBackups,1);
 assert.equal(r.candidates[0].label,'configured-broker');
 assert.ok(!JSON.stringify(r).includes(f.home));
});


test('owner env is parsed as bounded literal paths only; secrets and shell content are never interpreted or emitted',t=>{
 const f=fixture(t);
 const dir=join(f.home,'Library','Application Support','JARVIS');
 mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 const envPath=join(dir,'jarvis.env');
 jsonFile(envPath,{}); // immediately replace with a private text fixture
 writeFileSync(envPath,[
   'JARVIS_OWNER_TOKEN=SECRET_TOKEN_MUST_NEVER_ECHO',
   `export JARVIS_DB_PATH="${f.brokerPath}"`,
   `JARVIS_COMPASS_DB_PATH="${f.compassPath}"`,
   'JARVIS_COMPASS_DB_PATH=$(touch /tmp/NEVER_EXECUTE)',
 ].join('\n'));
 const parsed=ownerFileConfiguredPaths(f.home);
 assert.deepEqual(parsed,{JARVIS_DB_PATH:f.brokerPath,JARVIS_COMPASS_DB_PATH:f.compassPath});
 assert.ok(!JSON.stringify(parsed).includes('SECRET'));
 const resolved=candidates({home:f.home,cwd:f.home,env:{}});
 assert.equal(resolved[0].label,'owner-config-file');
 assert.equal(resolved[0].compassPath,f.compassPath);
});


test('existing protected-main inventory workflow runs the new bounded observer only on Mac',()=>{
 const text=readFileSync(new URL('../.github/workflows/goriq-broker-db-inventory.yml',import.meta.url),'utf8');
 assert.match(text,/permissions:\s*\n\s*contents: read/);
 assert.match(text,/persist-credentials: false/);
 assert.match(text,/test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
 assert.match(text,/node scripts\/goriq-g1-backup-inventory\.mjs/);
 const mac=text.slice(text.indexOf('  mac:'),text.indexOf('  zbook:'));
 const win=text.slice(text.indexOf('  zbook:'));
 assert.match(mac,/node scripts\/goriq-g1-backup-inventory\.mjs/);
 assert.doesNotMatch(win,/goriq-g1-backup-inventory/);
 assert.match(mac,/self-hosted, macOS, ARM64/);
});
