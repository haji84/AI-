import assert from 'node:assert/strict';
import test from 'node:test';
const {queueMicrotask}=globalThis;
const module=await import('../scripts/goriq-g1-compass-mode-repair.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return {};
 throw error;
});
const LABELS=['owner-config-file','mac-canonical-repo-default'];
const opaque=()=>Object.freeze(Object.create(null));
const PRIVATE='PRIVATE_PATH_OWNER_HASH_MUST_NOT_APPEAR';
function fixture() {
 assert.equal(typeof module.createCompassModeRepair,'function');
 let clock=1000,counter=0;
 const scope={sourceRevision:'a'.repeat(40),artifactDigest:'b'.repeat(64),hostId:PRIVATE,ownerUid:1000,expiresAt:31000};
 const records=LABELS.map((label,index)=>({handle:opaque(),facts:{label,path:'/private/'+PRIVATE+'/'+index,hostId:PRIVATE,
  ownerUid:1000,groupId:1000,dev:'11',ino:String(20+index),kind:'file',nlink:1,sizeBytes:1024,
  mode:index===0?0o640:0o744,sha256:'c'.repeat(64),mtimeNs:'100',ctimeNs:'100',canonical:true,
  parentsSafe:true,pathBound:true,withinOwnerHome:true,symlink:false,alias:false,aclEmpty:true,flags:0}}));
 const calls={capture:[],inspect:0,modes:[],journals:[]};
 const hooks={};
 const issued=new WeakMap(),consumed=new WeakMap();
 const gate={
  async consume(permit,binding) {
   await hooks.consume?.(binding);
   const claim=issued.get(permit);
   if(!claim||claim.used||claim.plan!==binding.plan||Object.keys(scope).some(k=>claim[k]!==binding[k])||
      binding.operation!=='compass-mode-narrowing'||binding.permissionChange!==true||binding.risk!=='HIGH'||binding.requiresHumanApproval!==true)return null;
   claim.used=true;const receipt=opaque();consumed.set(receipt,binding);return receipt;
  },
  async verify(receipt,binding,phase) {
   await hooks.verify?.(binding,phase);
   return consumed.get(receipt)===binding?receipt:null;
  },
 };
 const ops={
  async capture(label) {calls.capture.push(label);await hooks.capture?.(label);return records.find(x=>x.facts.label===label);},
  async inspect(handle) {calls.inspect++;await hooks.inspect?.(handle);return records.find(x=>x.handle===handle)?.facts;},
  async retainJournal(record) {calls.journals.push(record);await hooks.journal?.(record);return opaque();},
  async setMode(handle,expected,mode) {
   const record=records.find(x=>x.handle===handle);
   assert.deepEqual(record.facts,expected,'mode operation must use the latest pinned snapshot');
   calls.modes.push({handle,mode});
   record.facts={...record.facts,mode,ctimeNs:String(200+(++counter))};
   await hooks.mode?.(record,mode);
   return handle;
  },
 };
 const api=module.createCompassModeRepair({ops,gate,now:()=>clock});
 const issue=(plan,overrides={})=>{const permit=opaque();issued.set(permit,{...scope,plan,used:false,...overrides});return permit;};
 const assertPrivate=result=>{
  const text=JSON.stringify(result);
  for(const value of [PRIVATE,'c'.repeat(64),'b'.repeat(64),'mtimeNs','ownerUid','groupId','ctimeNs','sourceRevision'])assert.ok(!text.includes(value),value);
  for(const key of Object.keys(result))assert.ok(['status','reason','risk','permissionChange','requiresHumanApproval','targetCount','changedCount','restoredCount','recoveryRequired','handle','productionAcceptance'].includes(key),key);
  assert.equal(result.productionAcceptance,false);
 };
 return {scope,records,calls,hooks,gate,ops,api,issue,assertPrivate,setClock:v=>{clock=v;}};
}
async function planned(f) {
 const result=await f.api.plan(f.scope);assert.equal(result.status,'PLANNED');f.assertPrivate(result);return result.handle;
}

test('factory is inert and a proposal has fixed HIGH permission-change scope without public facts',async()=>{
 const f=fixture();assert.deepEqual(f.calls,{capture:[],inspect:0,modes:[],journals:[]});
 const result=await f.api.plan(f.scope);
 assert.equal(result.status,'PLANNED');assert.equal(result.risk,'HIGH');assert.equal(result.permissionChange,true);assert.equal(result.requiresHumanApproval,true);
 assert.equal(result.targetCount,2);assert.deepEqual(f.calls.capture,LABELS);assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,1);f.assertPrivate(result);
});

