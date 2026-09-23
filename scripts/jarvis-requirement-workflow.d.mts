import type {CanonicalBundle} from './jarvis-owner-spec-sync.mjs';
import type {OwnerRequirementRecord} from '../src/orchestrator/owner-requirement-intake.ts';
export function requirementWorkflow(records:OwnerRequirementRecord[],bundle:CanonicalBundle,root:string,publishAvailable:boolean):{publishAvailable:boolean;records:unknown[];requirements:unknown[]};
export function prepareOwnerPreview(record:OwnerRequirementRecord,bundle:CanonicalBundle,choice:unknown,root:string,history:OwnerRequirementRecord[]):{bundle:CanonicalBundle;files:{path:string;content:string;baseSha256:string}[];review:unknown;requirementIds:string[];summary:string;autoMerge:false};
