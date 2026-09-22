import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeachingStore, profileKey, type DeviceProfile, type Observation } from "../src/jarvis/teaching.ts";
import { teachingCommand, beforeTeachingInput } from "../src/jarvis/teaching-runtime.ts";
import { JarvisRemoteAssistSessionManager } from "../src/jarvis/remote-assist.ts";

const profile: DeviceProfile = {deviceId:"fixture",platform:"android",model:"test",osVersion:"8",app:"neutral",appVersion:"1"};
const observe = (signature:string):Observation=>({signature,profile,targets:[],protectedScreen:false});
function fixture(){const file=join(mkdtempSync(join(tmpdir(),"teaching-correction-")),"teaching.json");const store=new TeachingStore(file);const v=store.start({goal:"Navigate",scope:"device",profile,sessionId:"session"});store.append(v.id,{action:{kind:"key",key:"HOME"},before:"start",after:"wrong",gate:false,contextKey:profileKey(profile)});return {file,store,v};}
test("correction waits for original screen/profile and retains mistaken provenance",()=>{
 const {file,store,v}=fixture();
 store.requestCorrection(v.id);
 assert.throws(()=>store.finish(v.id,"done","wrong"),/correction/i);
 assert.equal(store.resumeCorrection(v.id,observe("other")),false);
 assert.equal(store.resumeCorrection(v.id,{...observe("start"),protectedScreen:true}),false);
 assert.equal(store.resumeCorrection(v.id,{...observe("start"),profile:{...profile,deviceId:"other"}}),false);
 assert.equal(store.resumeCorrection(v.id,observe("start")),true);
 assert.equal(store.get(v.id).steps.length,0);
 store.append(v.id,{action:{kind:"key",key:"BACK"},before:"start",after:"done",gate:false});
 const completed=store.finish(v.id,"done","done");
 assert.deepEqual(completed.steps.map(s=>s.action),[{kind:"key",key:"BACK"}]);
 const persisted=JSON.parse(readFileSync(file,"utf8")).variants[0];
 assert.equal(persisted.learning.events.filter((e:{kind:string})=>e.kind==="ERROR").length,1);
 assert.equal(persisted.learning.archive["1"].action.key,"HOME");
 assert.equal(new TeachingStore(file).get(v.id).status,"DRAFT");
});
test("normal Back remains an action and correction cannot edit finished/verified procedures",()=>{
 const {store,v}=fixture();
 store.append(v.id,{action:{kind:"key",key:"BACK"},before:"wrong",after:"start",gate:false});
 assert.equal(store.get(v.id).steps.length,2);
 store.finish(v.id,"at start","start");
 assert.throws(()=>store.requestCorrection(v.id));
});
test("actual teaching command/input path excludes return navigation from corrected steps",async()=>{
 const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const previous=shared.__jarvisTeachingStore;
 const file=join(mkdtempSync(join(tmpdir(),"teaching-runtime-correction-")),"state.json");const store=new TeachingStore(file);shared.__jarvisTeachingStore=store;
 try{
  const sessions=new JarvisRemoteAssistSessionManager();const session=sessions.start({serial:"fixture",capability:"CONTROLLABLE"});
  let screen="start";const gateway=async()=>Response.json(observe(screen));const base={serial:"fixture",sessionId:session.id};
  const started=await teachingCommand({...base,action:"teach-start",goal:"Navigate",scope:"device"},sessions,gateway);
  const wrong=await beforeTeachingInput({...base,action:"keyevent",key:"HOME"},sessions,gateway);screen="wrong";await wrong!.finish(true);
  await teachingCommand({...base,action:"teach-correct"},sessions,gateway);
  const undo=await beforeTeachingInput({...base,action:"keyevent",key:"BACK"},sessions,gateway);screen="start";await undo!.finish(true);
  const correct=await beforeTeachingInput({...base,action:"keyevent",key:"APP_SWITCH"},sessions,gateway);screen="done";await correct!.finish(true);
  await teachingCommand({...base,action:"teach-finish",completion:"done"},sessions,gateway);
  assert.deepEqual(store.get(started.variant!.id).steps.map(s=>s.action),[{kind:"key",key:"APP_SWITCH"}]);
  sessions.end(session.id);await assert.rejects(teachingCommand({...base,action:"teach-correct"},sessions,gateway));
 }finally{shared.__jarvisTeachingStore=previous;}
});


