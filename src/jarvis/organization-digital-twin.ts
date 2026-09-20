export type RuleAuthority = "regulation" | "official-manual" | "approved-template" | "official-workflow" | "formal-history" | "practice";
export type OrganizationRule = {
  id:string; title:string; authority:RuleAuthority; version:string; effectiveFrom:string; effectiveTo?:string;
  source:string; supersededBy?:string; scope:string[]; exceptionFor?:string[]; content:Record<string,unknown>;
};
export type ApprovalStep={role:string;action:string;order:number;conditions?:Record<string,unknown>};
export type OrganizationWorkflow={id:string;name:string;version:string;steps:ApprovalStep[];effectiveFrom:string;effectiveTo?:string};
const rank:Record<RuleAuthority,number>={regulation:6,"official-manual":5,"approved-template":4,"official-workflow":3,"formal-history":2,practice:1};

export class OrganizationDigitalTwin {
  private rules=new Map<string,OrganizationRule>();
  private workflows=new Map<string,OrganizationWorkflow>();
  upsertRule(rule:OrganizationRule){ if(!rule.id||!rule.version||!Date.parse(rule.effectiveFrom)) throw new Error("invalid organization rule"); this.rules.set(rule.id,structuredClone(rule)); }
  upsertWorkflow(flow:OrganizationWorkflow){ if(!flow.id||!flow.steps.length) throw new Error("invalid workflow"); this.workflows.set(flow.id,structuredClone(flow)); }
  applicableRules(scope:string,at:string,contextTags:string[]=[]){
    const t=Date.parse(at); if(!Number.isFinite(t)) throw new Error("invalid application time");
    return [...this.rules.values()].filter(r=>r.scope.includes(scope)&&Date.parse(r.effectiveFrom)<=t&&(!r.effectiveTo||Date.parse(r.effectiveTo)>=t)&&!(r.exceptionFor||[]).some(x=>contextTags.includes(x)))
      .sort((a,b)=>rank[b.authority]-rank[a.authority]||Date.parse(b.effectiveFrom)-Date.parse(a.effectiveFrom));
  }
  selectRule(scope:string,at:string,contextTags:string[]=[]){ return this.applicableRules(scope,at,contextTags)[0]; }
  approvalPath(workflowId:string,at:string){
    const f=this.workflows.get(workflowId); if(!f) return [];
    const t=Date.parse(at); if(t<Date.parse(f.effectiveFrom)||(f.effectiveTo&&t>Date.parse(f.effectiveTo))) return [];
    return [...f.steps].sort((a,b)=>a.order-b.order);
  }
  impactOfRule(ruleId:string){
    const direct=[...this.rules.values()].filter(r=>r.supersededBy===ruleId||r.id===ruleId).map(r=>r.id);
    const scopes=new Set(direct.flatMap(id=>this.rules.get(id)?.scope||[]));
    const workflows=[...this.workflows.values()].filter(w=>w.steps.some(s=>[...scopes].includes(String(s.conditions?.scope||"")))).map(w=>w.id);
    return {rules:direct,scopes:[...scopes],workflows};
  }
  snapshot(){return {rules:[...this.rules.values()],workflows:[...this.workflows.values()]};}
}
