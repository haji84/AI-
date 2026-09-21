export type EscalationStage="MODEL"|"AGENT"|"TOOL"|"RESEARCH"|"SPECIALIST"|"HUMAN";
export type EscalationContext={attempted:EscalationStage[];risk:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";confidence:number;recoverable:boolean;available:{models:number;agents:number;tools:number;research:boolean;specialists:boolean}};
const order:EscalationStage[]=["MODEL","AGENT","TOOL","RESEARCH","SPECIALIST","HUMAN"];
export class AutomaticEscalationEngine {
  next(ctx:EscalationContext):EscalationStage{
    if(ctx.risk==="HIGH"||ctx.risk==="CRITICAL") return "HUMAN";
    for(const stage of order){if(ctx.attempted.includes(stage))continue;if(stage==="MODEL"&&ctx.available.models<1)continue;if(stage==="AGENT"&&ctx.available.agents<1)continue;if(stage==="TOOL"&&ctx.available.tools<1)continue;if(stage==="RESEARCH"&&!ctx.available.research)continue;if(stage==="SPECIALIST"&&!ctx.available.specialists)continue;return stage;}return "HUMAN";
  }
  shouldEscalate(ctx:EscalationContext){return !ctx.recoverable||ctx.confidence<0.55||ctx.attempted.length>1;}
}
