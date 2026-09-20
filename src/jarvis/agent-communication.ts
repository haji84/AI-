import { createHmac, timingSafeEqual } from "node:crypto";
export type AgentMessage={from:string;to:string;tenantId:string;jobId:string;type:string;payload:unknown;timestamp:number;nonce:string;signature:string};
function canonical(m:Omit<AgentMessage,"signature">){return JSON.stringify({from:m.from,to:m.to,tenantId:m.tenantId,jobId:m.jobId,type:m.type,payload:m.payload,timestamp:m.timestamp,nonce:m.nonce});}
export class AuthenticatedAgentFabric{
  private keys=new Map<string,string>();private nonces=new Map<string,number>();
  registerIdentity(agentId:string,key:string){if(!agentId||key.length<16)throw new Error("invalid agent identity");this.keys.set(agentId,key);}
  revokeIdentity(agentId:string){this.keys.delete(agentId);}
  sign(input:Omit<AgentMessage,"signature">):AgentMessage{const key=this.keys.get(input.from);if(!key)throw new Error("unknown agent identity");const signature=createHmac("sha256",key).update(canonical(input)).digest("base64url");return {...input,signature};}
  verify(message:AgentMessage,now=Date.now(),maxSkewMs=60_000){const key=this.keys.get(message.from);if(!key||!this.keys.has(message.to))return {ok:false,reason:"identity"};if(Math.abs(now-message.timestamp)>maxSkewMs)return {ok:false,reason:"clock"};const nonceKey=`${message.from}:${message.nonce}`;if(this.nonces.has(nonceKey))return {ok:false,reason:"replay"};const {signature,...unsigned}=message;const expected=createHmac("sha256",key).update(canonical(unsigned)).digest();const actual=Buffer.from(signature,"base64url");if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return {ok:false,reason:"signature"};this.nonces.set(nonceKey,now);for(const [n,t] of this.nonces)if(now-t>maxSkewMs*2)this.nonces.delete(n);return {ok:true,reason:"verified"};}
}
