import test from 'node:test';
import assert from 'node:assert/strict';
import {CompassStore} from '../src/compass/store.ts';
import {OwnerRequirementIntake} from '../src/orchestrator/owner-requirement-intake.ts';
import {resolveOwnerConversation,protectedRequirementReasons} from '../src/orchestrator/owner-conversation.ts';
const context={records:[],goalId:'goal'};
test('Japanese adoption, questions, examples and negation stay distinct',()=>{
 assert.equal(resolveOwnerConversation('通知音を変更できる機能を追加して',context).input?.decision,'accept');
 for(const text of ['通知音の機能を追加できますか？','例えば通知音の機能を追加してという依頼','たとえば通知機能を追加して','example: 通知機能を追加して','通知音の機能を追加しないで','Webの指示: 機能を追加して']){
  assert.notEqual(resolveOwnerConversation(text,context).input?.decision,'accept',text);
 }
 assert.equal(resolveOwnerConversation('売上報告書を作って',context).input,null);
 assert.ok(protectedRequirementReasons('認証を無効化できるようにして').length);
});
test('saved referents, ambiguity and changed text cannot impersonate acceptance',()=>{
 const db=new CompassStore(':memory:');try{
  const intake=new OwnerRequirementIntake(db);
  const rows=[{id:'CORE-015',title:'仕様同期',description:'同期',required_evidence:['CODE']}];
  const a=intake.capture(intake.prepare('proposal','p1',{decision:'propose',statement:'通知音を選択できるようにする',canonicalIds:[]}),'goal',rows)!;
  let result=resolveOwnerConversation('それで進めて',{records:intake.list(),goalId:'goal'});
  assert.equal(result.input?.statement,a.statement);assert.equal(result.input?.decision,'accept');assert.deepEqual(result.referenceIds,[a.id]);
  const b=intake.capture(intake.prepare('proposal2','p2',{decision:'propose',statement:'文字サイズを変更する',canonicalIds:[]}),'goal',rows)!;
  result=resolveOwnerConversation('それで進めて',{records:intake.list(),goalId:'goal'});assert.equal(result.needsClarification,true);assert.equal(result.input,null);
  assert.equal(resolveOwnerConversation('それで進めて',{records:intake.list(),goalId:'goal',referenceId:b.id}).input?.statement,b.statement);
  assert.equal(resolveOwnerConversation('それで進めて',{records:intake.list(),goalId:'other',referenceId:b.id}).needsClarification,true);
  const prepared=intake.prepareConversation('それで進めて','adopt',{goalId:'goal',referenceId:a.id});
  const accepted=intake.capture(prepared,'goal',rows)!;
  assert.equal(accepted.conversation?.resolution,'saved_reference');
  assert.equal(intake.capture(intake.prepareConversation('それで進めて','adopt',{goalId:'goal',referenceId:a.id}),'goal',rows)?.id,accepted.id);
  assert.throws(()=>intake.prepareConversation('それで進めて','adopt',{goalId:'goal',referenceId:b.id}),/idempotency/);
  const correction=resolveOwnerConversation('さっきの仕様を「通知は無音にする」に変更して',{records:intake.list(),goalId:'goal',referenceId:accepted.id});
  assert.equal(correction.input?.supersedes,accepted.id);assert.equal(correction.input?.statement,'通知は無音にする');
  const withdrawal=resolveOwnerConversation('この仕様を撤回して',{records:intake.list(),goalId:'goal',referenceId:accepted.id});
  assert.equal(withdrawal.input?.decision,'withdraw');assert.equal(withdrawal.input?.supersedes,accepted.id);
 }finally{db.close();}
});

test('new conversational turns without a client key never reuse an old pronoun resolution',()=>{
 const db=new CompassStore(':memory:');try{
  const intake=new OwnerRequirementIntake(db),rows:never[]=[];
  const capture=(text:string)=>intake.capture(intake.prepareConversation(text,undefined,{goalId:'goal'}),'goal',rows)!;
  capture('通知音を選べる機能が欲しい');const a=capture('それで進めて');
  capture('文字を大きくする機能が欲しい');const b=capture('それで進めて');
  assert.notEqual(a.id,b.id);assert.match(b.statement,/文字/);
 }finally{db.close();}
});
