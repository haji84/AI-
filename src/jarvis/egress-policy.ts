export type EgressGrant={id:string;jobId:string;workerId:string;destination:string;protocol:"https"|"http"|"wss"|"tcp";expiresAt:number;revoked?:boolean};
export class DefaultDenyEgressPolicy{
  private grants=new Map<string,EgressGrant>();
  grant(item:EgressGrant){if(item.expiresAt<=Date.now())throw new Error("egress grant expired");if(item.protocol==="http"&&!["127.0.0.1","localhost","::1"].includes(item.destination))throw new Error("plain HTTP egress only allowed to loopback");this.grants.set(item.id,{...item});}
  revoke(id:string){const g=this.grants.get(id);if(g)this.grants.set(id,{...g,revoked:true});}
  check(input:{jobId:string;workerId:string;destination:string;protocol:EgressGrant["protocol"]},now=Date.now()){const g=[...this.grants.values()].find(x=>!x.revoked&&x.expiresAt>now&&x.jobId===input.jobId&&x.workerId===input.workerId&&x.destination===input.destination&&x.protocol===input.protocol);return {allow:Boolean(g),grantId:g?.id,reason:g?"scoped-egress-grant":"default-deny"};}
}