test("teaching runtime persists candidates, certifies only distinct verifies, and reuses guarded Skill references",async()=>{
 const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const previous=shared.__jarvisTeachingStore;
 const dir=mkdtempSync(join(tmpdir(),"teaching-wired-"));const oldPath=process.env.JARVIS_SKILLS_PATH;process.env.JARVIS_SKILLS_PATH=join(dir,"skills.json");
 const store=new TeachingStore(join(dir,"teaching.json"));shared.__jarvisTeachingStore=store;
 try{
  const sessions=new JarvisRemoteAssistSessionManager();const session=sessions.start({serial:"fixture",capability:"CONTROLLABLE"});
  const v=store.start({goal:"Navigate",scope:"device",profile,sessionId:session.id});store.append(v.id,{action:{kind:"key",key:"HOME"},before:"start",after:"done",gate:false});store.finish(v.id,"done","done");
  let screen="start",inputs=0;const gateway=async(path:string)=>{if(path.endsWith("teach-input")){inputs++;screen="done";return Response.json({ok:true});}return Response.json(observe(screen));};
  const base={serial:"fixture",sessionId:session.id,variantId:v.id};
  const first=await teachingCommand({...base,action:"teach-verify",learning:{status:"active"}},sessions,gateway);
  assert.equal(first.run?.status,"PASSED");assert.equal(first.learning?.status,"candidate");
  screen="start";const second=await teachingCommand({...base,action:"teach-verify"},sessions,gateway);assert.equal(second.learning?.status,"active");
  screen="start";const result=await teachingCommand({...base,action:"teach-execute"},sessions,gateway);assert.equal(result.learning?.reused,true);assert.equal(inputs,3);
  sessions.end(session.id);await assert.rejects(teachingCommand({...base,action:"teach-execute"},sessions,gateway));assert.equal(inputs,3);
 }finally{shared.__jarvisTeachingStore=previous;if(oldPath===undefined)delete process.env.JARVIS_SKILLS_PATH;else process.env.JARVIS_SKILLS_PATH=oldPath;}
});


test("correction on an already restored screen records the next real action",async()=>{
 const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const previous=shared.__jarvisTeachingStore;
 const store=new TeachingStore(join(mkdtempSync(join(tmpdir(),"correction-noop-")),"state.json"));shared.__jarvisTeachingStore=store;
 try{
  const sessions=new JarvisRemoteAssistSessionManager();const session=sessions.start({serial:"fixture",capability:"CONTROLLABLE"});
  const v=store.start({goal:"Navigate",scope:"device",profile,sessionId:session.id});store.append(v.id,{action:{kind:"key",key:"HOME"},before:"start",after:"start",gate:false});store.requestCorrection(v.id);
  let screen="start";const gateway=async()=>Response.json(observe(screen));const capture=await beforeTeachingInput({serial:"fixture",sessionId:session.id,action:"keyevent",key:"APP_SWITCH"},sessions,gateway);
  screen="done";await capture!.finish(true);assert.equal(store.get(v.id).learning?.pendingCorrection,undefined);
  assert.deepEqual(store.get(v.id).steps.map(s=>s.action),[{kind:"key",key:"APP_SWITCH"}]);
 }finally{shared.__jarvisTeachingStore=previous;}
});

test("corrupt optional Skill storage does not replay twice or block a verified legacy procedure",async()=>{
 const {writeFileSync}=await import('node:fs');const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const previous=shared.__jarvisTeachingStore;
 const dir=mkdtempSync(join(tmpdir(),"correction-storage-"));const oldPath=process.env.JARVIS_SKILLS_PATH;process.env.JARVIS_SKILLS_PATH=join(dir,"skills.json");writeFileSync(process.env.JARVIS_SKILLS_PATH,"invalid json");
 const store=new TeachingStore(join(dir,"state.json"));shared.__jarvisTeachingStore=store;
 try{
  const sessions=new JarvisRemoteAssistSessionManager();const session=sessions.start({serial:"fixture",capability:"CONTROLLABLE"});
  const v=store.start({goal:"Navigate",scope:"device",profile,sessionId:session.id});store.append(v.id,{action:{kind:"key",key:"HOME"},before:"start",after:"done",gate:false});store.finish(v.id,"done","done");
  let screen="start",inputs=0;const gateway=async(path:string)=>{if(path.endsWith('teach-input')){screen='done';inputs++;return Response.json({ok:true});}return Response.json(observe(screen));};
  const base={serial:'fixture',sessionId:session.id,variantId:v.id};
  const verify=await teachingCommand({...base,action:'teach-verify'},sessions,gateway);assert.equal(verify.run?.status,'PASSED');assert.equal(verify.learning?.status,'error');
  screen='start';const result=await teachingCommand({...base,action:'teach-execute'},sessions,gateway);assert.equal(result.run?.status,'PASSED');assert.equal(result.learning?.status,'error');assert.equal(inputs,2);
 }finally{shared.__jarvisTeachingStore=previous;if(oldPath===undefined)delete process.env.JARVIS_SKILLS_PATH;else process.env.JARVIS_SKILLS_PATH=oldPath;}
});
