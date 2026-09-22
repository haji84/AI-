import{verifyFacts,type FactClaim,type FactVerification}from "./fact-verifier.ts";
export interface FactGateInput{claims:FactClaim[];latestSourceByClaim?:Record<string,string>;waivedClaimIds?:string[];}
export interface FactGateResult{passed:boolean;verification:FactVerification;blockedClaims:string[];waivedClaims:string[];}
export function evaluateFactCompletionGate(input:FactGateInput):FactGateResult{const verification=verifyFacts(input.claims,{latestSourceByClaim:input.latestSourceByClaim});const waived=new Set(input.waivedClaimIds??[]);const blockedClaims=verification.blocked.filter(id=>!waived.has(id));return{passed:blockedClaims.length===0,verification,blockedClaims,waivedClaims:verification.blocked.filter(id=>waived.has(id))};}
