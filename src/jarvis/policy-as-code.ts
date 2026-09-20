export type PolicyEffect="allow"|"deny"|"human-gate";
export type SecurityPolicyRule={id:string;effect:PolicyEffect;actions:string[];resources:string[];tenants?:string[];risk?:Array<"LOW"|"MEDIUM"|"HIGH"|"CRITICAL">;destinations?:string[];priority:number};
export type PolicyRequest={tenantId:string;action:string;resource:string;risk:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";destination?:string};
function resourceMatches(pattern:string,resource:string){return pattern==="*"||resource===pattern||resource.startsWith(pattern.endsWith("/")?pattern:pattern+"/");}
export class PolicyAsCodeEngine{
  private rules:SecurityPolicyRule[]=[];
  load(rules:SecurityPolicyRule[]){const ids=new Set<string>();for(const r of rules){if(!r.id||ids.has(r.id))throw new Error("duplicate/invalid policy id");ids.add(r.id);}this.rules=[...rules].sort((a,b)=>b.priority-a.priority);}
  evaluate(req:PolicyRequest){for(const rule of this.rules){if(!rule.actions.includes("*")&&!rule.actions.includes(req.action))continue;if(!rule.resources.some(x=>resourceMatches(x,req.resource)))continue;if(rule.tenants&&!rule.tenants.includes(req.tenantId))continue;if(rule.risk&&!rule.risk.includes(req.risk))continue;if(req.destination&&rule.destinations&&!rule.destinations.includes(req.destination))continue;return {effect:rule.effect,ruleId:rule.id};}return {effect:"deny" as const,ruleId:"default-deny"};}
  snapshot(){return [...this.rules];}
}
