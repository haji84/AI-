export type SimulationChange={id:string;kind:"config"|"workflow"|"ui"|"infra"|"cost"|"data";target:string;before:unknown;after:unknown;reversible:boolean};
export type SimulationResult={safe:boolean;risk:number;effects:Array<{changeId:string;target:string;summary:string}>;rollback:string[];warnings:string[]};
export class JarvisSimulator {
  simulate(changes:SimulationChange[]):SimulationResult{
    const warnings:string[]=[],effects:SimulationResult["effects"]=[],rollback:string[]=[];let risk=0;
    for(const c of changes){if(JSON.stringify(c.before)===JSON.stringify(c.after)){warnings.push(`${c.id}: no-op`);continue;}risk+=c.reversible?0.08:0.35;if(["infra","data"].includes(c.kind))risk+=0.15;effects.push({changeId:c.id,target:c.target,summary:`${c.kind} change ${c.reversible?"reversible":"irreversible"}`});if(c.reversible)rollback.push(`restore:${c.target}`);else warnings.push(`${c.id}: irreversible`);}
    risk=Math.min(1,risk);return {safe:risk<0.5&&!warnings.some(w=>w.includes("irreversible")),risk:Number(risk.toFixed(2)),effects,rollback,warnings};
  }
  compare<T>(before:T,after:T){return {changed:JSON.stringify(before)!==JSON.stringify(after),before,after};}
}
