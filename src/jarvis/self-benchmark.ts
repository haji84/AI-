export type RuntimeOutcome={taskType:string;inputShape:string;success:boolean;durationMs:number;cost:number;humanInterventions:number;failureSignature?:string};
export type GeneratedBenchmark={id:string;taskType:string;inputShape:string;expected:"success"|"fail-safe";sourceCount:number};
export class SelfGeneratedBenchmarkEngine {
  generate(outcomes:RuntimeOutcome[],minimumExamples=3):GeneratedBenchmark[]{
    const groups=new Map<string,RuntimeOutcome[]>();
    for(const o of outcomes){const key=[o.taskType,o.inputShape,o.failureSignature||""].join("|");const list=groups.get(key)||[];list.push(o);groups.set(key,list);}
    const out:GeneratedBenchmark[]=[];
    for(const [key,list] of groups){if(list.length<minimumExamples)continue;const [taskType,inputShape,failureSignature]=key.split("|");const successes=list.filter(x=>x.success).length;out.push({id:`bench:${taskType}:${Math.abs(hash(key))}`,taskType,inputShape,expected:failureSignature||successes<list.length/2?"fail-safe":"success",sourceCount:list.length});}
    return out;
  }
  score(candidate:Array<{id:string;passed:boolean;durationMs:number;cost:number}>){const total=candidate.length;return {total,passRate:total?candidate.filter(x=>x.passed).length/total:0,meanDurationMs:total?candidate.reduce((a,x)=>a+x.durationMs,0)/total:0,totalCost:candidate.reduce((a,x)=>a+x.cost,0)};}
}
function hash(text:string){let h=0;for(const ch of text)h=((h<<5)-h+ch.charCodeAt(0))|0;return h;}
