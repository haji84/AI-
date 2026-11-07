import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { boundedRead, containedFile } from '../gai/cognitive-local-outcomes.ts';
import { completionDigest, type CompletionRequirement } from './completion-path.ts';
import type { CompletionSource, BoundCompletionCandidate } from './completion-execution.ts';
import type { DevelopmentEvidence } from './development-job.ts';
import type { Goal } from './goal-loop.ts';

interface ArtifactCheck { criterionId: string; taskId: string; path: string; expectedSha256: string }
interface RuntimeHandoff {
  version: 1; goalId: string; goalDigest: string; sourceRevision: string; dataRootDigest: string; expiresAt: string;
  requirements: CompletionRequirement[]; candidates: BoundCompletionCandidate[]; checks: ArtifactCheck[];
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const issuer = 'completion-local-sha256-v1';
const environment = (check: ArtifactCheck) => `host-local-artifact:${check.path}`;
function shape(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Error(`invalid ${label}`);
}

/** Host configuration only. Owner text, model context and HTTP cannot set pins or paths. */
export async function loadCompletionRuntimeHandoff(env: Record<string, string | undefined>, goalId: string, goal: Goal): Promise<CompletionSource | undefined> {
  const values = ['GORIQ_COMPLETION_HANDOFF_PATH', 'GORIQ_COMPLETION_HANDOFF_SHA256', 'GORIQ_COMPLETION_DATA_ROOT'].map(k => env[k]?.trim());
  if (values.every(v => !v)) return undefined;
  const [file, pin, configuredRoot] = values;
  if (!file || !pin || !configuredRoot || !isAbsolute(file) || !isAbsolute(configuredRoot) || !/^[a-f0-9]{64}$/.test(pin)) throw Error('incomplete completion host configuration');
  if ((await lstat(configuredRoot)).isSymbolicLink()) throw Error('unsafe completion data root');
  const root = await realpath(configuredRoot);
  const revision = env.GORIQ_RUNTIME_REVISION;
  async function inspectHandoff(): Promise<RuntimeHandoff> {
    const bytes = await boundedRead(await containedFile(dirname(file!), basename(file!)), 256_000);
    if (sha(bytes) !== pin) throw Error('completion handoff digest mismatch');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    shape(value, ['version', 'goalId', 'goalDigest', 'sourceRevision', 'dataRootDigest', 'expiresAt', 'requirements', 'candidates', 'checks'], 'completion handoff');
    if (value.version !== 1 || value.goalId !== goalId || value.goalDigest !== completionDigest(goal)) throw Error('completion handoff Goal mismatch');
    if (!/^[a-f0-9]{40}$/.test(String(revision)) || value.sourceRevision !== revision) throw Error('completion runtime revision mismatch');
    if (value.dataRootDigest !== sha(root)) throw Error('completion data root mismatch');
    if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw Error('completion handoff expired');
    if (!Array.isArray(value.requirements) || !value.requirements.length || value.requirements.length > 64 || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > 64 || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 64) throw Error('completion handoff capacity');
    const handoff = value as unknown as RuntimeHandoff;
    // The initial normal-environment adapter revalidates artifacts through the
    // existing read-only capability. It cannot install executors or invoke a model.
    for (const c of handoff.candidates) {
      if (c.action?.capability !== 'context.inspect' || c.workItem?.requiredCapabilities.some(id => id !== 'context.inspect') || c.action.input !== undefined) throw Error('unsupported completion runtime capability');
    }
    for (const check of handoff.checks) {
      shape(check, ['criterionId', 'taskId', 'path', 'expectedSha256'], 'artifact check');
      if (typeof check.path !== 'string' || !check.path || isAbsolute(check.path) || win32.isAbsolute(check.path) || check.path.includes(':') || check.path.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || /^(?:\.git|\.env.*|credentials?)$/i.test(p))) throw Error('invalid artifact path');
      const rel = relative(root, resolve(root, check.path));
      if (isAbsolute(rel) || rel.startsWith('..' + sep) || !/^[a-f0-9]{64}$/.test(String(check.expectedSha256)) || !goal.successCriteria.some((_, i) => check.criterionId === `criterion-${i + 1}`) || !handoff.candidates.some(c => c.workItem.id === check.taskId && c.criterionIds.includes(check.criterionId))) throw Error('invalid artifact binding');
      if (!handoff.requirements.some(r => r.criterionId === check.criterionId && r.evidence.some(e => e.kind === 'software' && e.environment === environment(check) && e.sourceRevision === revision && e.artifactDigest === check.expectedSha256 && e.trustedIssuers.includes(issuer)))) throw Error('artifact check has no evidence requirement');
    }
    if (new Set(handoff.checks.map(c => `${c.criterionId}:${c.path}`)).size !== handoff.checks.length) throw Error('duplicate artifact check');
    return handoff;
  }
  const accepted = await inspectHandoff();
  // Preserve the entire reviewed evidence contract, including conditions this
  // verifier cannot prove (physical operation, download, publication, etc.).
  const requirements = structuredClone(accepted.requirements);
  async function observeChecks(checks: ArtifactCheck[]): Promise<DevelopmentEvidence[]> {
    const result: DevelopmentEvidence[] = [];
    for (const check of checks) {
      let verified = false;
      try { verified = sha(await boundedRead(await containedFile(root, check.path), 1_048_576)) === check.expectedSha256; } catch { /* Missing/unsafe artifacts are failed evidence. */ }
      result.push({ id: `artifact:${completionDigest(check)}`, criterionId: check.criterionId, kind: 'software', environment: environment(check), issuer,
        sourceRevision: revision!, artifactDigest: check.expectedSha256, verified, recordedAt: new Date().toISOString() });
    }
    return result;
  }
  return {
    async inspect(state) {
      await inspectHandoff();
      if (state.goalId !== goalId || state.objective !== (goal.description?.trim() || goal.title) || completionDigest(state.definitionOfDone.map(c => c.description)) !== completionDigest(goal.successCriteria)) throw Error('completion current Goal changed');
      // Failure is observed before selection; successful completion requires a
      // recorded action plus an independent readback, never an executor boolean.
      const failures = (await observeChecks(accepted!.checks)).filter(e => !e.verified);
      return { requirements, candidates: structuredClone(accepted!.candidates), capabilities: { 'context.inspect': true }, evidence: failures };
    },
    async observe(record) {
      await inspectHandoff();
      if (!record.action || !record.verification?.ok) return [];
      const candidate = accepted!.candidates.find(c => c.action.id === record.action!.id);
      if (!candidate) throw Error('unbound completion observation');
      return observeChecks(accepted!.checks.filter(c => c.taskId === candidate.workItem.id));
    },
  };
}
