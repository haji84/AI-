import { isDeepStrictEqual } from 'node:util';
import type { CoordinatorClaim } from '../src/gai/distributed-coordinator.ts';
import type { WorkRunState, WorkRunStore } from '../src/orchestrator/work-run-state.ts';
import type { DurableTaskSnapshot, DurableTaskStore } from '../src/gai/durable-task-runtime.ts';
import type { DevelopmentJobStore } from '../src/orchestrator/development-job-store.ts';
import { assertDevelopmentJob, type DevelopmentJob } from '../src/orchestrator/development-job.ts';
import { GitHubCoordinatorStore, type GitHubGoalCheckpoint } from './goriq-github-coordinator-store.ts';

/** Optional, source-only adapters for the EXISTING State Controller.
 * No Goal bootstrapping, new authority, scheduler, runtime activation or
 * credential provisioning. Production must inject an authenticated claim from
 * the canonical Coordinator, not instantiate a claim from public GitHub text.
 */
export class GitHubFencedCheckpointStores {
  readonly workRun: WorkRunStore;
  readonly tasks: DurableTaskStore;
  readonly developmentJobs: DevelopmentJobStore;
  readonly #store: GitHubCoordinatorStore;
  readonly #claim: () => CoordinatorClaim | Promise<CoordinatorClaim>;
  readonly #admitDevelopmentJob?: (job: DevelopmentJob, checkpoint: GitHubGoalCheckpoint) => boolean | Promise<boolean>;

