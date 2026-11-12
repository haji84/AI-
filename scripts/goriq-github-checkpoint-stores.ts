import { isDeepStrictEqual } from 'node:util';
import type { CoordinatorClaim } from '../src/gai/distributed-coordinator.ts';
import type { WorkRunState, WorkRunStore } from '../src/orchestrator/work-run-state.ts';
import type { DurableTaskSnapshot, DurableTaskStore } from '../src/gai/durable-task-runtime.ts';
import type { DevelopmentJobStore } from '../src/orchestrator/development-job-store.ts';
import { assertDevelopmentJob } from '../src/orchestrator/development-job.ts';
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

  constructor(store: GitHubCoordinatorStore, claim: () => CoordinatorClaim | Promise<CoordinatorClaim>) {
    if (!store || typeof claim !== 'function') throw Error('GITHUB_COORDINATOR_ADAPTER_INVALID');
    this.#store = store;
    this.#claim = claim;
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
          // This adapter does not independently admit a new Job. The canonical
          // State Controller must create/admit it through the established path.
          throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_NOT_ADMITTED');
        }
        if (Date.parse(job.updatedAt) < Date.parse(prior.updatedAt))
          throw Error('GITHUB_COORDINATOR_DEVELOPMENT_JOB_STALE');
        const proposed=structuredClone(checkpoint);
        proposed.developmentJobs!.jobs=proposed.developmentJobs!.jobs.map(item=>
          item.jobId===job.jobId ? structuredClone(job) : item);
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
