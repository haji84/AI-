import type { CompassStore } from "../compass/store.ts";

const KIND="goriq-goal-execution-context", VERSION=1, MAX=100;
type RecordItem={goalId:string;context:unknown[];updatedAt:string};
type Envelope={kind:typeof KIND;version:typeof VERSION;records:RecordItem[]};
function isEnvelope(v:unknown):v is Envelope{return !!v&&typeof v==="object"&&(v as {kind?:unknown}).kind===KIND&&(v as {version?:unknown}).version===VERSION&&Array.isArray((v as {records?:unknown}).records);}
export class CompassGoalExecutionContextStore {
 private readonly compass: CompassStore;
 constructor(compass: CompassStore){ this.compass = compass; }
 put(goalId:string,context:unknown[]):void{const e=this.read();const records=[...e.records.filter(r=>r.goalId!==goalId),{goalId,context:structuredClone(context),updatedAt:new Date().toISOString()}].slice(-MAX);this.write({...e,records});}
 get(goalId:string):unknown[]{const r=this.read().records.find(x=>x.goalId===goalId);return r?structuredClone(r.context):[];}
 private read():Envelope{return this.compass.getState().active.find(isEnvelope)??{kind:KIND,version:VERSION,records:[]};}
 private write(e:Envelope):void{const active=this.compass.getState().active.filter(x=>!isEnvelope(x));this.compass.updateState({active:[...active,structuredClone(e)]});}
}
