export type FactStatus="CONFIRMED"|"CONFLICTED"|"UNVERIFIED"|"INFERRED";
export type SourceClass="primary_original"|"official"|"reliable_secondary"|"other";
export interface FactSource{id:string;sourceClass:SourceClass;retrievedAt:string;publishedAt?:string;value:unknown;}
export interface FactClaim{id:string;value:unknown;required:boolean;freshnessSensitive?:boolean;status:FactStatus;sources:FactSource[];premise?:string;}
export interface FactVerification{ok:boolean;claims:FactClaim[];blocked:string[];}
export function verifyFacts(claims:FactClaim[],options:{latestSourceByClaim?:Record<string,string>}={}):FactVerification{
 const checked=claims.map(claim=>{const values=new Set(claim.sources.map(s=>JSON.stringify(s.value)));let status:FactStatus=claim.status;
 if(claim.sources.length===0)status=claim.status==="INFERRED"?"INFERRED":"UNVERIFIED";else if(values.size>1)status="CONFLICTED";else if(claim.freshnessSensitive&&options.latestSourceByClaim?.[claim.id]&&!claim.sources.some(s=>s.id===options.latestSourceByClaim?.[claim.id]))status="UNVERIFIED";else if(JSON.stringify(claim.sources[0]?.value)===JSON.stringify(claim.value))status="CONFIRMED";else status="CONFLICTED";
 return{...claim,status};});
 const blocked=checked.filter(c=>c.required&&c.status!=="CONFIRMED").map(c=>c.id);
 return{ok:blocked.length===0,claims:checked,blocked};
}
