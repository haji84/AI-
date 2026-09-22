import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeachingStore, replayTeaching, type DeviceProfile, type TeachingAdapter } from "../src/jarvis/teaching.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { publishTeachingSkill, teachingSkillId, resolveTeachingSkill } from "../src/jarvis/teaching-skills.ts";
const profile:DeviceProfile={deviceId:"fixture",platform:"android",model:"neutral",osVersion:"8",app:"test",appVersion:"1"};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"teaching-skill-"));const store=new TeachingStore(join(dir,"teaching.json"));const skills=new PersistentSkillLibrary(join(dir,"skills.json"));
 const v=store.start({goal:"Navigate",scope:"device",profile,sessionId:"s"});store.append(v.id,{action:{kind:"key",key:"HOME"},before:"a",after:"b",gate:false});store.finish(v.id,"b","b");
 return {store,skills,v,dir};
}
function driver(fail=false):TeachingAdapter{let screen="a";return {authorize(){},async observe(){return {signature:screen,profile,targets:[],protectedScreen:false};},async execute(){if(fail)throw Error("lost");screen="b";}};}
test("durable Skill is candidate after one independent replay, active only after another, idempotent and device bound",async()=>{
 const f=fixture();const first=await replayTeaching(f.store,f.v.id,driver(),"verify");
 await publishTeachingSkill(f.store,first.id,f.skills);const id=teachingSkillId(f.store.get(f.v.id),profile.deviceId);
 assert.equal((await f.skills.get(id))?.status,"candidate");
 await publishTeachingSkill(f.store,first.id,f.skills);assert.equal((await f.skills.get(id))?.version,1);
 assert.equal(await resolveTeachingSkill(f.store,f.v.id,profile,f.skills),null);
 const second=await replayTeaching(f.store,f.v.id,driver(),"verify");await publishTeachingSkill(f.store,second.id,f.skills);
 const reloaded=new PersistentSkillLibrary(join(f.dir,"skills.json"));assert.equal((await reloaded.get(id))?.status,"active");
 assert.equal((await resolveTeachingSkill(f.store,f.v.id,profile,reloaded))?.id,id);
 assert.equal(await resolveTeachingSkill(f.store,f.v.id,{...profile,deviceId:"other"},reloaded),null);
 const raw=readFileSync(join(f.dir,"skills.json"),"utf8");assert(!raw.includes('"key":"HOME"'));
 const bad=await replayTeaching(f.store,f.v.id,driver(true),"execute");await publishTeachingSkill(f.store,bad.id,f.skills);
 assert.equal((await f.skills.get(id))?.status,"quarantined");
 assert.equal(await resolveTeachingSkill(f.store,f.v.id,profile,f.skills),null);
});
test("unknown or incomplete run cannot promote a Skill",async()=>{
 const f=fixture();await assert.rejects(publishTeachingSkill(f.store,"forged-run",f.skills));
 const pending=f.store.beginRun(f.store.get(f.v.id),profile,"verify");await publishTeachingSkill(f.store,pending.id,f.skills);
 assert.equal(await f.skills.get(teachingSkillId(f.store.get(f.v.id),profile.deviceId)),null);
});
test("parallel Skill persistence does not lose candidates or fail the temporary file rename",async()=>{
 const f=fixture();
 await Promise.all(Array.from({length:8},(_,i)=>f.skills.createCandidate({id:"parallel-"+i,name:"test",description:"bounded",procedure:"{}",applicability:["test"],evidence:["run:"+i],verificationPassed:true,success:true,confidence:0.5,source:"test"})));
 const reloaded=new PersistentSkillLibrary(join(f.dir,"skills.json"));
 for(let i=0;i<8;i++)assert.ok(await reloaded.get("parallel-"+i));
});


test("failed Skill persistence rolls back memory, including certification",async()=>{
 const {mkdirSync,rmdirSync}=await import('node:fs');const f=fixture();const path=join(f.dir,"skills.json");
 await f.skills.get("safe");mkdirSync(path+".tmp");
 const candidate={id:"safe",name:"safe",description:"safe",procedure:"{}",applicability:["safe"],evidence:["verified"],verificationPassed:true,success:true,confidence:0.5,source:"test"};
 await assert.rejects(f.skills.createCandidate(candidate));assert.equal(await f.skills.get("safe"),null);
 rmdirSync(path+".tmp");await f.skills.createCandidate(candidate);mkdirSync(path+".tmp");
 await assert.rejects(f.skills.certify("safe",["second-check"]));assert.equal((await f.skills.get("safe"))?.status,"candidate");
 assert.equal((await f.skills.query("safe")).length,0);
 rmdirSync(path+".tmp");await f.skills.certify("safe",["second-check"]);assert.equal((await f.skills.get("safe"))?.status,"active");
});


test("compatible common procedures certify against each actual device profile",async()=>{
 const f=fixture();const p={...profile,deviceId:'second-device',model:'second-model'};
 const v=f.store.start({goal:'common',scope:'common',profile,sessionId:'common-session'});f.store.append(v.id,{action:{kind:'key',key:'HOME'},before:'a',after:'b',gate:false});f.store.finish(v.id,'b','b');
 for(let i=0;i<2;i++){let screen='a';const run=await replayTeaching(f.store,v.id,{authorize(){},async observe(){return {signature:screen,profile:p,targets:[],protectedScreen:false};},async execute(){screen='b';}},'verify');assert.equal(run.status,'PASSED');await publishTeachingSkill(f.store,run.id,f.skills);}
 assert.equal((await resolveTeachingSkill(f.store,v.id,p,f.skills))?.status,'active');assert.equal(await resolveTeachingSkill(f.store,v.id,profile,f.skills),null);
});


test("separate Skill library instances retain both writes and observe revocation",async()=>{
 const f=fixture(),other=new PersistentSkillLibrary(join(f.dir,'skills.json'));
 await Promise.all([f.skills.get('a'),other.get('b')]);
 await Promise.all([f.skills,other].map((library,i)=>library.createCandidate({id:'instance-'+i,name:'safe',description:'safe',procedure:'{}',applicability:['safe'],evidence:['verified'],verificationPassed:true,success:true,confidence:0.5,source:'test'})));
 assert.ok(await f.skills.get('instance-0'));assert.ok(await f.skills.get('instance-1'));
 await f.skills.certify('instance-0',['second']);assert.equal((await other.get('instance-0'))?.status,'active');
 await other.quarantine('instance-0','failure');assert.equal((await f.skills.get('instance-0'))?.status,'quarantined');
});


test("separate Node processes serialize durable Skill writes",async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const execute=promisify(execFile);const f=fixture();const path=join(f.dir,'skills.json');
 const source=new URL('../src/gai/skill-library.ts',import.meta.url).href;
 await Promise.all([0,1,2].map(i=>execute(process.execPath,['--input-type=module','-e',
  'import {PersistentSkillLibrary} from '+JSON.stringify(source)+'; const library=new PersistentSkillLibrary('+JSON.stringify(path)+'); await library.createCandidate('+JSON.stringify({id:'process-'+i,name:'safe',description:'safe',procedure:'{}',applicability:['safe'],evidence:['verified'],verificationPassed:true,success:true,confidence:0.5,source:'test'})+');'
 ])));
 for(let i=0;i<3;i++)assert.ok(await f.skills.get('process-'+i));
});
