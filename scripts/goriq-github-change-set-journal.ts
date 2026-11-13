import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertDevelopmentChangeSet, type DevelopmentChangeSet } from '../src/orchestrator/development-change-set.ts';
import { JsonFileDevelopmentChangeSetStore } from '../src/orchestrator/development-change-set-store.ts';
import type { ResidentDevelopmentGoalHost } from '../src/orchestrator/resident-development-goal-host.ts';
import type { GitHubGoalCheckpoint } from './goriq-github-coordinator-store.ts';
import type { GitHubFencedCheckpointStores } from './goriq-github-checkpoint-stores.ts';

type CheckpointPort = Pick<GitHubFencedCheckpointStores, 'load' | 'commitTogether'>;
const IMPORT = 'goriq-change-set-import-v1';
const UPDATE = 'goriq-change-set-update-v1';
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = new Set(['LOCAL', 'VERIFIED', 'READY_TO_PUBLISH', 'PUBLISHED', 'REJECTED']);
const FIELDS = new Set(['version','changeSetId','jobId','workItemId','deviceId','baseRevision',
  'candidateRevision','changedPaths','affectedSymbols','patchDigest','artifactDigest','artifactRef',
  'tddPhase','tddEvidenceDigest','evidenceDigest','rollback','status','createdAt','updatedAt']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(code: string): never { throw Error(`GITHUB_COORDINATOR_CHANGE_SET_${code}`); }
function exact(v: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(v).sort().join(',') === keys.sort().join(',');
}
function validate(value: unknown): DevelopmentChangeSet {
  try {
    if (!record(value) || Object.keys(value).some(key => !FIELDS.has(key))) fail('INVALID');
    const clean = JSON.parse(JSON.stringify(value)) as DevelopmentChangeSet;
    assertDevelopmentChangeSet(clean);
    if (!STATUSES.has(clean.status) || clean.artifactRef !== `sha256:${clean.artifactDigest}` ||
        !Array.isArray(clean.affectedSymbols) || clean.affectedSymbols.some(x => typeof x !== 'string') ||
        !['git-base','reverse-patch','known-good-artifact'].includes(clean.rollback.kind) ||
        (clean.tddPhase !== undefined && !['red','green'].includes(clean.tddPhase)) ||
        new Date(clean.createdAt).toISOString() !== clean.createdAt ||
        new Date(clean.updatedAt).toISOString() !== clean.updatedAt ||
        Date.parse(clean.updatedAt) < Date.parse(clean.createdAt)) fail('INVALID');
    return clean;
  } catch { fail('INVALID'); }
}
function bind(value: DevelopmentChangeSet, checkpoint: GitHubGoalCheckpoint): void {
  if (!checkpoint.developmentJobs) fail('JOBS_NOT_IMPORTED');
  const job = checkpoint.developmentJobs.jobs.find(item => item.jobId === value.jobId);
  if (!job || job.goalId !== checkpoint.goalId || job.baseRevision !== value.baseRevision ||
      !job.workItems.some(item => item.id === value.workItemId)) fail('BINDING_INVALID');
}
function changed(previous: DevelopmentChangeSet | undefined, next: DevelopmentChangeSet): void {
  if (!previous) {
    if (!['LOCAL','REJECTED'].includes(next.status) && !(next.status === 'VERIFIED' && next.tddPhase === 'red')) fail('INITIAL_STATUS');
    return;
  }
  const identity = (v: DevelopmentChangeSet) => {
    const copy = { ...v } as Partial<DevelopmentChangeSet>;
    delete copy.status; delete copy.updatedAt;
    return copy;
  };
  if (!isDeepStrictEqual(identity(previous), identity(next))) fail('IDENTITY_CONFLICT');
  if (['REJECTED','PUBLISHED'].includes(previous.status) && previous.status !== next.status) fail('TERMINAL');
  if (Date.parse(next.updatedAt) <= Date.parse(previous.updatedAt)) fail('STALE');
}

/** Read-only projection over already authenticated, append-only checkpoint
 * events. The import marker must come from an authorized source migration.
 * No absent baseline is treated as an empty original and this module has no
 * import/bootstrap API. A stored status is metadata, never a verifier grant. */
function project(checkpoint: GitHubGoalCheckpoint): Map<string, DevelopmentChangeSet> {
  if (!checkpoint.developmentJobs) fail('JOBS_NOT_IMPORTED');
  const values = new Map<string, DevelopmentChangeSet>();
  const ids = new Set<string>(); let imported = false;
  for (const event of checkpoint.events) {
    const item = event.record;
    if (!record(item) || typeof item.kind !== 'string' || !item.kind.startsWith('goriq-change-set-')) continue;
    if (![IMPORT,UPDATE].includes(item.kind) || typeof event.eventId !== 'string' || ids.has(event.eventId) ||
        !HASH.test(event.recordSha256) || digest(item) !== event.recordSha256 ||
        item.goalId !== checkpoint.goalId || item.goalContractDigest !== checkpoint.goalContractDigest) fail('JOURNAL_INVALID');
    ids.add(event.eventId);
    if (item.kind === IMPORT) {
      if (imported || !exact(item,['kind','goalId','goalContractDigest','changeSets','snapshotSha256']) ||
          !Array.isArray(item.changeSets) || item.snapshotSha256 !== digest(item.changeSets)) fail('JOURNAL_INVALID');
      for (const raw of item.changeSets) {
        const value = validate(raw); bind(value,checkpoint);
        if (values.has(value.changeSetId)) fail('JOURNAL_INVALID');
        values.set(value.changeSetId,value);
      }
      imported = true;
    } else {
      if (!imported || !exact(item,['kind','goalId','goalContractDigest','previousRecordSha256','value'])) fail('JOURNAL_INVALID');
      const value = validate(item.value); bind(value,checkpoint);
      const previous = values.get(value.changeSetId);
      if (item.previousRecordSha256 !== (previous ? digest(previous) : null)) fail('JOURNAL_INVALID');
      try { changed(previous,value); } catch { fail('JOURNAL_INVALID'); }
      values.set(value.changeSetId,value);
    }
  }
  if (!imported) fail('IMPORT_REQUIRED');
  return values;
}

/** Change Sets share the existing Goal/Job/lease fenced root CAS. Every version
 * is retained as an event; concurrent updates are never retried with fresh
 * authority. Artifact bytes, external side effects and wakeup remain separate. */
export class GitHubChangeSetJournal {
  readonly #checkpoints: CheckpointPort;
  constructor(checkpoints: CheckpointPort) {
    if (!checkpoints || typeof checkpoints.load !== 'function' || typeof checkpoints.commitTogether !== 'function') fail('PORT_INVALID');
    this.#checkpoints = checkpoints;
  }
  async get(changeSetId: string): Promise<DevelopmentChangeSet | null> {
    return structuredClone(project(await this.#checkpoints.load()).get(changeSetId) ?? null);
  }
  async list(): Promise<DevelopmentChangeSet[]> {
    return structuredClone([...project(await this.#checkpoints.load()).values()]);
  }
  async put(input: DevelopmentChangeSet, now = new Date()): Promise<void> {
    if (!Number.isFinite(now.getTime())) fail('INVALID');
    const value = validate(input);
    const current = await this.#checkpoints.load();
    const values = project(current); bind(value,current);
    const previous = values.get(value.changeSetId);
    // Idempotence proves only that this metadata is already stored, not that
    // a caller still holds an execution lease or may perform external work.
    if (previous && isDeepStrictEqual(previous,value)) return;
    changed(previous,value);
    const entry = {kind:UPDATE,goalId:current.goalId,goalContractDigest:current.goalContractDigest,
      previousRecordSha256:previous ? digest(previous) : null,value};
    const next = structuredClone(current);
    next.events.push({eventId:`changeset:${randomUUID()}`,record:entry,recordSha256:digest(entry)});
    if (!(await this.#checkpoints.commitTogether(current,next))) fail('CONFLICT');
  }
}

/** Preserve the existing resident host's concrete store contract. The base
 * constructor only records a path; all three public methods are overridden,
 * so no local file or local fallback exists in this explicit shared adapter. */
export class GitHubResidentChangeSetStore extends JsonFileDevelopmentChangeSetStore {
  readonly #journal: GitHubChangeSetJournal;
  constructor(checkpoints: CheckpointPort) {
    super(""); // Never passed to a filesystem operation by this adapter.
    this.#journal = new GitHubChangeSetJournal(checkpoints);
  }
  override async get(id: string): Promise<DevelopmentChangeSet | null> { return this.#journal.get(id); }
  override async list(): Promise<DevelopmentChangeSet[]> { return this.#journal.list(); }
  override async put(value: DevelopmentChangeSet, now = new Date()): Promise<void> { await this.#journal.put(value,now); }
}

/** Explicit assembly for the EXISTING ResidentDevelopmentGoalHost options.
 * It does not activate an executor, create a Goal, infer owner authority or
 * publish an artifact. Missing imported history refuses the entire binding. */
export async function createGitHubResidentPersistence(stores: GitHubFencedCheckpointStores): Promise<
  Pick<ConstructorParameters<typeof ResidentDevelopmentGoalHost>[0], 'jobs' | 'changeSets'>> {
  const changeSets = new GitHubResidentChangeSetStore(stores);
  await changeSets.list();
  return {jobs:stores.developmentJobs,changeSets};
}
