export type DataClass="public"|"internal"|"personal"|"confidential"|"highly-confidential"|"credentials"|"secret";
export type Modality="text"|"code"|"vision"|"audio"|"tool";
export type ModelCandidate={id:string;local:boolean;modalities:Modality[];quality:number;latencyMs:number;cost:number;ramGb:number;vramGb:number;allowedData:DataClass[];successRate:number;available:boolean};
export type RouteRequest={modality:Modality;dataClass:DataClass;minQuality:number;deadlineMs?:number;localOnly?:boolean;cloudBudget?:number;availableRamGb:number;availableVramGb:number};
export class ModelRouterV2 {
  route(request:RouteRequest,models:ModelCandidate[]){
    const eligible=models.filter(m=>m.available&&m.modalities.includes(request.modality)&&m.allowedData.includes(request.dataClass)&&m.quality>=request.minQuality&&m.ramGb<=request.availableRamGb&&m.vramGb<=request.availableVramGb&&(!request.localOnly||m.local)&&(!request.deadlineMs||m.latencyMs<=request.deadlineMs)&&(m.local||m.cost<=(request.cloudBudget??0)));
    if(!eligible.length) return {selected:null,reason:"no-compatible-model"};
    const scored=eligible.map(m=>({model:m,costPerSuccess:m.cost/Math.max(0.01,m.successRate),score:m.quality*0.45+m.successRate*0.35+Math.max(0,1-m.latencyMs/60_000)*0.15+(m.local?0.05:0)-(m.cost*0.02)})).sort((a,b)=>b.score-a.score||a.costPerSuccess-b.costPerSuccess);
    return {selected:scored[0].model,reason:"best-compatible",alternates:scored.slice(1).map(x=>x.model.id)};
  }
}