  constructor(store: GitHubCoordinatorStore, claim: () => CoordinatorClaim | Promise<CoordinatorClaim>,
    options: {admitDevelopmentJob?: (job: DevelopmentJob, checkpoint: GitHubGoalCheckpoint) => boolean | Promise<boolean>} = {}) {
    if (!store || typeof claim !== 'function') throw Error('GITHUB_COORDINATOR_ADAPTER_INVALID');
    this.#store = store;
    this.#claim = claim;
    this.#admitDevelopmentJob = options.admitDevelopmentJob;
    let observedRun: WorkRunState | null = null;

    this.workRun = {
      getByGoal: async (goalId: string): Promise<WorkRunState | null> => {
        const current = await this.#store.loadCheckpoint();
        if (current.goalId !== goalId) { observedRun = null; return null; }
        observedRun = structuredClone(current.workRun);
        return structuredClone(current.workRun);
      },
      put: async (next: WorkRunState): Promise<void> => {
        if (!observedRun || !isDeepStrictEqual(next?.goalId, observedRun.goalId) ||
            next.runId !== observedRun.runId) throw Error('GITHUB_COORDINATOR_WORKRUN_READ_REQUIRED');
        const checkpoint = await this.#store.loadCheckpoint();
        if (!isDeepStrictEqual(checkpoint.workRun, observedRun)) throw Error('GITHUB_COORDINATOR_WORKRUN_STALE');
        if (!Number.isFinite(Date.parse(next.updatedAt)) ||
            Date.parse(next.updatedAt) < Date.parse(observedRun.updatedAt) ||
            next.completedJobs < observedRun.completedJobs ||
            (observedRun.phase === 'COMPLETED' && next.phase !== 'COMPLETED'))
          throw Error('GITHUB_COORDINATOR_WORKRUN_STALE');
        const proposed = structuredClone(checkpoint);
        proposed.workRun = structuredClone(next);
        if (!(await this.commitTogether(checkpoint, proposed))) throw Error('GITHUB_COORDINATOR_WORKRUN_CONFLICT');
        observedRun = structuredClone(next);
      },
    };
    this.developmentJobs = {
      get: async (jobId) => {
        const checkpoint = await this.#store.loadCheckpoint();
        if (!checkpoint.developmentJobs) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOBS_NOT_IMPORTED');
        return structuredClone(checkpoint.developmentJobs.jobs.find(job=>job.jobId === jobId) ?? null);
      },
      getByGoal: async (goalId) => {
        const checkpoint = await this.#store.loadCheckpoint();
        if (!checkpoint.developmentJobs) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOBS_NOT_IMPORTED');
        return structuredClone(checkpoint.developmentJobs.jobs.filter(job=>job.goalId===goalId));
      },
      list: async () => {
        const checkpoint = await this.#store.loadCheckpoint();
        if (!checkpoint.developmentJobs) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOBS_NOT_IMPORTED');
        return structuredClone(checkpoint.developmentJobs.jobs);
      },
      put: async (job,now=new Date()) => {
        try {assertDevelopmentJob(job);} catch {throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_INVALID');}
        if (!Number.isFinite(now.getTime())) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_INVALID');
        const checkpoint = await this.#store.loadCheckpoint();
        if (!checkpoint.developmentJobs) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOBS_NOT_IMPORTED');
        if (job.goalId!==checkpoint.goalId) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_GOAL_MISMATCH');
        const prior = checkpoint.developmentJobs.jobs.find(item=>item.jobId===job.jobId);
        if (!prior) {
          // ResidentDevelopmentGoalHost creates successor Jobs with put().
          // The ordinary store never grants admission by itself: only an
          // explicitly injected canonical State Controller authority gate may
          // admit a pristine Job for the already-authenticated Goal. A gate is
          // not a substitute for task-scope/approval checks or an actual lease.
          const first=job.history[0];
          const pristine=job.phase==='QUEUED'||job.phase==='PLANNING';
          const initial=first?.transitionId===`create:${job.jobId}` &&
            first.from===null && first.to==='QUEUED' && first.actor==='state-controller';
          const transitions=job.history.slice(1).every((entry,index) =>
            entry.actor==='state-controller' && entry.from===(index===0?'QUEUED':job.history[index]!.to) &&
            entry.to==='PLANNING');
          if (!this.#admitDevelopmentJob || !['QUEUED','PLANNING','RUNNING','RECOVERING'].includes(checkpoint.workRun.phase) ||
              !pristine || !initial || !transitions || job.history.length>2 ||
              job.history.at(-1)?.to!==job.phase ||
              job.attempts.length!==0 || job.failureSignatures.length!==0 ||
              job.rejectedStrategyIds.length!==0 || job.evidence.some(entry=>entry.verified) ||
              job.approvalScope.expiresAt !== undefined &&
                Date.parse(job.approvalScope.expiresAt)<=Date.now())
            throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED');
          const granted=await this.#admitDevelopmentJob(structuredClone(job),structuredClone(checkpoint));
          if (granted!==true) throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED');
        } else if (Date.parse(job.updatedAt) < Date.parse(prior.updatedAt)) {
          throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_STALE');
        }
        const proposed=structuredClone(checkpoint);
        proposed.developmentJobs!.jobs=prior ? proposed.developmentJobs!.jobs.map(item=>
          item.jobId===job.jobId ? structuredClone(job) : item) :
          [...proposed.developmentJobs!.jobs,structuredClone(job)];
        proposed.developmentJobs!.savedAt=now.toISOString();
        if (!(await this.commitTogether(checkpoint,proposed)))
          throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_CONFLICT');
      },
    };
    this.tasks = {
      load: async () => structuredClone((await this.#store.loadCheckpoint()).tasks),
      save: async () => {throw Error('GITHUB_COORDINATOR_CAS_REQUIRED');},
      compareAndSwap: async (expected: DurableTaskSnapshot|null, next: DurableTaskSnapshot): Promise<boolean> => {
        if (!expected) throw Error('GITHUB_COORDINATOR_TASK_SNAPSHOT_REQUIRED');
        const checkpoint = await this.#store.loadCheckpoint();
        if (!isDeepStrictEqual(checkpoint.tasks, expected)) return false;
        const proposed = structuredClone(checkpoint);
        proposed.tasks = structuredClone(next);
        return this.commitTogether(checkpoint, proposed);
      },
    };
  }

  /** The caller supplies a pre-authenticated, existing Goal snapshot. Exactly
   * one coordinator-root SHA CAS binds the WorkRun, durable Job transitions,
   * attempt/event history, and current fence. A conflict is NOT retried or
   * turned into a second Goal/Job. Device/external side effects require their
   * own downstream fencing and remain outside this source-only adapter.
   */
  async load(): Promise<GitHubGoalCheckpoint> {
    return this.#store.loadCheckpoint();
  }
  async commitTogether(expected: GitHubGoalCheckpoint, next: GitHubGoalCheckpoint): Promise<boolean> {
    const current = await this.#store.loadCheckpoint();
    if (!isDeepStrictEqual(current, expected)) return false;
    const claim = await this.#claim();
    return this.#store.compareAndSwapCheckpoint(current, next, claim);
  }
}