test('valid opaque permit narrows only group/other bits and retains private immutable baseline before mutation',async()=>{
 const f=fixture(),handle=await planned(f),before=f.records.map(x=>({...x.facts}));
 const result=await f.api.apply(handle,f.issue(handle));
 assert.equal(result.status,'APPLIED');assert.equal(result.changedCount,2);assert.equal(result.recoveryRequired,false);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o600,0o700]);
 assert.ok(f.calls.journals.length>=1);
 assert.ok(f.calls.journals[0].targets.every(x=>x.before&&x.before.path.includes(PRIVATE)));
 assert.ok(Object.isFrozen(f.calls.journals[0]));
 for(let i=0;i<2;i++)for(const key of ['ownerUid','groupId','dev','ino','sha256','sizeBytes','mtimeNs'])assert.equal(f.records[i].facts[key],before[i][key]);
 f.assertPrivate(result);
});

for(const [name,permit] of [['missing',undefined],['boolean',true],['JSON',{approved:true}],['empty JSON',{}]])test(name+' permit gives zero mutations and retains only the private plan',async()=>{
 const f=fixture(),handle=await planned(f),result=await f.api.apply(handle,permit);
 assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,1);f.assertPrivate(result);
});

test('no trusted gate or boolean gate receipt cannot authorize mutation',async()=>{
 for(const gate of [undefined,{consume:async()=>true,verify:async x=>x}]) {
  const f=fixture(),api=module.createCompassModeRepair({ops:f.ops,gate,now:()=>1000}),p=await api.plan(f.scope);
  const result=await api.apply(p.handle,opaque());assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,1);
 }
});

for(const key of ['sourceRevision','artifactDigest','hostId','ownerUid','expiresAt'])test('permit mismatch for '+key+' fails before apply journals or mode writes',async()=>{
 const f=fixture(),handle=await planned(f),value=typeof f.scope[key]==='number'?f.scope[key]+1:'wrong';
 const result=await f.api.apply(handle,f.issue(handle,{[key]:value}));
 assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,1);f.assertPrivate(result);
});

test('permit from another plan, copied permit, and reused permit never grant a second apply',async()=>{
 const f=fixture(),first=await planned(f),second=await planned(f),permit=f.issue(first);
 assert.equal((await f.api.apply(second,permit)).status,'HOLD');assert.equal(f.calls.modes.length,0);
 const fresh=fixture(),plan=await planned(fresh),valid=fresh.issue(plan);
 assert.equal((await fresh.api.apply(plan,JSON.parse(JSON.stringify(valid)))).status,'HOLD');assert.equal(fresh.calls.modes.length,0);
 const another=await planned(fresh),right=fresh.issue(another);
 assert.equal((await fresh.api.apply(another,right)).status,'APPLIED');
 const count=fresh.calls.modes.length;
 assert.equal((await fresh.api.apply(another,right)).status,'HOLD');assert.equal(fresh.calls.modes.length,count);
});

for(const [key,value] of [
 ['ownerUid',1001],['hostId','other'],['kind','directory'],['nlink',2],['sizeBytes',0],['sizeBytes',64*1024*1024+1],
 ['canonical',false],['parentsSafe',false],['pathBound',false],['withinOwnerHome',false],['symlink',true],['alias',true],
 ['aclEmpty',false],['flags',1],['mode',0o4644],['sha256','invalid'],
])test('invalid '+key+' precondition is HOLD before any mutation',async()=>{
 const f=fixture();f.records[0].facts[key]=value;
 const result=await f.api.plan(f.scope);assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,0);f.assertPrivate(result);
});

test('scope unknown fields, stale expiry, and unknown handles do not become execution authority',async()=>{
 const f=fixture();
 for(const scope of [{...f.scope,path:'/private/'+PRIVATE},{...f.scope,expiresAt:1000},{...f.scope,expiresAt:1801001}])assert.equal((await f.api.plan(scope)).status,'HOLD');
 assert.equal((await f.api.apply({},opaque())).status,'HOLD');assert.equal((await f.api.rollback({})).status,'HOLD');assert.equal(f.calls.modes.length,0);
});

test('same identity is deduplicated only when both fixed-label facts bind the same path and bytes',async()=>{
 const f=fixture();f.records[1].facts={...f.records[0].facts,label:LABELS[1]};f.records[1].handle=f.records[0].handle;
 const handle=await planned(f),result=await f.api.apply(handle,f.issue(handle));
 assert.equal(result.status,'APPLIED');assert.equal(result.targetCount,1);assert.equal(f.calls.modes.length,1);
 const bad=fixture();bad.records[1].facts={...bad.records[0].facts,label:LABELS[1],path:'/private/other'};
 assert.equal((await bad.api.plan(bad.scope)).status,'HOLD');assert.equal(bad.calls.modes.length,0);
});

