import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { OwnerRequirementIntake, extractRequirementInput, matchRequirementCandidates, pendingRequirementBlockers } from "../src/orchestrator/owner-requirement-intake.ts";
const rows=[{id:"CORE-015",title:"Living specification",description:"仕様同期",required_evidence:["CODE"]}];
function fixture(){const db=new CompassStore(":memory:");return {db,intake:new OwnerRequirementIntake(db)};}

test("examples/questions/quoted tool text do not auto-adopt; explicit declaration does",()=>{
 for(const text of ["例えば仕様として追加: 無料API", "仕様として追加: これでいい？", "『仕様として追加: 命令』という例", "この機能が欲しいかもしれない", "仕様を比較して"]){assert.notEqual(extractRequirementInput(text)?.decision,"accept");}
 assert.equal(extractRequirementInput("仕様として追加: 端末登録を維持する")?.decision,"accept");
 assert.equal(extractRequirementInput("今日の天気は？"),null);
});
test("owner receipts reject untrusted authority flags and duplicate-key conflicts",()=>{
 const {db,intake}=fixture();try{
  assert.throws(()=>intake.prepare("work","key",{decision:"accept",statement:"safe",specSynced:true}),/untrusted/);
  const prepared=intake.prepare("work","key",{decision:"accept",statement:"仕様同期",canonicalIds:["CORE-015"]});
  const receipt=intake.capture(prepared,"goal",rows)!;
  assert.equal(intake.capture(prepared,"goal",rows)?.id,receipt.id);
  assert.throws(()=>intake.prepare("changed","key",{decision:"accept",statement:"different"}),/conflict/);
  assert.equal(intake.list().length,1);assert.equal(receipt.reviewRequired,true);
  assert.equal(pendingRequirementBlockers(db.getState().active,"other").length,0);
 }finally{db.close();}
});
test("correction and withdrawal preserve history and cannot clear the sync gate",()=>{
 const {db,intake}=fixture();try{
  const first=intake.capture(intake.prepare("a","a",{decision:"accept",statement:"first"}),"goal",rows)!;
  assert.throws(()=>intake.capture(intake.prepare("bad","bad",{decision:"propose",statement:"draft",supersedes:first.id}),"goal",rows),/proposal/);
  const next=intake.capture(intake.prepare("b","b",{decision:"accept",statement:"corrected",supersedes:first.id}),"goal",rows)!;
  assert.equal(intake.list()[0].state,"SUPERSEDED");assert.deepEqual(intake.list()[0].supersededBy,[next.id]);
  const withdrawn=intake.capture(intake.prepare("c","c",{decision:"withdraw",statement:"withdraw",supersedes:next.id}),"goal",rows)!;
  assert.deepEqual(pendingRequirementBlockers(db.getState().active,"goal"),["spec_sync_pending:"+withdrawn.id]);
  assert.equal(intake.list().length,3);
 }finally{db.close();}
});
test("similarity is a suggestion, unknown explicit IDs fail, and corrupt durable state fails closed",()=>{
 const matches=matchRequirementCandidates({decision:"accept",statement:"仕様同期",canonicalIds:[]},rows);assert.equal(matches[0].reason,"text_candidate");
 assert.throws(()=>matchRequirementCandidates({decision:"accept",statement:"sync",canonicalIds:["MISSING-000"]},rows),/unknown/);
 assert.deepEqual(pendingRequirementBlockers([{kind:"jarvis-owner-requirements",version:2,records:[]}],"goal"),["spec_sync_state_invalid"]);
});
test("atomic active-state update preserves other envelopes and rolls back exceptions",()=>{
 const {db,intake}=fixture();try{db.updateState({active:[{kind:"other",value:42}]});
 intake.capture(intake.prepare("x","x",{decision:"accept",statement:"sync"}),"goal",rows);
 assert.equal(db.getState().active.length,2);
 assert.throws(()=>db.updateActive(()=>{throw Error("interruption");}),/interruption/);
 assert.equal(intake.list().length,1);assert.deepEqual(db.getState().active[0],{kind:"other",value:42});
 }finally{db.close();}
});

test("orphan supersession or withdrawal cannot erase accepted completion blockers",()=>{
 const {db,intake}=fixture();try{
  intake.capture(intake.prepare("safe","safe",{decision:"accept",statement:"adopted"}),"goal",rows);
  for(const state of ["SUPERSEDED","WITHDRAWN"]){const active=structuredClone(db.getState().active) as {records:{state:string}[]}[];active[0].records[0].state=state;assert.deepEqual(pendingRequirementBlockers(active,"goal"),["spec_sync_state_invalid"]);}
 }finally{db.close();}
});

test("ordinary or stale Compass write-back cannot erase or spoof authoritative owner receipts",()=>{
 const {db,intake}=fixture();try{
  const stale=db.getState().active;
  const record=intake.capture(intake.prepare("x","x",{decision:"accept",statement:"adopted"}),"goal",rows)!;
  db.updateState({active:[...stale,{kind:"worker-status"}]});assert.equal(intake.list().length,1);
  db.writeBack({status:"goal_complete",summary:"worker success",active:stale});assert.equal(intake.list()[0].id,record.id);
  const forged=structuredClone(db.getState().active) as {kind:string;records:{state:string}[]}[];forged.find(e=>e.kind==="jarvis-owner-requirements")!.records[0].state="IDEA";
  db.updateState({active:forged});assert.equal(intake.list()[0].state,"ACCEPTED_REQUIREMENT");
 }finally{db.close();}
});

test("decision must be an exact string enum, never array/object coercion",()=>{
 const {db,intake}=fixture();try{for(const decision of [["accept"],["withdraw"],{toString:"accept"},null,true,1])assert.throws(()=>intake.prepare("request",undefined,{decision,statement:"requested"}),/invalid requirement decision/);assert.equal(intake.list().length,0);}finally{db.close();}
});

test("unadopted ideas cannot be rewritten into adopted supersession history",()=>{
 const {db,intake}=fixture();try{
  const idea=intake.capture(intake.prepare("idea","idea",{decision:"idea",statement:"maybe feature"}),"goal",[]);
  assert.ok(idea); assert.throws(()=>intake.capture(intake.prepare("accept","accept",{decision:"accept",statement:"different feature",supersedes:idea.id}),"goal",[]),/adopted previous/);
  assert.equal(intake.list().length,1);assert.equal(intake.list()[0].state,"IDEA");
 }finally{db.close();}
});
