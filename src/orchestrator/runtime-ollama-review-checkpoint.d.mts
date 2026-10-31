/** Additional local observations are not signed release/AI09 authority. */
export interface RuntimeLocalModelReview {
  ok: boolean;
  status: string;
  blocker?: string | null;
  reused: boolean;
  taskKey?: string;
  receiptPath?: string;
  receiptDigest?: string;
  evidenceKind?: string;
  review?: unknown;
  formalAI09ReviewExecuted: false;
  githubApprovalSatisfied: false;
  mergeAuthorized: false;
}
export function reviewRuntimeCandidate(options: {
  config: unknown;
  actionId: string;
  input: unknown;
  evidence: unknown;
  fetchImpl?: typeof fetch;
}): Promise<RuntimeLocalModelReview>;
