import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { CompassStore } from '../src/compass/store.ts';
import { OwnerRequirementIntake } from '../src/orchestrator/owner-requirement-intake.ts';
// Dynamic import allows an assertion on the missing public contract before implementation.
test('adopted requirement prepares both canonical ledgers and proves exact sync without claiming functional completion',async()=>{
 const path=new URL('../scripts/jarvis-owner-spec-sync.mjs',import.meta.url);
 assert.ok(fs.existsSync(path),'specification proposal/sync implementation missing');
 const {loadCanonicalBundle,prepareSpecificationProposal,verifyCanonicalReceipt}=await import(path.href);
 const root=fileURLToPath(new URL('../',import.meta.url)),bundle=loadCanonicalBundle(root);
 const db=new CompassStore(':memory:');try{
 const intake=new OwnerRequirementIntake(db),record=intake.capture(intake.prepare('work','sync',{decision:'accept',statement:'採用要求の同期状態を完了判定へ表示する',canonicalIds:['CORE-015']}),'goal',bundle.matrix.requirements);
 const proposal=prepareSpecificationProposal(record,bundle,{sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[{id:'CORE-015',baseFingerprint:record.matches.find(x=>x.id==='CORE-015').fingerprint}]},root);
 assert.equal(proposal.files.length,3);assert.equal(proposal.autoMerge,false);
 const next=proposal.bundle;assert.equal(next.matrix.requirements.length,bundle.matrix.requirements.length);
 assert.deepEqual(next.matrix.requirements.map(r=>r.status),bundle.matrix.requirements.map(r=>r.status));
 assert.equal(verifyCanonicalReceipt(record,bundle,root).ok,false);
 assert.equal(verifyCanonicalReceipt(record,next,root).ok,true);
 const changed=globalThis.structuredClone(record);changed.statement+=' tamper';assert.equal(verifyCanonicalReceipt(changed,next,root).ok,false);
 const stale=globalThis.structuredClone(bundle);stale.matrix.requirements.find(r=>r.id==='CORE-015').description+=' changed';
 assert.throws(()=>prepareSpecificationProposal(record,stale,{sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[{id:'CORE-015',baseFingerprint:record.matches[0].fingerprint}]},root),/canonical|conflict|mirror/i);
 assert.throws(()=>prepareSpecificationProposal(record,bundle,{sourceRef:'https://attacker.invalid/',bindings:[]},root),/source|binding/);
 }finally{db.close();}
});

test('correction and withdrawal reconcile canonical history without deleting base requirements or advancing evidence',async()=>{
 const {loadCanonicalBundle,prepareSpecificationProposal,verifyCanonicalReceipt}=await import('../scripts/jarvis-owner-spec-sync.mjs');
 const {requirementFingerprint}=await import('../scripts/jarvis-requirement-audit.mjs');
 const root=fileURLToPath(new URL('../',import.meta.url)),bundle=loadCanonicalBundle(root),db=new CompassStore(':memory:');
 try{
  const intake=new OwnerRequirementIntake(db);
  const capture=(key,statement,supersedes,decision='accept')=>intake.capture(intake.prepare(key,key,{decision,statement,canonicalIds:['CORE-015'],...(supersedes?{supersedes}:{})}),'goal',bundle.matrix.requirements);
  const review=b=>({sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:[{id:'CORE-015',baseFingerprint:requirementFingerprint(b.matrix.requirements.find(r=>r.id==='CORE-015'))}]});
  const first=capture('original','同期状況は一覧の上部へ表示する');
  const base=prepareSpecificationProposal(first,bundle,review(bundle),root).bundle;
  const corrected=capture('correction','同期状況は各要求の横へ表示する',first.id);
  assert.throws(()=>prepareSpecificationProposal(corrected,base,review(base),root,[]),/history|previous|receipt/);
  const next=prepareSpecificationProposal(corrected,base,review(base),root,intake.list()).bundle;
  const row=next.matrix.requirements.find(r=>r.id==='CORE-015');
  assert.ok(!row.description.includes(first.statement));assert.ok(row.description.includes(corrected.statement));
  assert.ok(row.description.startsWith(bundle.matrix.requirements.find(r=>r.id==='CORE-015').description));
  assert.equal(next.decisions.decisions.find(d=>d.id===first.id).state,'SUPERSEDED');
  assert.equal(verifyCanonicalReceipt(corrected,base,root).ok,false);assert.equal(verifyCanonicalReceipt(corrected,next,root).ok,true);
  const withdrawn=capture('withdrawal','今回追加した表示要求を撤回する',corrected.id,'withdraw');
  const final=prepareSpecificationProposal(withdrawn,next,review(next),root,intake.list()).bundle;
  assert.equal(final.matrix.requirements.find(r=>r.id==='CORE-015').description,bundle.matrix.requirements.find(r=>r.id==='CORE-015').description);
  assert.equal(final.decisions.decisions.find(d=>d.id===withdrawn.id).state,'WITHDRAWN');
  assert.equal(verifyCanonicalReceipt(withdrawn,final,root).ok,true);
  const forged=globalThis.structuredClone(final);forged.decisions.decisions.find(d=>d.id===withdrawn.id).state='SPEC_SYNCED';
  assert.equal(verifyCanonicalReceipt(withdrawn,forged,root).ok,false);
  assert.deepEqual(final.matrix.requirements.map(r=>r.status),bundle.matrix.requirements.map(r=>r.status));
  // A rapid correction before the first receipt was synced still preserves the entire chain.
  const unsynced=prepareSpecificationProposal(withdrawn,bundle,review(bundle),root,intake.list()).bundle;
  assert.equal(verifyCanonicalReceipt(withdrawn,unsynced,root).ok,true);
  assert.ok(unsynced.decisions.decisions.some(d=>d.id===first.id&&d.state==='SUPERSEDED'));
  const readopted=capture('readoption','再採用した同期表示を要求する',withdrawn.id);
  const restored=prepareSpecificationProposal(readopted,final,review(final),root,intake.list()).bundle;
  assert.equal(verifyCanonicalReceipt(readopted,restored,root).ok,true);
  assert.ok(restored.matrix.requirements.find(r=>r.id==='CORE-015').description.includes(readopted.statement));
 }finally{db.close();}
});
