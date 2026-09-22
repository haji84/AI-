export type DeferredStatus="WAITING_CONNECTIVITY"|"READY"|"VERIFIED"|"REGENERATION_REQUIRED"|"BLOCKED";
export interface DeferredVerification{id:string;goalId:string;claimIds:string[];artifactRefs:string[];status:DeferredStatus;createdAt:string;lastCheckedAt?:string;}
export function queueDeferredVerification(input:Omit<DeferredVerification,"status">):DeferredVerification{return{...input,status:"WAITING_CONNECTIVITY"}}
export function reconnectDeferred(item:DeferredVerification,online:boolean):DeferredVerification{return{...item,status:online?"READY":"WAITING_CONNECTIVITY",lastCheckedAt:new Date().toISOString()}}
export function resolveDeferred(item:DeferredVerification,input:{factVerified:boolean;artifactStillMatches:boolean}):DeferredVerification{if(!input.factVerified)return{...item,status:"BLOCKED"};return{...item,status:input.artifactStillMatches?"VERIFIED":"REGENERATION_REQUIRED"}}
