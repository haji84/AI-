// Inert proposal algorithm only. No native adapter, CLI, trigger or approval
// issuer is provided. Injected ports belong to trusted code, never JSON/model
// input. Importing this module performs no I/O and creates no execution route.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const LABELS=Object.freeze(['owner-config-file','mac-canonical-repo-default']);
const MAX_BYTES=64*1024*1024,MAX_LIFETIME=30*60*1000;
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/,DECIMAL=/^[0-9]{1,24}$/;
const SCOPE_KEYS=['sourceRevision','artifactDigest','hostId','ownerUid','expiresAt'];
const FACT_KEYS=['label','path','hostId','ownerUid','groupId','dev','ino','kind','nlink','sizeBytes','mode','sha256',
  'mtimeNs','ctimeNs','canonical','parentsSafe','pathBound','withinOwnerHome','symlink','alias','aclEmpty','flags'];
const faults=new WeakMap();
const opaque=()=>Object.freeze(Object.create(null));
function fail(reason) {const error=new Error('MODE_REPAIR_HOLD');faults.set(error,reason);throw error;}
const reasonOf=(error,fallback)=>faults.get(error)??fallback;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function plain(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))fail('INVALID_INPUT');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!descriptors[key]||!Object.hasOwn(descriptors[key],'value')))fail('INVALID_INPUT');
  return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
function isOpaque(value) {
  return Boolean(value&&typeof value==='object'&&Object.getPrototypeOf(value)===null&&
    Reflect.ownKeys(value).length===0&&Object.isFrozen(value));
}
function snapshotScope(value,now) {
  const scope=plain(value,SCOPE_KEYS);
  if(typeof scope.sourceRevision!=='string'||!SHA.test(scope.sourceRevision)||typeof scope.artifactDigest!=='string'||!HASH.test(scope.artifactDigest)||typeof scope.hostId!=='string'||
    scope.hostId.length<1||scope.hostId.length>128||!Number.isSafeInteger(scope.ownerUid)||scope.ownerUid<=0||
    !Number.isSafeInteger(scope.expiresAt)||scope.expiresAt<=now||scope.expiresAt-now>MAX_LIFETIME)fail('INVALID_SCOPE');
  return Object.freeze(scope);
}
function snapshotFacts(value,label,scope) {
  const facts=plain(value,FACT_KEYS);
  if(facts.label!==label||facts.hostId!==scope.hostId||facts.ownerUid!==scope.ownerUid||
    !Number.isSafeInteger(facts.groupId)||facts.groupId<0||!['dev','ino','mtimeNs','ctimeNs'].every(key=>typeof facts[key]==='string'&&DECIMAL.test(facts[key]))||
    facts.kind!=='file'||facts.nlink!==1||!Number.isSafeInteger(facts.sizeBytes)||facts.sizeBytes<1||facts.sizeBytes>MAX_BYTES||
    !Number.isSafeInteger(facts.mode)||facts.mode<0||facts.mode>0o7777||(facts.mode&0o7000)!==0||
    typeof facts.sha256!=='string'||!HASH.test(facts.sha256)||!DECIMAL.test(facts.mtimeNs)||!DECIMAL.test(facts.ctimeNs)||
    typeof facts.path!=='string'||facts.path.length>2048||!facts.path.startsWith('/')||facts.path.includes('\0')||
    posix.normalize(facts.path)!==facts.path||facts.canonical!==true||facts.parentsSafe!==true||facts.pathBound!==true||
    facts.withinOwnerHome!==true||facts.symlink!==false||facts.alias!==false||facts.aclEmpty!==true||facts.flags!==0)fail('PRECONDITION_FAILED');
  return Object.freeze(facts);
}
const equalFacts=(a,b)=>FACT_KEYS.every(key=>a[key]===b[key]);
const sameImmutable=(a,b)=>FACT_KEYS.filter(key=>!['mode','ctimeNs'].includes(key)).every(key=>a[key]===b[key]);
const identity=facts=>JSON.stringify([facts.hostId,facts.ownerUid,facts.dev,facts.ino]);
function report(status,reason,session,handle) {
  return Object.freeze({status,reason,risk:'HIGH',permissionChange:true,requiresHumanApproval:true,
    targetCount:session?.targets.length??0,changedCount:session?.changedCount??0,restoredCount:session?.restoredCount??0,
    recoveryRequired:status==='RECOVERY_REQUIRED',productionAcceptance:false,...(handle?{handle}:{})});
}

