import type {OwnerRequirementIntake} from '../src/orchestrator/owner-requirement-intake.ts';
export interface SpecificationPublication {status:'DRAFT_OPEN';url:string;number:number;headSha:string;branch:string;canonicalSynced:false;}
export function createSpecificationPublisher(options:{root:string;intake:OwnerRequirementIntake;token?:string;fetchImpl?:typeof fetch;timeoutMs?:number}):{publish(decisionId:string,review:unknown):Promise<SpecificationPublication>};
