import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { profileKey, type DeviceProfile, type TeachingStore } from './teaching.ts';
import { teachingLearningCandidate } from './teaching-learning.ts';

const categories = ['input-error','transcription-error','calculation-error','format-violation','operation-error','spec-change','preference-change','new-information'] as const;
type Category = typeof categories[number];
type Correction = {id:string;from:string;to:string;fromDigest:string;toDigest:string;category:Category;source:'OWNER_CONFIRMED';at:string};
type SavedSkill = {id:string;variantId:string;sourceDigest:string;deviceId:string;profileKey:string;verifiedRunIds:string[];createdAt:string};
type Data = {version:1;corrections:Correction[];skills:SavedSkill[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const string=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160;
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Separate, bounded, atomic sidecar. Never rewrites the legacy teaching store. */
export class TeachingLessonStore {
  private readonly file:string;
  constructor(file:string){this.file=file;}
  list():Data {
    if(!existsSync(this.file))return {version:1,corrections:[],skills:[]};
    if(statSync(this.file).size>1024*1024)throw Error('Lesson storage limit');
    const d=JSON.parse(readFileSync(this.file,'utf8')) as Data;
    if(d.version!==1||!Array.isArray(d.corrections)||!Array.isArray(d.skills)||d.corrections.length>1000||d.skills.length>500)throw Error('Invalid lesson store');
    const ids=new Set<string>();
    for(const c of d.corrections){
      if(!string(c.id)||ids.has(c.id)||!string(c.from)||!string(c.to)||c.from===c.to||!digest(c.fromDigest)||!digest(c.toDigest)||!categories.includes(c.category)||c.source!=='OWNER_CONFIRMED'||!Number.isFinite(Date.parse(c.at)))throw Error('Invalid correction record');
      ids.add(c.id);
    }
    for(const s of d.skills){
      if(!string(s.id)||ids.has(s.id)||!string(s.variantId)||!string(s.deviceId)||!digest(s.sourceDigest)||!digest(s.profileKey)||!Array.isArray(s.verifiedRunIds)||s.verifiedRunIds.length<3||s.verifiedRunIds.length>2000||s.verifiedRunIds.some(id=>!string(id))||!Number.isFinite(Date.parse(s.createdAt)))throw Error('Invalid skill record');
      ids.add(s.id);
    }
    return d;
  }
  private update<T>(change:(data:Data)=>T):T {
    mkdirSync(dirname(this.file),{recursive:true});
    const lock=openSync(this.file+'.lock','wx',0o600);
    try {
      const data=this.list();const result=change(data);
      const text=JSON.stringify(data);
      if(data.corrections.length>1000||data.skills.length>500||Buffer.byteLength(text)>1024*1024)throw Error('Lesson capacity reached');
      const temp=this.file+'.tmp';const fd=openSync(temp,'w',0o600);
      try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temp,this.file);return result;
    }finally{closeSync(lock);unlinkSync(this.file+'.lock');}
  }
  correct(store:TeachingStore,from:string,to:string,category:unknown):Correction {
    if(!categories.includes(category as Category)||from===to)throw Error('Invalid correction');
    const a=store.get(from),b=store.get(to);
    if(a.status==='RECORDING'||b.status==='RECORDING'||!b.completion||!b.steps.length)throw Error('Finish recording first');
    if(a.profile.deviceId!==b.profile.deviceId||profileKey(a.profile)!==profileKey(b.profile)||a.scope!==b.scope||a.goal!==b.goal)throw Error('Correction must share device, profile, scope and goal');
    const runs=store.list().runs;
    const fromDigest=teachingLearningCandidate(a,runs).sourceDigest,toDigest=teachingLearningCandidate(b,runs).sourceDigest;
    return this.update(data=>{
      let target=to;const seen=new Set([from]);
      while(target){if(seen.has(target))throw Error('Correction cycle');seen.add(target);target=data.corrections.find(c=>c.from===target)?.to||'';}
      const existing=data.corrections.find(c=>c.from===from);
      if(existing){if(existing.to===to&&existing.fromDigest===fromDigest&&existing.toDigest===toDigest&&existing.category===category)return existing;throw Error('Already superseded; retain correction provenance');}
      const c:Correction={id:hash([from,to,fromDigest,toDigest]),from,to,fromDigest,toDigest,category:category as Category,source:'OWNER_CONFIRMED',at:new Date().toISOString()};
      data.corrections.push(c);return c;
    });
  }
  assertCurrent(store:TeachingStore,id:string,data=this.list()) {
    const snapshot=store.list();
    if(data.corrections.some(c=>c.from===id))throw Error('Procedure superseded by a correction');
    for(const c of data.corrections.filter(c=>c.to===id)){
      if(teachingLearningCandidate(store.get(c.from),snapshot.runs).sourceDigest!==c.fromDigest||teachingLearningCandidate(store.get(c.to),snapshot.runs).sourceDigest!==c.toDigest)throw Error('Stale correction provenance');
    }
  }
  saveSkill(store:TeachingStore,variantId:string):SavedSkill {
    return this.update(data=>{
      this.assertCurrent(store,variantId,data);
      const v=store.get(variantId),c=teachingLearningCandidate(v,store.list().runs);
      if(c.state!=='VALIDATED')throw Error('Independent verification required');
      const id=hash(['teaching-skill',v.id,c.sourceDigest]);
      const old=data.skills.find(s=>s.id===id);if(old)return old;
      const skill:SavedSkill={id,variantId,sourceDigest:c.sourceDigest,deviceId:v.profile.deviceId,profileKey:profileKey(v.profile),verifiedRunIds:c.verifiedRunIds,createdAt:new Date().toISOString()};
      data.skills.push(skill);return skill;
    });
  }
  resolveSkill(store:TeachingStore,id:string,profile:DeviceProfile,allowRunningExecution=false) {
    const data=this.list(),s=data.skills.find(s=>s.id===id);if(!s)throw Error('Skill not found');
    if(s.deviceId!==profile.deviceId||s.profileKey!==profileKey(profile))throw Error('Skill device/profile mismatch');
    this.assertCurrent(store,s.variantId,data);
    const v=store.get(s.variantId);
    const runs=store.list().runs.filter(r=>!(allowRunningExecution&&r.variantId===v.id&&r.deviceId===profile.deviceId&&r.profileKey===profileKey(profile)&&r.mode==='execute'&&r.status==='RUNNING'));
    const c=teachingLearningCandidate(v,runs);
    if(c.state!=='VALIDATED'||s.sourceDigest!==c.sourceDigest||s.verifiedRunIds.some(id=>!c.verifiedRunIds.includes(id)))throw Error('Skill verification is stale');
    return v;
  }
}

export function teachingLessons(){return new TeachingLessonStore(process.env.JARVIS_TEACHING_LESSONS_PATH?.trim()||((process.env.JARVIS_TEACHING_PATH?.trim()||resolve('.jarvis/teaching.json'))+'.lessons.json'));}

export function lessonLibrary(store:TeachingStore,lessons:TeachingLessonStore){
  const snapshot=store.list(),data=lessons.list();
  if(snapshot.variants.length>500||snapshot.runs.length>2000||snapshot.variants.some(v=>v.steps.length>50))throw Error("Teaching capacity exceeded");
  const learningCandidates=snapshot.variants.map(v=>{
    const c=teachingLearningCandidate(v,snapshot.runs);
    const outgoing=data.corrections.find(r=>r.from===v.id),incoming=data.corrections.filter(r=>r.to===v.id);
    let current=true;try{lessons.assertCurrent(store,v.id,data);}catch{current=false;}
    return {...c,state:current?c.state:'NEEDS_VALIDATION' as const,correctionState:outgoing?'CONFIRMED_MISTAKE':incoming.length?'CORRECTED':'UNKNOWN',supersededBy:outgoing?.to,validationRules:incoming.map(r=>({category:r.category,sourceCorrectionId:r.id,scope:'same-device-profile',rule:'reobserve-and-verify-corrected-variant'}))};
  });
  const skills=data.skills.map(s=>{let usable=false;try{lessons.resolveSkill(store,s.id,store.get(s.variantId).profile);usable=true;}catch{ /* Stale or failed evidence is displayed as NEEDS_VALIDATION. */ }return {...s,status:usable?'READY_FOR_GUARDED_REPLAY':'NEEDS_VALIDATION',grantsPermission:false};});
  return {...snapshot,learningCandidates,corrections:data.corrections,skills};
}

export async function lessonCommand(request:Request,deps:{authorize:()=>Promise<boolean>;store:()=>TeachingStore;lessons:()=>TeachingLessonStore}):Promise<Response>{
  const headers={'Cache-Control':'no-store'};
  if(!await deps.authorize())return Response.json({message:'オーナー認証が必要です'},{status:401,headers});
  const origin=request.headers.get('origin');
  if(origin){
    let sameHost=false;
    try{const parsed=new URL(origin);const host=request.headers.get('host')||new URL(request.url).host;sameHost=['http:','https:'].includes(parsed.protocol)&&parsed.origin===origin&&parsed.host===new URL(`${parsed.protocol}//${host}`).host;}catch{sameHost=false;}
    // Next's internal request URL can differ behind the private reverse proxy.
    // Host is the actual browser destination; do not trust X-Forwarded-Host.
    if(!sameHost)return Response.json({message:'送信元を確認できません'},{status:403,headers});
  }
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({message:'JSONが必要です'},{status:415,headers});
  try{
    const reader=request.body?.getReader();if(!reader)throw Error('Body required');let bytes=0;const chunks:Uint8Array[]=[];
    while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32000){await reader.cancel();throw Error('Input limit');}chunks.push(part.value);}
    const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const store=deps.store();
    if(p.action==='manual')return Response.json({variant:store.manual(p)},{status:201,headers});
    if(p.action==='correct'&&string(p.from)&&string(p.to))return Response.json({correction:deps.lessons().correct(store,p.from,p.to,p.category)},{status:201,headers});
    if(p.action==='save-skill'&&string(p.variantId))return Response.json({skill:deps.lessons().saveSkill(store,p.variantId)},{status:201,headers});
    throw Error('Unsupported action');
  }catch{return Response.json({message:'保存できません。訂正元と訂正先の端末・環境・作業名、再現検証の結果を確認してください。'},{status:409,headers});}
}
