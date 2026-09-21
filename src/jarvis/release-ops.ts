export type ServiceCheck={name:string;ok:boolean;detail?:string};
export type RecoveryObjectives={slo:number;rtoMinutes:number;rpoMinutes:number};
export type BackupManifest={createdAt:string;commit:string;stateVersion:string;artifacts:Array<{name:string;checksum:string;required:boolean}>};
export class ReleaseOperations {
  readiness(checks:ServiceCheck[],objectives:RecoveryObjectives){const failed=checks.filter(x=>!x.ok);return {ready:failed.length===0&&objectives.slo>=0.99&&objectives.rtoMinutes>0&&objectives.rpoMinutes>=0,failed,objectives};}
  firstRunState(input:{ownerAuth:boolean;coordinator:boolean;privateIngress:boolean;backup:boolean;diagnostics:boolean}){const steps=[["owner-auth",input.ownerAuth],["coordinator",input.coordinator],["private-ingress",input.privateIngress],["backup",input.backup],["diagnostics",input.diagnostics]] as const;return {complete:steps.every(([,ok])=>ok),steps:steps.map(([id,ok])=>({id,status:ok?"done":"pending"}))};}
  validateBackup(manifest:BackupManifest,available:Set<string>){const missing=manifest.artifacts.filter(a=>a.required&&!available.has(a.name));return {restorable:missing.length===0,missing:missing.map(x=>x.name)};}
  rollbackPlan(currentCommit:string,previousCommit:string){if(!currentCommit||!previousCommit||currentCommit===previousCommit)throw new Error("distinct commits required");return {from:currentCommit,to:previousCommit,steps:["pause-new-work","snapshot-current-state","deploy-previous-commit","restore-compatible-state","health-check","resume-work"]};}
  diagnostics(checks:ServiceCheck[]){return {ok:checks.every(x=>x.ok),checks,summary:checks.filter(x=>!x.ok).map(x=>x.name)};}
}
