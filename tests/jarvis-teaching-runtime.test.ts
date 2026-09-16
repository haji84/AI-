import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JarvisRemoteAssistSessionManager } from '../src/jarvis/remote-assist.ts';
import { TeachingStore } from '../src/jarvis/teaching.ts';
import { teachingAdapter, teachingCommand, beforeTeachingInput } from '../src/jarvis/teaching-runtime.ts';
test('teaching transport rejects missing/mismatched/view-only/ended sessions before gateway calls',async()=>{
 const sessions=new JarvisRemoteAssistSessionManager();let calls=0;const gateway=async()=>{calls++;return Response.json({});};
 const view=sessions.start({serial:'a',capability:'VIEW_ONLY'});
 await assert.rejects(teachingAdapter('a',view.id,sessions,gateway).observe(),/view-only/);
 const full=sessions.start({serial:'a',capability:'CONTROLLABLE'});
 await assert.rejects(teachingAdapter('b',full.id,sessions,gateway).observe());
 sessions.end(full.id);await assert.rejects(teachingAdapter('a',full.id,sessions,gateway).observe());assert.equal(calls,0);
});
test('recording hooks save observed actions and reject overlapping replay/control; failure cancels draft',async()=>{
 const root=mkdtempSync(join(tmpdir(),'teaching-runtime-'));const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const previous=shared.__jarvisTeachingStore;
 try{
  const store=new TeachingStore(join(root,'store.json'));shared.__jarvisTeachingStore=store;
  const sessions=new JarvisRemoteAssistSessionManager();const session=sessions.start({serial:'a',capability:'CONTROLLABLE'});
  let signature='before';const observation=()=>({signature,profile:{deviceId:'a',platform:'android',model:'Phone',osVersion:'15',app:'app',appVersion:'1'},targets:[],protectedScreen:false});
  const gateway=async()=>Response.json(observation());
  const start=await teachingCommand({action:'teach-start',serial:'a',sessionId:session.id,goal:'Navigate',scope:'device'},sessions,gateway);assert(start.variant);
  const capture=await beforeTeachingInput({action:'keyevent',key:'HOME',serial:'a',sessionId:session.id},sessions,gateway);assert(capture);
  await assert.rejects(beforeTeachingInput({action:'keyevent',key:'BACK',serial:'a',sessionId:session.id},sessions,gateway),/busy/);
  signature='after';await capture.finish(true);capture.release();
  const finish=await teachingCommand({action:'teach-finish',serial:'a',sessionId:session.id,completion:'home visible'},sessions,gateway);assert.equal(finish.variant?.steps.length,1);assert.equal(finish.variant?.status,'DRAFT');
  await teachingCommand({action:'teach-start',serial:'a',sessionId:session.id,goal:'Retry',scope:'device'},sessions,gateway);
  const failed=await beforeTeachingInput({action:'text',text:'never persist',serial:'a',sessionId:session.id},sessions,gateway);assert(failed);await failed.finish(false);assert.equal(store.recording(session.id),null);assert(!JSON.stringify(store.list()).includes('never persist'));
 }finally{shared.__jarvisTeachingStore=previous;rmSync(root,{recursive:true,force:true});}
});