test('mutable caller scope and fact objects cannot rewrite an already captured plan across awaits',async()=>{
 const f=fixture();let release;const pending=new Promise(r=>{release=r;});
 f.hooks.capture=async label=>{if(label===LABELS[1])await pending;};
 const planning=f.api.plan(f.scope);
 await Promise.resolve();await Promise.resolve();
 f.scope.sourceRevision='d'.repeat(40);f.records[0].facts.mode=0o666;
 release();
 const result=await planning;assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);
});

test('changed private facts during permit consumption or journal retention stop before mode mutation',async()=>{
 for(const stage of ['consume','journal']) {
  const f=fixture(),handle=await planned(f);
  f.hooks[stage]=async()=>{f.records[0].facts={...f.records[0].facts,sha256:'d'.repeat(64)};};
  const result=await f.api.apply(handle,f.issue(handle));assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);f.assertPrivate(result);
 }
});

test('expiry before apply or while gate is awaited gives zero apply writes',async()=>{
 for(const stage of ['before','consume']) {
  const f=fixture(),handle=await planned(f),permit=f.issue(handle);
  if(stage==='before')f.setClock(31000);else f.hooks.consume=async()=>{f.setClock(31000);};
  const result=await f.api.apply(handle,permit);assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);assert.equal(f.calls.journals.length,1);
 }
});

test('expiry during the first mutation stops later mutations and does not misuse expired authority for rollback',async()=>{
 const f=fixture(),handle=await planned(f);f.hooks.mode=async()=>{f.setClock(31000);};
 const result=await f.api.apply(handle,f.issue(handle));
 assert.equal(result.status,'RECOVERY_REQUIRED');assert.equal(result.recoveryRequired,true);assert.equal(f.calls.modes.length,1);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o600,0o744]);f.assertPrivate(result);
 assert.equal((await f.api.rollback(result.handle)).status,'RECOVERY_REQUIRED');assert.equal(f.calls.modes.length,1);
});

test('an apply failure rolls back only its confirmed mode while authority and pinned facts remain valid',async()=>{
 const f=fixture(),handle=await planned(f);
 f.hooks.journal=async record=>{if(record.phase==='MODE_APPLIED')throw Error(PRIVATE);};
 const result=await f.api.apply(handle,f.issue(handle));
 assert.equal(result.status,'ROLLED_BACK');assert.equal(result.restoredCount,1);assert.equal(result.recoveryRequired,false);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o640,0o744]);assert.equal(f.calls.modes.length,2);f.assertPrivate(result);
});

for(const [key,value] of [['ino','999'],['ownerUid',1001],['mode',0o400],['sha256','d'.repeat(64)]])test('rollback never overwrites later '+key+' changes',async()=>{
 const f=fixture(),handle=await planned(f),applied=await f.api.apply(handle,f.issue(handle));
 assert.equal(applied.status,'APPLIED');f.records[1].facts={...f.records[1].facts,[key]:value};
 const count=f.calls.modes.length,result=await f.api.rollback(applied.handle);
 assert.equal(result.status,'RECOVERY_REQUIRED');assert.equal(f.records[1].facts[key],value);
 assert.ok(f.calls.modes.slice(count).every(x=>x.handle!==f.records[1].handle));f.assertPrivate(result);
});

test('explicit rollback is single-use, preserves bytes and restores only recorded modes',async()=>{
 const f=fixture(),handle=await planned(f),applied=await f.api.apply(handle,f.issue(handle));
 const result=await f.api.rollback(applied.handle);assert.equal(result.status,'ROLLED_BACK');assert.equal(result.restoredCount,2);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o640,0o744]);const count=f.calls.modes.length;
 assert.equal((await f.api.rollback(applied.handle)).status,'HOLD');assert.equal(f.calls.modes.length,count);f.assertPrivate(result);
});

test('uncertain setMode completion is retained as recovery, never accepted or blindly retried',async()=>{
 const f=fixture(),handle=await planned(f);f.hooks.mode=async()=>{throw Error(PRIVATE);};
 const result=await f.api.apply(handle,f.issue(handle));assert.equal(result.status,'RECOVERY_REQUIRED');assert.equal(f.calls.modes.length,1);
 assert.equal((await f.api.apply(handle,f.issue(handle))).status,'HOLD');assert.equal(f.calls.modes.length,1);f.assertPrivate(result);
});

