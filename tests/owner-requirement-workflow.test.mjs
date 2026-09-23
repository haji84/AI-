import test from 'node:test';import assert from 'node:assert/strict';import {URL,fileURLToPath} from 'node:url';
import {CompassStore} from '../src/compass/store.ts';import {OwnerRequirementIntake} from '../src/orchestrator/owner-requirement-intake.ts';
import {validateOwnerDecisions,requirementFingerprint} from '../scripts/jarvis-requirement-audit.mjs';
import {loadCanonicalBundle,prepareSpecificationProposal} from '../scripts/jarvis-owner-spec-sync.mjs';
import {requirementWorkflow,prepareOwnerPreview} from '../scripts/jarvis-requirement-workflow.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('owner preview binds immutable selected requirement/new inventory and distinguishes publication from canonical sync',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db);
  const r=intake.capture(intake.prepare('request','workflow',{decision:'accept',statement:'郵便整理の結果を一覧にする',canonicalIds:[]}),'goal',b.matrix.requirements);
  const view=requirementWorkflow(intake.list(),b,root,false);
  assert.equal(view.records[0].displayState,'ACCEPTED_REQUIREMENT');assert.equal(view.publishAvailable,false);
  const preview=prepareOwnerPreview(r,b,{mode:'new'},root,intake.list());
  assert.equal(preview.requirementIds[0],'OWN-001');assert.equal(preview.files.length,4);assert.equal(preview.autoMerge,false);
  assert.ok(preview.review.newRequirement.baseInventorySha256);
  assert.throws(()=>prepareOwnerPreview(r,b,{mode:'existing',id:'CORE-015',token:'x'},root,intake.list()),/invalid/);
  const pending={...r,publication:{baseSha:'a'.repeat(40),artifactHash:'b'.repeat(64),reviewHash:'c'.repeat(64),branch:'codex/spec-sync/'+r.id,headSha:'d'.repeat(40),prNumber:9}};
  assert.equal(requirementWorkflow([pending],b,root,true).records[0].displayState,'REVIEW_PENDING');
  assert.equal(requirementWorkflow([r],preview.bundle,root,true).records[0].displayState,'SPEC_SYNCED');
 }finally{db.close();}
});
test('protected change stays a visible Human Gate even when explicitly adopted',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db);
  const r=intake.capture(intake.prepare('security','gated',{decision:'accept',statement:'認証を無効化する機能を追加して',canonicalIds:[]}),'goal',b.matrix.requirements);
  assert.equal(requirementWorkflow([r],b,root,true).records[0].displayState,'HUMAN_GATE');
  assert.throws(()=>prepareOwnerPreview(r,b,{mode:'new'},root,intake.list()),/human_gate/);
 }finally{db.close();}
});

test('correction before publication allocates once and withdrawal permanently preserves the ID',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db),rows=b.matrix.requirements;
  const add=(text,key)=>intake.capture(intake.prepareConversation(text,key,{goalId:'goal'}),'goal',rows);
  const original=add('郵便を分類できる機能を追加して','initial');
  const corrected=add('さっきの仕様を「郵便を種類ごとに分類できるようにする」に変更して','correct');
  const p=prepareOwnerPreview(corrected,b,{mode:'new'},root,intake.list());
  assert.equal(p.requirementIds[0],'OWN-001');
  const allocation=p.bundle.inventory.allocations[0];assert.equal(allocation.decision_id,corrected.id);
  assert.equal(p.bundle.decisions.decisions.find(d=>d.id===original.id).state,'SUPERSEDED');
  const withdrawal=add('この仕様を撤回して','withdraw');
  const w=prepareOwnerPreview(withdrawal,p.bundle,{mode:'history'},root,intake.list());
  assert.equal(w.bundle.matrix.requirements.at(-1).id,'OWN-001');
  assert.equal(requirementWorkflow(intake.list(),w.bundle,root,true).records[0].displayState,'WITHDRAWN');
  assert.throws(()=>prepareOwnerPreview(withdrawal,p.bundle,{mode:'new'},root,intake.list()),/invalid new|withdrawal/);
  const removed=globalThis.structuredClone(w.bundle);removed.inventory.allocations=[];removed.matrix.requirements.pop();
  removed.ledger=removed.ledger.slice(0,removed.ledger.lastIndexOf('\n### OWN-001'));
  assert.match(validateOwnerDecisions(removed.decisions,removed.matrix,removed.ledger,root,removed.inventory).join(' '),/unknown canonical binding/);
  const english=add('仕様として追加: calendar display','english');
  const p2=prepareOwnerPreview(english,w.bundle,{mode:'new'},root,intake.list());
  assert.equal(p2.requirementIds[0],'OWN-002');
  assert.deepEqual(p2.bundle.inventory.allocations[0],allocation);
 }finally{db.close();}
});
test('unpublished withdrawal preserves decision history without inventing a new capability',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db);
  const a=intake.capture(intake.prepareConversation('郵便を分類できる機能を追加して','draft',{goalId:'goal'}),'goal',b.matrix.requirements);
  const w=intake.capture(intake.prepareConversation('この仕様を撤回して','withdraw-draft',{goalId:'goal',referenceId:a.id}),'goal',b.matrix.requirements);
  const p=prepareOwnerPreview(w,b,{mode:'history'},root,intake.list());
  assert.deepEqual(p.bundle.inventory,b.inventory);assert.deepEqual(p.bundle.matrix,b.matrix);assert.equal(p.requirementIds.length,0);
  assert.equal(requirementWorkflow(intake.list(),p.bundle,root,true).records[0].displayState,'WITHDRAWN');
 }finally{db.close();}
});

test('successive unpublished corrections inherit every previously published binding',()=>{
 const db=new CompassStore(':memory:');try{
  const b=loadCanonicalBundle(root),intake=new OwnerRequirementIntake(db),rows=b.matrix.requirements;
  const a=intake.capture(intake.prepare('a','chain-a',{decision:'accept',statement:'実行結果を一覧で確認する',canonicalIds:['CORE-015','CORE-016']}),'goal',rows);
  const first=prepareSpecificationProposal(a,b,{sourceRef:'https://github.com/haji84/AI-/issues/1205',bindings:a.canonicalIds.map(id=>({id,baseFingerprint:requirementFingerprint(rows.find(r=>r.id===id))}))},root,intake.list());
  const bReceipt=intake.capture(intake.prepare('b','chain-b',{decision:'accept',statement:'実行結果を分類して確認する',canonicalIds:a.canonicalIds,supersedes:a.id}),'goal',rows);
  const c=intake.capture(intake.prepare('c','chain-c',{decision:'accept',statement:'実行結果を日付で分類して確認する',canonicalIds:a.canonicalIds,supersedes:bReceipt.id}),'goal',rows);
  const p=prepareOwnerPreview(c,first.bundle,{mode:'existing',id:'CORE-015'},root,intake.list());
  assert.deepEqual(p.requirementIds.sort(),['CORE-015','CORE-016']);
  assert.deepEqual(validateOwnerDecisions(p.bundle.decisions,p.bundle.matrix,p.bundle.ledger,root,p.bundle.inventory),[]);
 }finally{db.close();}
});