/** Ports are deliberately unconnected. gate.consume must consume an existing
 * specific-action permit, returning an opaque receipt; gate.verify must return
 * that very receipt only while all expected bindings remain authorized. A JSON
 * boolean/record/digest is never a permit. Neither port issues human approval.
 * capture/inspect return private metadata + content hashes supplied by a future
 * reviewed adapter. This module never reads/copies DB bytes or opens files.
 * Handle/FD acquisition, retention and release belong to that future trusted
 * adapter; this draft cannot close real handles and supplies none itself.
 */
export function createCompassModeRepair({ops,gate,now=Date.now}={}) {
  const plans=new WeakMap(),recoveries=new WeakMap(),usedPermits=new WeakSet();
  function time() {const value=now();if(!Number.isSafeInteger(value)||value<0)fail('CLOCK_UNAVAILABLE');return value;}
  function withinDeadline(session) {if(time()>=session.scope.expiresAt)fail('PERMIT_EXPIRED');}
  function ports() {
    if(!ops||!['capture','inspect','retainJournal','setMode'].every(key=>typeof ops[key]==='function'))fail('OPS_UNAVAILABLE');
  }
  async function inspect(target,session) {
    const raw=await ops.inspect(target.handle);
    return snapshotFacts(raw,target.before.label,session.scope);
  }
  async function freshAll(session) {
    withinDeadline(session);
    for(const target of session.targets) {
      const facts=await inspect(target,session);
      withinDeadline(session);
      if(!equalFacts(facts,target.current))fail('FACTS_CHANGED');
    }
  }
  async function verifyGate(session,phase) {
    withinDeadline(session);
    const receipt=await gate.verify(session.receipt,session.binding,phase);
    withinDeadline(session);
    if(receipt!==session.receipt||!isOpaque(receipt))fail('PERMIT_REJECTED');
  }
  async function forwardBoundary(session) {
    await verifyGate(session,'apply');await freshAll(session);
    // A facts port may await. Observe authority once more before returning to
    // the side effect; the trusted adapter must also enforce its pinned facts.
    await verifyGate(session,'apply');
  }
  function journalSnapshot(session,phase) {
    const targets=Object.freeze(session.targets.map(target=>Object.freeze({before:target.before,current:target.current,
      targetMode:target.targetMode,confirmed:target.confirmed,restored:target.restored})));
    return Object.freeze({phase,scope:session.scope,binding:session.binding,targets});
  }
  async function retain(session,phase) {
    const receipt=await ops.retainJournal(journalSnapshot(session,phase));
    if(!isOpaque(receipt))fail('JOURNAL_UNCONFIRMED');
    session.journal=receipt;
  }
  async function plan(input) {
    try {
      ports();const scope=snapshotScope(input,time()),targets=[];
      for(const label of LABELS) {
        const raw=plain(await ops.capture(label),['handle','facts']);
        if(!isOpaque(raw.handle))fail('HANDLE_UNCONFIRMED');
        const before=snapshotFacts(raw.facts,label,scope);
        const existing=targets.find(target=>identity(target.before)===identity(before));
        if(existing) {
          if(!FACT_KEYS.filter(key=>key!=='label').every(key=>existing.before[key]===before[key]))fail('IDENTITY_AMBIGUOUS');
          continue;
        }
        if(targets.some(target=>target.handle===raw.handle||target.before.path===before.path))fail('IDENTITY_AMBIGUOUS');
        targets.push({handle:raw.handle,before,current:before,targetMode:before.mode&0o700,confirmed:false,restored:false});
      }
      const session={scope,targets,state:'PLANNED',changedCount:0,restoredCount:0,attempted:0,uncertain:false,rollbackUsed:false};
      await freshAll(session);
      const handle=opaque();
      const factsDigest=digest(targets.map(target=>target.before));
      // The digest identifies this private proposal, not a Goal contract,
      // execution lease, signature, approval record or permission grant.
      const proposalDigest=digest({issue:1219,goalId:'goal-fcc81c97e09153f7',jobId:'rotation-recovery-37',scope,factsDigest});
      session.binding=Object.freeze({plan:handle,proposalDigest,factsDigest,...scope,operation:'compass-mode-narrowing',
        permissionChange:true,risk:'HIGH',requiresHumanApproval:true});
      await retain(session,'PLANNED');
      await freshAll(session);
      plans.set(handle,session);
      return report('PLANNED','HUMAN_APPROVAL_REQUIRED',session,handle);
    }catch(error){return report('HOLD',reasonOf(error,'PLAN_UNAVAILABLE'));}
  }
  async function rollbackSession(session) {
    if(session.rollbackUsed)return report('HOLD','ROLLBACK_ALREADY_ATTEMPTED',session);
    session.rollbackUsed=true;
    let blocked=session.uncertain;
    for(const target of [...session.targets].reverse()) {
      if(!target.confirmed||target.restored)continue;
      try {
        await verifyGate(session,'rollback');
        let current=await inspect(target,session);
        await verifyGate(session,'rollback');
        if(!equalFacts(current,target.current)||current.mode!==target.targetMode||!sameImmutable(target.before,current))fail('ROLLBACK_CONFLICT');
        await retain(session,'ROLLBACK_INTENT');
        await verifyGate(session,'rollback');
        current=await inspect(target,session);
        if(!equalFacts(current,target.current)||current.mode!==target.targetMode)fail('ROLLBACK_CONFLICT');
        await verifyGate(session,'rollback');
        withinDeadline(session);
        const outcome=await ops.setMode(target.handle,target.current,target.before.mode);
        if(outcome!==target.handle)fail('MODE_OUTCOME_UNCONFIRMED');
        const restored=await inspect(target,session);
        if(!sameImmutable(target.before,restored)||restored.mode!==target.before.mode)fail('ROLLBACK_CONFLICT');
        target.current=restored;target.restored=true;session.restoredCount++;
        await verifyGate(session,'rollback');await retain(session,'MODE_RESTORED');
      }catch {blocked=true;}
    }
    session.state=blocked?'RECOVERY_REQUIRED':'ROLLED_BACK';
    return report(session.state,blocked?'ROLLBACK_BLOCKED':'MODES_RESTORED',session,blocked?session.recoveryHandle:undefined);
  }
  async function apply(handle,permit) {
    const session=plans.get(handle);
    if(!session)return report('HOLD','PLAN_HANDLE_UNCONFIRMED');
    if(session.state!=='PLANNED')return report('HOLD','PLAN_ALREADY_ATTEMPTED',session);
    if(!gate||typeof gate.consume!=='function'||typeof gate.verify!=='function')return report('HOLD','HUMAN_APPROVAL_REQUIRED',session);
    if(!isOpaque(permit))return report('HOLD','PERMIT_REJECTED',session);
    if(usedPermits.has(permit))return report('HOLD','PERMIT_REPLAY',session);
    // Reserve this plan and permit before the first await. An uncertain or
    // rejected consumption never silently authorizes another apply attempt.
    session.state='APPLYING';usedPermits.add(permit);
    try {
      await freshAll(session);
      const receipt=await gate.consume(permit,session.binding);
      withinDeadline(session);
      if(!isOpaque(receipt))fail('PERMIT_REJECTED');
      session.receipt=receipt;
      await forwardBoundary(session);
      await retain(session,'BASELINE');
      await forwardBoundary(session);
      session.recoveryHandle=opaque();recoveries.set(session.recoveryHandle,session);
      for(const target of session.targets) {
        if(target.targetMode===target.before.mode)continue;
        await forwardBoundary(session);await retain(session,'MODE_INTENT');await forwardBoundary(session);
        withinDeadline(session);
        session.attempted++;session.uncertain=true;
        const outcome=await ops.setMode(target.handle,target.current,target.targetMode);
        if(outcome!==target.handle)fail('MODE_OUTCOME_UNCONFIRMED');
        const after=await inspect(target,session);
        if(!sameImmutable(target.before,after)||after.mode!==target.targetMode)fail('MODE_OUTCOME_UNCONFIRMED');
        target.current=after;target.confirmed=true;session.changedCount++;session.uncertain=false;
        await forwardBoundary(session);await retain(session,'MODE_APPLIED');await forwardBoundary(session);
      }
      await forwardBoundary(session);await retain(session,'APPLIED');await forwardBoundary(session);
      session.state='APPLIED';return report('APPLIED','MODES_NARROWED',session,session.recoveryHandle);
    }catch(error) {
      session.state='HELD';
      if(!session.attempted)return report('HOLD',reasonOf(error,'APPLY_UNAVAILABLE'),session);
      if(!session.recoveryHandle){session.recoveryHandle=opaque();recoveries.set(session.recoveryHandle,session);}
      return rollbackSession(session);
    }
  }
  async function rollback(handle) {
    const session=recoveries.get(handle);
    if(!session)return report('HOLD','RECOVERY_HANDLE_UNCONFIRMED');
    if(session.state!=='APPLIED')return report(session.state==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'HOLD','ROLLBACK_NOT_ADMITTED',session,
      session.state==='RECOVERY_REQUIRED'?handle:undefined);
    session.state='ROLLING_BACK';return rollbackSession(session);
  }
  return Object.freeze({plan,apply,rollback});
}
