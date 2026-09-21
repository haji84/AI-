import { createHash } from "node:crypto";

export type BridgeMode="LEGACY"|"SHADOW"|"CANARY"|"PRIMARY"|"ROLLBACK";
export type BridgeRequest={method:string;path:string;deviceId?:string};
export type BridgeTarget={name:string;baseUrl:string};
export type ShadowComparison={path:string;primaryStatus:number;shadowStatus:number;primaryHash:string;shadowHash:string;equal:boolean};

function validPrivateTarget(raw:string){
  const url=new URL(raw);
  if(url.username||url.password||url.hash)return false;
  if(url.protocol==="https:")return true;
  return url.protocol==="http:"&&(url.hostname==="127.0.0.1"||url.hostname==="localhost"||url.hostname==="::1");
}
export class CoordinatorCompatibilityBridge {
  readonly legacy: BridgeTarget;
  readonly candidate: BridgeTarget;
  private mode:BridgeMode="LEGACY";
  private canaries=new Set<string>();
  constructor(legacy:BridgeTarget,candidate:BridgeTarget){
    if(!validPrivateTarget(legacy.baseUrl)||!validPrivateTarget(candidate.baseUrl))throw new Error("coordinator targets must be loopback HTTP or HTTPS");
    this.legacy = legacy;
    this.candidate = candidate;
  }
  setMode(mode:BridgeMode){this.mode=mode;if(mode!=="CANARY")this.canaries.clear();}
  setCanaries(ids:string[]){if(!ids.length)throw new Error("canary devices required");this.canaries=new Set(ids);this.mode="CANARY";}
  targetFor(request:BridgeRequest):BridgeTarget{
    if(this.mode==="PRIMARY")return this.candidate;
    if(this.mode==="CANARY"&&request.deviceId&&this.canaries.has(request.deviceId))return this.candidate;
    return this.legacy;
  }
  shadowTargetFor(request:BridgeRequest):BridgeTarget|null{
    if(this.mode!=="SHADOW")return null;
    const method=request.method.toUpperCase();
    return method==="GET"||method==="HEAD"?this.candidate:null;
  }
  compare(path:string,primary:{status:number;body:Uint8Array},shadow:{status:number;body:Uint8Array}):ShadowComparison{
    const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
    const primaryHash=hash(primary.body),shadowHash=hash(shadow.body);
    return {path,primaryStatus:primary.status,shadowStatus:shadow.status,primaryHash,shadowHash,equal:primary.status===shadow.status&&primaryHash===shadowHash};
  }
  snapshot(){return {mode:this.mode,legacy:this.legacy,candidate:this.candidate,canaries:[...this.canaries]};}
}
