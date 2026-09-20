import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TeachingStore, replayTeaching, type DeviceProfile } from '../src/jarvis/teaching.ts';
import { TeachingLessonStore, lessonCommand, lessonLibrary } from '../src/jarvis/teaching-lessons.ts';
const profile:DeviceProfile={deviceId:'a',platform:'android',model:'phone',osVersion:'8',app:'settings',appVersion:'1'};
function setup(){const root=mkdtempSync(join(tmpdir(),'jarvis-lessons-'));const file=join(root,'teaching.json');const store=new TeachingStore(file);const lessons=new TeachingLessonStore(join(root,'lessons.json'));return {root,file,store,lessons};}
function variant(store:TeachingStore,p=profile){const v=store.start({goal:'Home',scope:'device',profile:p,sessionId:crypto.randomUUID()});store.append(v.id,{action:{kind:'key',key:'HOME'},before:'a',after:'b',gate:false});return store.finish(v.id,'Home visible','b');}
async function verified(store:TeachingStore,id:string){for(let n=0;n<3;n++){let screen='a';await replayTeaching(store,id,{authorize(){},async observe(){return {profile,signature:screen,targets:[],protectedScreen:false};},async execute(){screen='b';}},'verify');}}

test('explicit correction persists without modifying original demonstrations',()=>{const f=setup();try{
 const wrong=variant(f.store),fixed=variant(f.store);const before=readFileSync(f.file,'utf8');
 const c=f.lessons.correct(f.store,wrong.id,fixed.id,'operation-error');
 assert.equal(c.source,'OWNER_CONFIRMED');assert.equal(readFileSync(f.file,'utf8'),before);
 const restored=new TeachingLessonStore(join(f.root,'lessons.json'));
 const report=lessonLibrary(f.store,restored);
 assert.equal(report.learningCandidates.find(c=>c.variantId===wrong.id)?.correctionState,'CONFIRMED_MISTAKE');
 assert.equal(report.learningCandidates.find(c=>c.variantId===fixed.id)?.correctionState,'CORRECTED');
 assert.throws(()=>restored.correct(f.store,fixed.id,wrong.id,'operation-error'),/cycle|supersed/i);
 }finally{rmSync(f.root,{recursive:true,force:true});}});

test('cross-device, scope, self and unrelated correction are rejected',()=>{const f=setup();try{
 const a=variant(f.store),b=variant(f.store,{...profile,deviceId:'b'});
 assert.throws(()=>f.lessons.correct(f.store,a.id,b.id,'operation-error'),/profile|device/i);
 assert.throws(()=>f.lessons.correct(f.store,a.id,a.id,'operation-error'));
 assert.throws(()=>f.lessons.correct(f.store,a.id,b.id,'invented'));
 }finally{rmSync(f.root,{recursive:true,force:true});}});

test('skills require verified evidence and revalidate saved identity on reuse',async()=>{const f=setup();try{
 const v=variant(f.store);assert.throws(()=>f.lessons.saveSkill(f.store,v.id),/verif/i);
 await verified(f.store,v.id);const skill=f.lessons.saveSkill(f.store,v.id);
 assert.equal(f.lessons.saveSkill(f.store,v.id).id,skill.id);
 const restored=new TeachingLessonStore(join(f.root,'lessons.json'));
 assert.equal(restored.resolveSkill(f.store,skill.id,profile).id,v.id);
 assert.throws(()=>restored.resolveSkill(f.store,skill.id,{...profile,deviceId:'b'}),/device|profile/i);
 const corrected=variant(f.store);restored.correct(f.store,v.id,corrected.id,'operation-error');
 assert.throws(()=>restored.resolveSkill(f.store,skill.id,profile),/supersed|verif/i);
 }finally{rmSync(f.root,{recursive:true,force:true});}});

