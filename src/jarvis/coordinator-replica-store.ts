import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type DurableCoordinatorSnapshot<T>={version:1;logicalId:string;generation:number;updatedAt:string;checksum:string;state:T};
type StoreState<T>={version:1;primary?:DurableCoordinatorSnapshot<T>;shadow?:DurableCoordinatorSnapshot<T>;rollback?:DurableCoordinatorSnapshot<T>;lease?:{holder:string;token:string;expiresAt:number}};

function digest(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export class CoordinatorReplicaStore<T>{
  private readonly file:string;
  constructor(file:string){this.file=file;}
  private read():StoreState<T>{if(!existsSync(this.file))return {version:1};const raw=readFileSync(this.file,"utf8");if(raw.length>4*1024*1024)throw new Error("coordinator replica state too large");const state=JSON.parse(raw) as StoreState<T>;if(state.version!==1)throw new Error("unsupported coordinator replica state");return state;}
  private save(state:StoreState<T>){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+".tmp",JSON.stringify(state),{mode:0o600});renameSync(this.file+".tmp",this.file);}
  snapshot(logicalId:string,state:T,generation:number,now=new Date()):DurableCoordinatorSnapshot<T>{return {version:1,logicalId,generation,updatedAt:now.toISOString(),checksum:digest(state),state};}
  setPrimary(snapshot:DurableCoordinatorSnapshot<T>){const s=this.read();this.save({...s,primary:snapshot});}
  setShadow(snapshot:DurableCoordinatorSnapshot<T>){const s=this.read();if(s.primary&&snapshot.generation<s.primary.generation)throw new Error("shadow generation cannot move backwards");this.save({...s,shadow:snapshot});}
  compare(){const s=this.read();if(!s.primary||!s.shadow)return {equal:false,reason:"missing"};return {equal:s.primary.logicalId===s.shadow.logicalId&&s.primary.generation===s.shadow.generation&&s.primary.checksum===s.shadow.checksum,reason:"compared",primary:s.primary,shadow:s.shadow};}
  promote(){const s=this.read();if(!s.primary||!s.shadow)throw new Error("primary and shadow required");const cmp=this.compare();if(!cmp.equal)throw new Error("shadow divergence");this.save({...s,rollback:s.primary,primary:s.shadow,shadow:undefined});return s.shadow;}
  rollback(){const s=this.read();if(!s.rollback)throw new Error("rollback snapshot unavailable");const current=s.primary;this.save({...s,primary:s.rollback,rollback:current,shadow:undefined,lease:undefined});return s.rollback;}
  acquireWriter(holder:string,ttlMs:number,now=Date.now()){const s=this.read();if(s.lease&&s.lease.expiresAt>now&&s.lease.holder!==holder)throw new Error("single writer lease held");const lease={holder,token:randomUUID(),expiresAt:now+Math.max(1000,ttlMs)};this.save({...s,lease});return lease;}
  validateWriter(token:string,now=Date.now()){const s=this.read();return Boolean(s.lease&&s.lease.token===token&&s.lease.expiresAt>now);}
  state(){return this.read();}
}
