export type RiskLevel="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
export type ActionRequest={tenantId:string;actorId:string;workerId:string;action:string;resource:string;destination?:string;risk:RiskLevel;capabilities:string[]};
export type ScopedGrant={id:string;tenantId:string;actorId:string;workerId:string;actions:string[];resources:string[];destinations?:string[];expiresAt:number;revokedAt?:number};
export type SecurityDecision={allow:boolean;reason:string;humanGate:boolean};

export class SecurityKernel {
  private grants=new Map<string,ScopedGrant>();
  private incidents:Array<{at:string;type:string;detail:string}>=[];
  issueGrant(grant:ScopedGrant){ if(grant.expiresAt<=Date.now()) throw new Error("grant already expired"); this.grants.set(grant.id,{...grant}); }
  revokeGrant(id:string,now=Date.now()){const g=this.grants.get(id);if(g)this.grants.set(id,{...g,revokedAt:now});}
  evaluate(request:ActionRequest,now=Date.now()):SecurityDecision{
    if(request.risk==="CRITICAL"||request.risk==="HIGH") return {allow:false,reason:"human-gate-required",humanGate:true};
    const candidates=[...this.grants.values()].filter(g=>!g.revokedAt&&g.expiresAt>now&&g.tenantId===request.tenantId&&g.actorId===request.actorId&&g.workerId===request.workerId);
    const grant=candidates.find(g=>g.actions.includes(request.action)&&g.resources.some(r=>request.resource===r||request.resource.startsWith(r+"/"))&&(!request.destination||(g.destinations||[]).includes(request.destination)));
    if(!grant) return {allow:false,reason:"default-deny:no-scoped-grant",humanGate:false};
    return {allow:true,reason:"scoped-grant",humanGate:false};
  }
  canWorkerDelegate(sourceWorker:string,targetWorker:string){return sourceWorker===targetWorker;}
  enforceTenant(expected:string,actual:string){ if(expected!==actual) throw new Error("tenant isolation violation"); }
  retentionDecision(classification:string,ageMs:number){
    const limit:Record<string,number>={public:365*86400000,internal:180*86400000,personal:90*86400000,confidential:30*86400000,"highly-confidential":7*86400000,credentials:0,secret:0};
    const max=limit[classification]??30*86400000; return {retain:ageMs<=max,maxAgeMs:max};
  }
  recordIncident(type:string,detail:string,now=new Date()){this.incidents.push({at:now.toISOString(),type,detail});this.incidents=this.incidents.slice(-1000);}
  incidentLog(){return [...this.incidents];}
}