test('binding and metadata scalar fields reject coercion objects without invoking them or retaining mutable references',async()=>{
 for(const key of ['sourceRevision','artifactDigest','dev','ino','mtimeNs','ctimeNs']) {
  const f=fixture();let invoked=0;
  const value={toString(){invoked++;return key==='sourceRevision'?'a'.repeat(40):key==='artifactDigest'?'b'.repeat(64):'11';}};
  if(key in f.scope)f.scope[key]=value;else f.records[0].facts[key]=value;
  const result=await f.api.plan(f.scope);
  assert.equal(result.status,'HOLD');assert.equal(invoked,0);assert.equal(f.calls.modes.length,0);f.assertPrivate(result);
 }
});

test('a second label cannot bind the same path to a different identity',async()=>{
 const f=fixture();f.records[1].facts.path=f.records[0].facts.path;
 const result=await f.api.plan(f.scope);assert.equal(result.status,'HOLD');assert.equal(f.calls.modes.length,0);
});


test('planning retains a complete frozen private proposal for trusted review without public facts or mode writes',async()=>{
 const f=fixture(),result=await f.api.plan(f.scope),record=f.calls.journals[0];
 assert.equal(result.status,'PLANNED');assert.equal(record?.phase,'PLANNED');
 assert.equal(record.binding.plan,result.handle);assert.match(record.binding.proposalDigest,/^[a-f0-9]{64}$/);
 assert.match(record.binding.factsDigest,/^[a-f0-9]{64}$/);assert.deepEqual(record.scope,f.scope);
 assert.equal(record.targets[0].before.path,f.records[0].facts.path);assert.equal(record.targets[0].before.mode,0o640);
 assert.ok(Object.isFrozen(record)&&Object.isFrozen(record.binding)&&Object.isFrozen(record.scope)&&Object.isFrozen(record.targets)&&Object.isFrozen(record.targets[0].before));
 assert.equal(f.calls.modes.length,0);f.assertPrivate(result);
});

test('private plan journal failure issues no plan handle or mutation authority',async()=>{
 const f=fixture();f.hooks.journal=async()=>{throw Error(PRIVATE);};
 const result=await f.api.plan(f.scope);assert.equal(result.status,'HOLD');assert.equal(result.handle,undefined);assert.equal(f.calls.modes.length,0);f.assertPrivate(result);
});

for(const change of ['facts','expiry'])test('changed '+change+' while retaining the private plan prevents issuing it',async()=>{
 const f=fixture();f.hooks.journal=async()=>{
  if(change==='facts')f.records[0].facts={...f.records[0].facts,ctimeNs:'999'};else f.setClock(31000);
 };
 const result=await f.api.plan(f.scope);assert.equal(result.status,'HOLD');assert.equal(result.handle,undefined);assert.equal(f.calls.modes.length,0);f.assertPrivate(result);
});

test('apply refuses expiry in the microtask gap after the final awaited verification without recording a mode attempt',async()=>{
 const f=fixture(),handle=await planned(f);let armed=false,verifies=0,expired=false;
 f.hooks.journal=async record=>{if(record.phase==='MODE_INTENT')armed=true;};
 const verify=f.gate.verify.bind(f.gate);
 f.gate.verify=async(...args)=>{
  const receipt=await verify(...args);
  if(armed&&++verifies===2)queueMicrotask(()=>queueMicrotask(()=>{expired=true;f.setClock(31000);}));
  return receipt;
 };
 const result=await f.api.apply(handle,f.issue(handle));
 assert.equal(expired,true);assert.equal(f.calls.modes.length,0);
 assert.equal(result.status,'HOLD');assert.equal(result.changedCount,0);assert.equal(result.recoveryRequired,false);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o640,0o744]);f.assertPrivate(result);
});

test('rollback refuses expiry in the microtask gap after the final awaited verification without restoring broader modes',async()=>{
 const f=fixture(),handle=await planned(f),applied=await f.api.apply(handle,f.issue(handle));
 assert.equal(applied.status,'APPLIED');let verifies=0,expired=false;const verify=f.gate.verify.bind(f.gate);
 f.gate.verify=async(...args)=>{
  const receipt=await verify(...args);
  if(args[2]==='rollback'&&++verifies===4)queueMicrotask(()=>queueMicrotask(()=>{expired=true;f.setClock(31000);}));
  return receipt;
 };
 const count=f.calls.modes.length,result=await f.api.rollback(applied.handle);
 assert.equal(expired,true);assert.equal(f.calls.modes.length,count);
 assert.equal(result.status,'RECOVERY_REQUIRED');assert.equal(result.restoredCount,0);
 assert.deepEqual(f.records.map(x=>x.facts.mode),[0o600,0o700]);f.assertPrivate(result);
});