test('auth denied before any lesson/store access and foreign origins rejected',async()=>{
 let reads=0;const deps={authorize:async()=>false,store:()=>{reads++;throw Error('no');},lessons:()=>{reads++;throw Error('no');}};
 const req=new Request('http://localhost/api/jarvis/teaching',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save-skill',variantId:'a'})});
 assert.equal((await lessonCommand(req,deps)).status,401);assert.equal(reads,0);
 const foreign=new Request('http://localhost/api/jarvis/teaching',{method:'POST',headers:{Origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'});
 assert.equal((await lessonCommand(foreign,{...deps,authorize:async()=>true})).status,403);assert.equal(reads,0);
});

test('sidecar corruption and competing writer fail visibly; no fake empty library',()=>{const f=setup();try{
 const v=variant(f.store);writeFileSync(join(f.root,'lessons.json'),'invalid');assert.throws(()=>f.lessons.list());
 writeFileSync(join(f.root,'lessons.json'),JSON.stringify({version:1,corrections:[],skills:[]}));writeFileSync(join(f.root,'lessons.json.lock'),'busy');
 assert.throws(()=>f.lessons.correct(f.store,v.id,variant(f.store).id,'operation-error'));
 }finally{rmSync(f.root,{recursive:true,force:true});}});
import { teachingCommand } from '../src/jarvis/teaching-runtime.ts';
import { JarvisRemoteAssistSessionManager } from '../src/jarvis/remote-assist.ts';

test('saved Skill traverses real teaching command and existing session/screen gates',async()=>{const f=setup();const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const old=shared.__jarvisTeachingStore,oldPath=process.env.JARVIS_TEACHING_LESSONS_PATH;try{
 shared.__jarvisTeachingStore=f.store;process.env.JARVIS_TEACHING_LESSONS_PATH=join(f.root,'lessons.json');
 const v=variant(f.store);await verified(f.store,v.id);const skill=f.lessons.saveSkill(f.store,v.id);
 const sessions=new JarvisRemoteAssistSessionManager(),session=sessions.start({serial:'a',capability:'CONTROLLABLE'});
 let screen='a',inputs=0;
 const gateway=async(path:string)=>{if(path.endsWith('teach-input')){screen='b';inputs++;return Response.json({ok:true});}return Response.json({profile,signature:screen,targets:[],protectedScreen:false});};
 const result=await teachingCommand({action:'teach-execute',serial:'a',sessionId:session.id,skillId:skill.id},sessions,gateway);
 assert.equal(result.run?.status,'PASSED');assert.equal(inputs,1);
 sessions.end(session.id);await assert.rejects(teachingCommand({action:'teach-execute',serial:'a',sessionId:session.id,skillId:skill.id},sessions,gateway));assert.equal(inputs,1);
 const later=sessions.start({serial:'a',capability:'CONTROLLABLE'}),fixed=variant(f.store);
 f.lessons.correct(f.store,v.id,fixed.id,'operation-error');
 await assert.rejects(teachingCommand({action:'teach-execute',serial:'a',sessionId:later.id,variantId:v.id},sessions,gateway),/supersed/i);assert.equal(inputs,1);
 }finally{shared.__jarvisTeachingStore=old;if(oldPath===undefined)delete process.env.JARVIS_TEACHING_LESSONS_PATH;else process.env.JARVIS_TEACHING_LESSONS_PATH=oldPath;rmSync(f.root,{recursive:true,force:true});}});

test('tampered source observations invalidate correction and saved skill evidence',async()=>{const f=setup();try{
 const a=variant(f.store),b=variant(f.store);f.lessons.correct(f.store,a.id,b.id,'operation-error');await verified(f.store,b.id);const skill=f.lessons.saveSkill(f.store,b.id);
 const data=JSON.parse(readFileSync(f.file,'utf8'));data.variants.find((v:{id:string})=>v.id===b.id).completion='changed acceptance';writeFileSync(f.file,JSON.stringify(data));
 const changed=new TeachingStore(f.file);
 assert.throws(()=>f.lessons.resolveSkill(changed,skill.id,profile),/stale/i);
 assert.equal(lessonLibrary(changed,f.lessons).skills[0].status,'NEEDS_VALIDATION');
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('correction arriving during observation stops the obsolete input',async()=>{const f=setup();const shared=globalThis as typeof globalThis & {__jarvisTeachingStore?:TeachingStore};const old=shared.__jarvisTeachingStore,oldPath=process.env.JARVIS_TEACHING_LESSONS_PATH;try{
 shared.__jarvisTeachingStore=f.store;process.env.JARVIS_TEACHING_LESSONS_PATH=join(f.root,'lessons.json');
 const v=variant(f.store),fixed=variant(f.store);await verified(f.store,v.id);const skill=f.lessons.saveSkill(f.store,v.id);
 const sessions=new JarvisRemoteAssistSessionManager(),session=sessions.start({serial:'a',capability:'CONTROLLABLE'});let observations=0,inputs=0,screen='a';
 const gateway=async(path:string)=>{if(path.endsWith('teach-input')){inputs++;screen='b';}else if(++observations===2){f.lessons.correct(f.store,v.id,fixed.id,'operation-error');}return Response.json({profile,signature:screen,targets:[],protectedScreen:false});};
 const result=await teachingCommand({action:'teach-execute',serial:'a',sessionId:session.id,skillId:skill.id},sessions,gateway);
 assert.equal(inputs,0);assert.notEqual(result.run?.status,'PASSED');
 }finally{shared.__jarvisTeachingStore=old;if(oldPath===undefined)delete process.env.JARVIS_TEACHING_LESSONS_PATH;else process.env.JARVIS_TEACHING_LESSONS_PATH=oldPath;rmSync(f.root,{recursive:true,force:true});}});
test('same destination works through an internal reverse-proxy URL; forwarded host cannot authorize foreign origin',async()=>{
 const deps={authorize:async()=>true,store:()=>{throw Error('expected validation after origin');},lessons:()=>{throw Error('no');}};
 const request=(origin:string)=>new Request('http://localhost/api/jarvis/teaching',{method:'POST',headers:{host:'jarvis.private.test',origin,'content-type':'application/json','x-forwarded-host':'evil.test'},body:'{}'});
 assert.equal((await lessonCommand(request('https://jarvis.private.test'),deps)).status,409);
 assert.equal((await lessonCommand(request('https://evil.test'),deps)).status,403);
});
