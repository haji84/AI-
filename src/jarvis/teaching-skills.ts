import { createHash } from "node:crypto";
import type { PersistentSkillLibrary } from "../gai/skill-library.ts";
import { profileKey, matchesVariant, type DeviceProfile, type TeachingStore, type TeachingVariant } from "./teaching.ts";
import { learnDemonstration } from "../orchestrator/demonstration-learning.ts";

const pending = new WeakMap<PersistentSkillLibrary, Promise<unknown>>();
function serial<T>(library: PersistentSkillLibrary, action:()=>Promise<T>):Promise<T> {
  const result = (pending.get(library) ?? Promise.resolve()).then(action);
  pending.set(library, result.catch(()=>undefined));
  return result;
}
function digest(variant:TeachingVariant) {
  return createHash("sha256").update(JSON.stringify([variant.steps,variant.finalScreen,variant.completion])).digest("hex");
}
export function teachingSkillId(variant:TeachingVariant, deviceId:string, actualProfileKey=profileKey(variant.profile)) {
  return "teaching-" + createHash("sha256").update(JSON.stringify([variant.id,deviceId,actualProfileKey,digest(variant)])).digest("hex");
}
function safeVariant(variant:TeachingVariant) {
  if (variant.learning?.pendingCorrection || !variant.finalScreen || !variant.steps.length ||
      variant.steps.some(step=>step.gate||step.action.kind==="manual")) return false;
  if (variant.learning) {
    const steps=learnDemonstration(variant.learning.events,true).steps.map(s=>variant.learning!.archive[s.operation]);
    if(JSON.stringify(steps)!==JSON.stringify(variant.steps))throw Error("Skill learning provenance mismatch");
  }
  return true;
}
export function publishTeachingSkill(store:TeachingStore,runId:string,library:PersistentSkillLibrary) {
  return serial(library,async()=>{
    const run=store.list().runs.find(item=>item.id===runId);
    if(!run)throw Error("Unknown teaching verification");
    const variant=store.get(run.variantId),id=teachingSkillId(variant,run.deviceId,run.profileKey);
    const existing=await library.get(id);
    if(run.status==="NEEDS_HUMAN"||run.status==="FAILED"){
      if(existing)await library.quarantine(id,"teaching-run:"+run.id);
      return {status:existing?"quarantined":"none",skillId:existing?.id};
    }
    if(run.status!=="PASSED"||run.mode!=="verify"||run.nextStep!==variant.steps.length||
       run.pendingStep!==undefined||variant.status!=="VERIFIED"||
       !safeVariant(variant))return {status:existing?.status??"none",skillId:existing?.id};
    if(!existing)await library.createCandidate({
      id,name:variant.goal,description:"Device-bound, independently replayed teaching procedure",
      procedure:JSON.stringify({kind:"jarvis.teaching.v1",variantId:variant.id,deviceId:run.deviceId,profileKey:run.profileKey,stepsSha256:digest(variant)}),
      applicability:[variant.goal,variant.profile.platform,variant.profile.app],
      evidence:["teaching-run:"+run.id],verificationPassed:true,success:true,confidence:0.5,source:"teaching:"+variant.id,
      constraints:{capabilities:["teaching-replay"],resources:["device:"+run.deviceId,"profile:"+run.profileKey],maxRisk:"low",connectivity:"online-required"}
    });
    // Two distinct server-stored verification runs; a client boolean is never certification.
    const all=store.list().runs.filter(r=>r.variantId===variant.id&&r.deviceId===run.deviceId&&r.profileKey===run.profileKey);
    const lastFailure=all.findLastIndex(r=>r.status!=="PASSED");
    const checks=all.slice(lastFailure+1).filter(r=>r.mode==="verify"&&r.status==="PASSED"&&r.nextStep===variant.steps.length&&r.pendingStep===undefined);
    if(checks.length>=2&&all.at(-1)?.id===runId&&(await library.get(id))?.status==="candidate")
      await library.certify(id,checks.map(r=>"teaching-run:"+r.id));
    const saved=await library.get(id);
    return {status:saved?.status??"none",skillId:saved?.id};
  });
}
export function resolveTeachingSkill(store:TeachingStore,variantId:string,profile:DeviceProfile,library:PersistentSkillLibrary) {
  return serial(library,async()=>{
    const variant=store.get(variantId),id=teachingSkillId(variant,profile.deviceId,profileKey(profile)),record=await library.get(id);
    if(!record||record.status!=="active"||!safeVariant(variant)||!matchesVariant(variant,profile))return null;
    const runs=store.list().runs.filter(r=>r.variantId===variantId&&r.deviceId===profile.deviceId&&r.profileKey===profileKey(profile));
    if(runs.at(-1)?.status!=="PASSED")return null;
    const reference=JSON.parse(record.procedure);
    if(reference.kind!=="jarvis.teaching.v1"||reference.variantId!==variantId||reference.deviceId!==profile.deviceId||
       reference.profileKey!==profileKey(profile)||reference.stepsSha256!==digest(variant))
      throw Error("Certified Skill reference mismatch");
    return record;
  });
}
