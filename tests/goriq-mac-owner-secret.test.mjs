import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, lstat, rm, symlink, mkdir, chmod } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeOwnerSecret, assertNoOwnerSecretTransaction } from '../scripts/goriq-mac-owner-secret.mjs';
const exec=promisify(execFile), now=Date.parse('2026-10-05T14:40:00Z');
const ownerTest=(name,fn)=>test(name,{skip:typeof process.getuid!=='function'},fn);
const artifacts={'scripts/goriq-mac-owner-secret.mjs':'b'.repeat(40)};
const approval={version:1,issue:1662,goalIssue:1219,owner:'haji84',nodeId:'macbook',platform:'macos',
  operation:'initialize-missing-owner-session-secret',variable:'JARVIS_OWNER_SECRET',sourceBinding:'current-main-successful-ci',
  approvedAt:'2026-10-05T14:29:25.689Z',expiresAt:'2026-10-06T14:29:25.689Z',
  evidence:'https://github.com/haji84/AI-/issues/1662#issuecomment-5996554289',artifacts};
const original="JARVIS_OWNER_TOKEN='retained-token'\nJARVIS_REMOTE_GATEWAY_TOKEN='retained-gateway'\nJARVIS_DB_PATH='/retained/db'\n";
async function fixture(t,text=original) {
  const dir=await mkdtemp(join(tmpdir(),'goriq-secret-fixture-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'jarvis.env');await writeFile(path,text,{mode:0o600});
  const readConfig=async(path)=>JSON.parse((await exec('/bin/bash',['-c','set -e; set -a; source "$1" >/dev/null; set +a; exec "$2" -e "$3"',
    'goriq',path,process.execPath,'console.log(JSON.stringify(Object.fromEntries(["JARVIS_OWNER_TOKEN","JARVIS_REMOTE_GATEWAY_TOKEN","JARVIS_DB_PATH","JARVIS_OWNER_SECRET","AI_COMPANY_OWNER_SECRET"].map(k=>[k,process.env[k]||""]))))'],
    {env:{PATH:'/usr/bin:/bin'},timeout:3000})).stdout);
  const guard=async(path)=>{const s=await lstat(path);if(s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o022)throw Error('NATIVE_PATH_REJECTED');};
  const ops={guard,readConfig,metadata:async(path)=>{const s=await lstat(path);return {uid:s.uid,gid:s.gid,mode:s.mode&0o7777,acl:[],flags:0};},
    recheck:async()=>{},verifyUnrelated:async()=>{},now:()=>now};
  const input={path,phase:'apply',revision:'a'.repeat(40),approval,artifacts};return {dir,path,input,ops,readConfig};
}
ownerTest('initialization preserves real configuration prefix, metadata and protected backup, and emits no secret',async t=>{
  const f=await fixture(t),before=await lstat(f.path),r=await initializeOwnerSecret(f.input,f.ops);
  assert.equal(r.complete,true);assert.equal(r.credentialChanged,true);
  const bytes=await readFile(f.path,'utf8'),config=await f.readConfig(f.path);assert.ok(bytes.startsWith(original));
  assert.match(config.JARVIS_OWNER_SECRET,/^[a-f0-9]{64}$/);assert.equal(config.JARVIS_OWNER_TOKEN,'retained-token');
  assert.equal(config.JARVIS_REMOTE_GATEWAY_TOKEN,'retained-gateway');assert.equal(config.JARVIS_DB_PATH,'/retained/db');
  const after=await lstat(f.path);assert.equal(after.mode,before.mode);assert.equal(after.uid,before.uid);assert.equal(after.gid,before.gid);
  const backup=(await readdir(f.dir)).find(n=>n.startsWith('.goriq-owner-secret-recovery-'));assert.ok(backup);
  assert.equal((await lstat(join(f.dir,backup))).mode&0o777,0o700);
  assert.equal(await readFile(join(f.dir,backup,'original.env'),'utf8'),original);
  assert.equal((await lstat(join(f.dir,backup,'original.env'))).mode&0o777,0o600);
  const receipt=JSON.stringify(r);for(const privateValue of [config.JARVIS_OWNER_SECRET,'retained-token',f.path,f.dir])assert.equal(receipt.includes(privateValue),false);
  const names=await readdir(f.dir);const again=await initializeOwnerSecret(f.input,f.ops);assert.equal(again.readOnly,true);assert.equal(again.credentialChanged,false);
  assert.deepEqual(await readdir(f.dir),names);assert.equal(await readFile(f.path,'utf8'),bytes);
});
ownerTest('plan does not generate a credential or create any files',async t=>{
  const f=await fixture(t),r=await initializeOwnerSecret({...f.input,phase:'plan'},f.ops);
  assert.equal(r.readOnly,true);assert.equal(r.initializationRequired,true);assert.equal(await readFile(f.path,'utf8'),original);
  assert.deepEqual(await readdir(f.dir),['jarvis.env']);
});
ownerTest('absent, expired, other scope and mismatched artifact approval cannot mutate',async t=>{
  const f=await fixture(t);for(const gate of [null,{...approval,expiresAt:'2026-10-05T14:39:59Z'},
    {...approval,nodeId:'zbook'},{...approval,variable:'JARVIS_OWNER_TOKEN'},{...approval,artifacts:{x:'c'.repeat(40)}}]){
    await assert.rejects(initializeOwnerSecret({...f.input,approval:gate},f.ops),/OWNER_SECRET_APPROVAL_REJECTED/);
    assert.equal(await readFile(f.path,'utf8'),original);assert.deepEqual(await readdir(f.dir),['jarvis.env']);
  }
});
ownerTest('existing alternative secret is preserved without rotation or a new backup',async t=>{
  const text=original+"AI_COMPANY_OWNER_SECRET='existing-private-secret'\n",f=await fixture(t,text);
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.credentialChanged,false);assert.equal(r.readOnly,true);
  assert.equal(await readFile(f.path,'utf8'),text);assert.deepEqual(await readdir(f.dir),['jarvis.env']);
});
ownerTest('verification failure reverses the real atomic exchange and restores the original inode',async t=>{
  const f=await fixture(t),before=await lstat(f.path);f.ops.verifyUnrelated=async()=>{throw Error('private-error-body');};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.restored,true);assert.equal(r.recoveryBlocked,false);
  assert.equal(await readFile(f.path,'utf8'),original);assert.equal((await lstat(f.path)).ino,before.ino);
  assert.equal(JSON.stringify(r).includes('private-error-body'),false);
});
ownerTest('concurrent edit at the atomic boundary is retained by reverse exchange',async t=>{
  const f=await fixture(t),changed=original+"# concurrent-owner-edit\n";
  let first=true;f.ops.exchange=async(a,b)=>{if(first){first=false;await writeFile(a,changed);}await realExchange(a,b);};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.restored,true);
  assert.equal(await readFile(f.path,'utf8'),changed);
});
async function realExchange(a,b) {await exec('/usr/bin/python3',['-I','scripts/goriq-owner-file-swap.py',a,b],{timeout:3000});}
ownerTest('concurrent edit of the after-image blocks recovery without overwriting it',async t=>{
  const f=await fixture(t),changed="# newer-owner-setting\n";
  f.ops.verifyUnrelated=async()=>{await writeFile(f.path,changed);throw Error('private-body');};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.restored,false);assert.equal(r.recoveryBlocked,true);
  assert.equal(await readFile(f.path,'utf8'),changed);
});
ownerTest('expiry after awaited recheck cannot create or replace credentials',async t=>{
  const f=await fixture(t);let time=now;f.ops.now=()=>time;f.ops.recheck=async()=>{time=Date.parse(approval.expiresAt);};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.credentialChanged,false);
  assert.equal(await readFile(f.path,'utf8'),original);assert.deepEqual(await readdir(f.dir),['jarvis.env']);
});
ownerTest('symlink source and extra allow ACL are rejected before mutation',async t=>{
  const f=await fixture(t),link=join(f.dir,'link');await symlink(f.path,link);
  await assert.rejects(initializeOwnerSecret({...f.input,path:link},f.ops),/NATIVE_PATH_REJECTED/);
  f.ops.metadata=async()=>({uid:process.getuid(),gid:process.getgid(),mode:0o600,acl:['unexpected allow'],flags:0});
  await assert.rejects(initializeOwnerSecret(f.input,f.ops),/OWNER_SECRET_METADATA_REJECTED/);
  assert.equal(await readFile(f.path,'utf8'),original);
});
ownerTest('an ambiguous swap command failure is recovered from actual inode evidence',async t=>{
  const f=await fixture(t);let first=true;
  f.ops.exchange=async(a,b)=>{await realExchange(a,b);if(first){first=false;throw Error('private-command-body');}};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.restored,true);
  assert.equal(await readFile(f.path,'utf8'),original);assert.equal(JSON.stringify(r).includes('private-command-body'),false);
});
ownerTest('a new dependent dashboard prevents reversing its credential',async t=>{
  const f=await fixture(t);f.ops.verifyUnrelated=async()=>{throw Error('dependent dashboard appeared');};f.ops.canRestore=async()=>false;
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.recoveryBlocked,true);
  assert.match((await f.readConfig(f.path)).JARVIS_OWNER_SECRET,/^[a-f0-9]{64}$/);
});
ownerTest('expiry at the last awaited boundary retains backup without replacing the environment',async t=>{
  const f=await fixture(t);let calls=0,time=now;f.ops.now=()=>time;
  f.ops.recheck=async()=>{if(++calls===2)time=Date.parse(approval.expiresAt);};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.credentialChanged,false);
  assert.equal(await readFile(f.path,'utf8'),original);assert.equal(r.backupRetained,true);
});
ownerTest('pending marker blocks a configured-secret retry and native staging check',async t=>{
  const f=await fixture(t,original+"JARVIS_OWNER_SECRET='unverified-interrupted-image'\n");
  await mkdir(join(f.dir,'.goriq-owner-secret-initialization.lock'),{mode:0o700});
  await assert.rejects(initializeOwnerSecret(f.input,f.ops),/OWNER_SECRET_PENDING_TRANSACTION/);
  await assert.rejects(assertNoOwnerSecretTransaction(f.path),/OWNER_SECRET_PENDING_TRANSACTION/);
  assert.equal(await readFile(f.path,'utf8'),original+"JARVIS_OWNER_SECRET='unverified-interrupted-image'\n");
});
ownerTest('edit during awaited recovery boundary remains active and retains pending evidence',async t=>{
  const f=await fixture(t),changed='# newer owner content during recovery\n';
  f.ops.verifyUnrelated=async()=>{throw Error('verify failed');};
  f.ops.canRestore=async()=>{await writeFile(f.path,changed);return true;};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.recoveryBlocked,true);
  assert.equal(await readFile(f.path,'utf8'),changed);await assert.rejects(assertNoOwnerSecretTransaction(f.path));
});
ownerTest('race inside reverse syscall puts unknown owner edit back and remains blocked',async t=>{
  const f=await fixture(t),changed='# newer owner content at reverse exchange\n';let calls=0;
  f.ops.verifyUnrelated=async()=>{throw Error('verify failed');};
  f.ops.exchange=async(a,b)=>{if(++calls===2)await writeFile(a,changed);await realExchange(a,b);};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,false);assert.equal(r.restored,false);assert.equal(r.recoveryBlocked,true);
  assert.equal(await readFile(f.path,'utf8'),changed);await assert.rejects(assertNoOwnerSecretTransaction(f.path));
});
ownerTest('caller receives only the privately verified baseline, never a fresh unverified after-image',async t=>{
  const f=await fixture(t);let accepted;
  f.ops.acceptVerified=value=>{accepted={configuration:{...value.configuration},bytes:Buffer.from(value.bytes)};};
  const r=await initializeOwnerSecret(f.input,f.ops);assert.equal(r.complete,true);
  assert.equal(accepted.bytes.toString(),await readFile(f.path,'utf8'));
  assert.equal(accepted.configuration.JARVIS_OWNER_SECRET,(await f.readConfig(f.path)).JARVIS_OWNER_SECRET);
  await writeFile(f.path,'# concurrent edit after verified initialization\n');
  assert.notEqual(accepted.bytes.toString(),await readFile(f.path,'utf8'));
  assert.equal(JSON.stringify(r).includes(accepted.configuration.JARVIS_OWNER_SECRET),false);
});

ownerTest('special permission bits are rejected without modifying source metadata',async t=>{
  const f=await fixture(t);await chmod(f.path,0o4600);
  await assert.rejects(initializeOwnerSecret(f.input,f.ops),/OWNER_SECRET_METADATA_REJECTED/);
  assert.equal((await lstat(f.path)).mode&0o7777,0o4600);assert.equal(await readFile(f.path,'utf8'),original);
});
