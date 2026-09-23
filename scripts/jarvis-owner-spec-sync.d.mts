import type { OwnerRequirementRecord, CanonicalRequirement } from '../src/orchestrator/owner-requirement-intake.ts';
export interface CanonicalBundle { ledger: string; matrix: {requirements: CanonicalRequirement[]}; decisions: unknown; inventory: {schema_version:1;allocations:{id:string;decision_id:string;created_at:string;required_evidence:string[]}[]}; }
export function loadCanonicalBundle(root: string): CanonicalBundle;
export function verifyCanonicalReceipt(record: OwnerRequirementRecord, bundle: CanonicalBundle, root: string): {ok: boolean; state?: string; reason?: string; canonicalSha256?: string; decisionId?: string};
export function prepareSpecificationProposal(record: OwnerRequirementRecord, bundle: CanonicalBundle, review: unknown, root: string, history?: OwnerRequirementRecord[]): {kind: string; decisionId: string; reviewRequired: true; autoMerge: false; productionAuthorized: false; files: {path: string; baseSha256: string; content: string}[]; bundle: CanonicalBundle};

export const CANONICAL_PATHS:string[];
