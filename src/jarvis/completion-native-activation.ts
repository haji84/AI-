export interface CompletionActivationApproval {
  version: 1; issue: 1858; operation: 'five-target-acl-and-native-cutover';
  ownerSid: string; ownerResponse: string; questionItem: string; proposalSha256: string;
  approvedAt: string; forwardUntil: string; expiresAt: string;
}
const fields = ['version', 'issue', 'operation', 'ownerSid', 'ownerResponse', 'questionItem', 'proposalSha256', 'approvedAt', 'forwardUntil', 'expiresAt'];
export function validateCompletionSource(value: unknown, revision: string): void {
  const proof = value as { number?: number; merged?: boolean; merge_commit_sha?: string; base?: { ref?: string; repo?: { full_name?: string } }; head?: { ref?: string; repo?: { full_name?: string } } } | null;
  if (!/^[a-f0-9]{40}$/.test(revision) || proof?.number !== 1863 || proof.merged !== true || proof.merge_commit_sha !== revision ||
    proof.base?.ref !== 'main' || proof.base.repo?.full_name !== 'haji84/AI-' ||
    proof.head?.ref !== 'codex/1858-native-console-host' || proof.head.repo?.full_name !== 'haji84/AI-') throw Error('COMPLETION_NATIVE_SOURCE_REJECTED');
}
export function validateCompletionActivation(value: unknown, phase: 'forward' | 'recovery', now = new Date()): CompletionActivationApproval {
  const a = value as CompletionActivationApproval;
  if (!a || typeof a !== 'object' || Object.keys(a).length !== fields.length || Object.keys(a).some(k => !fields.includes(k)) ||
    a.version !== 1 || a.issue !== 1858 || a.operation !== 'five-target-acl-and-native-cutover' ||
    a.ownerSid !== 'S-1-5-21-3241814747-1938433149-1705921193-1004' ||
    a.ownerResponse !== 'この限定範囲の実装・権限修復・常用反映を承認する' ||
    a.questionItem !== 'call_d6ff976d41c642de923b5e70cd50164a:0' ||
    a.proposalSha256 !== 'b1bfc50a28f7fd65b4c8819ae3da10f98e4739b217abb9115430d04a105866a7' ||
    a.approvedAt !== '2026-10-23T11:16:26Z' || a.forwardUntil !== '2026-10-23T14:30:00Z' || a.expiresAt !== '2026-10-23T14:59:59Z' ||
    !['forward', 'recovery'].includes(phase) || !Number.isFinite(now.getTime()) ||
    now.getTime() < Date.parse(a.approvedAt) || now.getTime() >= Date.parse(phase === 'forward' ? a.forwardUntil : a.expiresAt)) {
    throw Error('COMPLETION_NATIVE_APPROVAL_REQUIRED');
  }
  return structuredClone(a);
}
export function prepareCompletionConfiguration<T extends { version: number; commit: string; releaseRoot: string; environment: Record<string, unknown> }>(current: T, revision: string, approval: unknown, now = new Date()): T {
  validateCompletionActivation(approval, 'forward', now);
  const old = 'a49c458d69a28c0266be8fcad5b26253e5ed8d75';
  const root = 'C:\\Users\\qq113\\JARVIS\\releases\\';
  if (current.version !== 1 || current.commit !== old || current.releaseRoot !== root + old ||
    !/^[a-f0-9]{40}$/.test(revision) || revision === old || !current.environment ||
    typeof current.environment !== 'object' || Array.isArray(current.environment)) throw Error('COMPLETION_NATIVE_CONFIGURATION_REJECTED');
  return { ...structuredClone(current), commit: revision, releaseRoot: root + revision };
}
