export type DataClass="public"|"internal"|"personal"|"confidential"|"highly-confidential"|"credentials"|"secret";
export type Modality="text"|"code"|"vision"|"audio"|"tool";
export type ModelCandidate={id:string;local:boolean;modalities:Modality[];quality:number;latencyMs:number;cost:number;ramGb:number;vramGb:number;allowedData:DataClass[];successRate:number;available:boolean;resources?:{availableRamGb:number;availableVramGb:number}};
export type RouteRequest={modality:Modality;dataClass:DataClass;minQuality:number;deadlineMs?:number;localOnly?:boolean;cloudBudget?:number;availableRamGb:number;availableVramGb:number};
export class ModelRouterV2 {
  route(request:RouteRequest,models:ModelCandidate[]){
    const nonnegative=(value:number)=>Number.isFinite(value)&&value>=0;
    const fraction=(value:number)=>nonnegative(value)&&value<=1;
    if(!fraction(request.minQuality)||!nonnegative(request.availableRamGb)||!nonnegative(request.availableVramGb)||
      (request.deadlineMs!==undefined&&!nonnegative(request.deadlineMs))||
      (request.cloudBudget!==undefined&&!nonnegative(request.cloudBudget))||
      ["credentials","secret"].includes(request.dataClass))return {selected:null,reason:"invalid-or-protected-request"};
    const eligible=models.filter(m=>{
      const resources=m.resources??request;
      return typeof m.id==='string'&&m.id.length>0&&typeof m.local==='boolean'&&m.available===true&&
        Array.isArray(m.modalities)&&m.modalities.includes(request.modality)&&Array.isArray(m.allowedData)&&m.allowedData.includes(request.dataClass)&&
        fraction(m.quality)&&fraction(m.successRate)&&nonnegative(m.latencyMs)&&nonnegative(m.ramGb)&&nonnegative(m.vramGb)&&
        // A caller's budget is never authority to enable an additional paid AI API.
        m.cost===0&&m.quality>=request.minQuality&&nonnegative(resources.availableRamGb)&&nonnegative(resources.availableVramGb)&&
        m.ramGb<=resources.availableRamGb&&m.vramGb<=resources.availableVramGb&&(!request.localOnly||m.local)&&
        (request.deadlineMs===undefined||m.latencyMs<=request.deadlineMs);
    });
    if(!eligible.length) return {selected:null,reason:"no-compatible-model"};
    const scored=eligible.map(m=>({model:m,costPerSuccess:m.cost/Math.max(0.01,m.successRate),score:m.quality*0.45+m.successRate*0.35+Math.max(0,1-m.latencyMs/60_000)*0.15+(m.local?0.05:0)-(m.cost*0.02)})).sort((a,b)=>b.score-a.score||a.costPerSuccess-b.costPerSuccess);
    return {selected:scored[0].model,reason:"best-compatible",alternates:scored.slice(1).map(x=>x.model.id)};
  }
}
