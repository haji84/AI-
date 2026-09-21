export type DemoEvent={at:string;kind:"screen"|"click"|"tap"|"keyboard"|"file"|"save"|"error"|"undo"|"delete"|"reentry"|"correction";target?:string;before?:unknown;after?:unknown;message?:string};
export type CorrectionClass="input-error"|"transcription-error"|"calculation-error"|"format-violation"|"operation-error"|"spec-change"|"preference-change"|"new-information"|"external-instruction"|"unknown";
export type LearnedWorkflow={name:string;steps:Array<{kind:string;target?:string;condition?:string}>;decisionRules:string[];validationRules:string[];confidence:number};

function diffChanged(a:unknown,b:unknown){return JSON.stringify(a)!==JSON.stringify(b);}
export class DemonstrationLearningEngine {
  classifyCorrection(events:DemoEvent[]):CorrectionClass{
    const hasError=events.some(e=>e.kind==="error");
    const correction=events.findLast(e=>e.kind==="correction"||e.kind==="reentry");
    if(!correction) return "unknown";
    if(hasError&&events.some(e=>e.kind==="keyboard")) return "input-error";
    if(events.some(e=>e.kind==="delete")&&events.some(e=>e.kind==="reentry")) return "transcription-error";
    if(correction.message?.toLowerCase().includes("format")) return "format-violation";
    if(correction.message?.toLowerCase().includes("spec")) return "spec-change";
    if(correction.message?.toLowerCase().includes("preference")) return "preference-change";
    return "operation-error";
  }
  inferWorkflow(name:string,events:DemoEvent[]):LearnedWorkflow{
    const effective=events.filter((e,i)=>!(["undo","delete","error"] as string[]).includes(e.kind)&&!events.slice(i+1).some(n=>n.kind==="correction"&&diffChanged(e.after,n.after)&&n.target===e.target));
    const steps=effective.filter(e=>["click","tap","keyboard","file","save","reentry","correction"].includes(e.kind)).map(e=>({kind:e.kind,target:e.target}));
    const cls=this.classifyCorrection(events);
    const decisions=[...new Set(events.filter(e=>e.message?.startsWith("if:")).map(e=>e.message!.slice(3).trim()))];
    const validations=cls==="unknown"?[]:[`prevent-repeat:${cls}`];
    const confidence=Math.min(1,0.45+Math.min(0.35,steps.length*0.04)+(events.some(e=>e.kind==="save")?0.2:0));
    return {name,steps,decisionRules:decisions,validationRules:validations,confidence:Number(confidence.toFixed(2))};
  }
  validationRuleFromCorrections(classes:CorrectionClass[],minimum=3){
    const counts=new Map<CorrectionClass,number>(); for(const c of classes) counts.set(c,(counts.get(c)||0)+1);
    return [...counts.entries()].filter(([c,n])=>c!=="unknown"&&n>=minimum).map(([c,n])=>({id:`validate:${c}`,pattern:c,count:n,action:"precheck"}));
  }
  promoteSkill(workflow:LearnedWorkflow,verifiedRuns:number,failedRuns:number){
    if(verifiedRuns<3||failedRuns>0||workflow.confidence<0.7) return {promoted:false,reason:"insufficient verified evidence"};
    return {promoted:true,skill:{id:`skill:${workflow.name.toLowerCase().replace(/\s+/g,"-")}`,workflow}};
  }
}
