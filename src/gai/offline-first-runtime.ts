import type { DurableTask, DurableTaskExecutionClaim } from "./durable-task-runtime.ts";
import { DurableTaskRuntime } from "./durable-task-runtime.ts";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskProfile } from "./types.ts";
import {
  MultiWorkerRuntime,
  type WorkerCapability,
  type WorkerConnectivity,
  type WorkerExecutionRequest,
  type WorkerNetworkRequirement,
  type WorkerPlatform,
  type WorkerExecutionMode,
  type WorkerResourceRequirements,
} from "./worker-runtime.ts";

export type ConnectivityState = WorkerConnectivity;

export interface ConnectivityEvidence {
  previous: ConnectivityState;
  current: ConnectivityState;
  changedAt: string;
  reason: string;
}

export type ConnectivityListener = (evidence: ConnectivityEvidence) => void | Promise<void>;

export class ConnectivityManager {
  private stateValue: ConnectivityState;
  private readonly listeners = new Set<ConnectivityListener>();
  private lastEvidenceValue?: ConnectivityEvidence;

  constructor(initial: ConnectivityState = "online") {
    this.stateValue = initial;
  }

  get state(): ConnectivityState {
    return this.stateValue;
  }

  get lastEvidence(): ConnectivityEvidence | undefined {
    return this.lastEvidenceValue ? { ...this.lastEvidenceValue } : undefined;
  }

  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async transition(next: ConnectivityState, reason: string, now = new Date()): Promise<ConnectivityEvidence | null> {
    if (next === this.stateValue) return null;
    const evidence: ConnectivityEvidence = {
      previous: this.stateValue,
      current: next,
      changedAt: now.toISOString(),
      reason: reason.trim() || "connectivity state changed",
    };
    this.stateValue = next;
    this.lastEvidenceValue = evidence;
    for (const listener of this.listeners) await listener({ ...evidence });
    return { ...evidence };
  }
}

export interface OfflineExecutionPlan {
  networkRequirement: WorkerNetworkRequirement;
  requestedCapability: WorkerCapability;
  requiredCapabilities?: WorkerCapability[];
  preferredPlatform?: WorkerPlatform;
  requiredExecutionMode?: WorkerExecutionMode;
  allowOffline?: boolean;
  publicationRequired?: boolean;
  resourceRequirements?: WorkerResourceRequirements;
}

export type OfflineExecutionResolver = (task: DurableTask) => OfflineExecutionPlan;

export interface OfflineExecutionEvidence {
  taskId: string;
  connectivity: ConnectivityState;
  networkRequirement: WorkerNetworkRequirement;
  decision: "execute" | "publish" | "ready-to-publish" | "wait-connectivity" | "wait-resource";
  selectedWorkerId?: string;
  selectedPlatform?: WorkerPlatform;
  reason: string;
  at: string;
}

export interface OfflineExecutionOutcome {
  task: DurableTask;
  evidence: OfflineExecutionEvidence;
}

function networkUsable(state: ConnectivityState): boolean {
  return state === "online" || state === "recovering";
}

function canRunForConnectivity(
  requirement: WorkerNetworkRequirement,
  state: ConnectivityState,
  allowOffline = true,
): boolean {
  if (networkUsable(state)) return true;
  if (requirement === "online-required") return false;
  return allowOffline;
}

function toTaskProfile(task: DurableTask): TaskProfile {
  return {
    id: task.id,
    description: task.type,
    difficulty: 3,
    requiresFrontierReasoning: false,
    requiresLongContext: false,
    requiresToolUse: true,
    risk: "LOW",
  };
}

export class OfflineFirstExecutionCoordinator {
  private readonly tasks: DurableTaskRuntime;
  private readonly workers: MultiWorkerRuntime;
  private readonly connectivity: ConnectivityManager;
  private readonly resolve: OfflineExecutionResolver;
  private readonly leaseMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly publisher?: (task: DurableTask) => Promise<{ publisherId: string; receipt: unknown }>;

  constructor(options: {
    tasks: DurableTaskRuntime;
    workers: MultiWorkerRuntime;
    connectivity: ConnectivityManager;
    resolve: OfflineExecutionResolver;
    leaseMs?: number;
    heartbeatIntervalMs?: number;
    publisher?: (task: DurableTask) => Promise<{ publisherId: string; receipt: unknown }>;
  }) {
    this.tasks = options.tasks;
    this.workers = options.workers;
    this.connectivity = options.connectivity;
    this.resolve = options.resolve;
    this.leaseMs = options.leaseMs ?? 120_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) throw new Error("leaseMs must be positive");
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1, Math.floor(this.leaseMs / 3));
    if (!Number.isFinite(this.heartbeatIntervalMs) || this.heartbeatIntervalMs <= 0 || this.heartbeatIntervalMs >= this.leaseMs) {
      throw new Error("heartbeatIntervalMs must be positive and shorter than leaseMs");
    }
    this.publisher = options.publisher;

    this.connectivity.subscribe(async (event) => {
      if (event.current === "online") {
        await this.tasks.resumeWaiting("connectivity", new Date(event.changedAt));
      }
    });
  }

  async runNext(now = new Date()): Promise<OfflineExecutionOutcome | null> {
    if (networkUsable(this.connectivity.state)) {
      const publication = await this.tasks.nextPublication();
      if (publication && this.publisher) {
        const result = await this.publisher(publication);
        const completed = await this.tasks.completePublication(publication.id, result.publisherId, result.receipt, now);
        return { task: completed, evidence: { taskId: publication.id, connectivity: this.connectivity.state, networkRequirement: this.resolve(publication).networkRequirement, decision: "publish", reason: "saved offline execution result published without rebuilding", at: now.toISOString() } };
      }
    }
    for (;;) {
      const task = await this.tasks.next(now);
      if (!task) return null;
      const plan = this.resolve(task);
      const state = this.connectivity.state;

      if (!canRunForConnectivity(plan.networkRequirement, state, plan.allowOffline ?? true)) {
        await this.tasks.waitForConnectivity(
          task.id,
          `network requirement ${plan.networkRequirement} cannot run while ${state}`,
          now,
        );
        continue;
      }

      const request: WorkerExecutionRequest = {
        task: toTaskProfile(task),
        input: JSON.stringify({ taskId: task.id, type: task.type, payload: task.payload }),
        requestedCapability: plan.requestedCapability,
        requiredCapabilities: plan.requiredCapabilities ?? [plan.requestedCapability],
        preferredPlatform: plan.preferredPlatform,
        requiredExecutionMode: plan.requiredExecutionMode,
        requiredWorkerId: task.migrationClass === "PINNED" ? task.pinnedNodeId : undefined,
        resourceRequirements: plan.resourceRequirements,
        connectivity: state,
        allowOffline: plan.allowOffline ?? plan.networkRequirement !== "online-required",
      };

      let selection;
      try {
        selection = await this.workers.select(request);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const waiting = task.migrationClass === "PINNED"
          ? await this.tasks.waitForPinnedNode(task.id, reason, now)
          : await this.tasks.waitForResource(task.id, reason, now);
        return {
          task: waiting,
          evidence: {
            taskId: task.id,
            connectivity: state,
            networkRequirement: plan.networkRequirement,
            decision: "wait-resource",
            reason: waiting.history.at(-1)?.reason ?? "no worker resource available",
            at: now.toISOString(),
          },
        };
      }

      const claim = await this.tasks.leaseClaim(task.id, selection.worker.descriptor.id, this.leaseMs, now);
      await this.tasks.markRunningClaimed(claim, now);
      const wallStartedAt = Date.now();
      const clock = () => new Date(now.getTime() + Math.max(0, Date.now() - wallStartedAt));
      const execution = await this.executeWithClaimHeartbeat(
        claim,
        () => selection.worker.execute(request),
        clock,
      );
      const result = execution.result;
      const finalClaim = execution.claim;
      const finishedAt = clock();

      const readyToPublish = result.ok && plan.publicationRequired === true && !networkUsable(state);
      const finalTask = result.ok
        ? readyToPublish
          ? await this.tasks.readyToPublishClaimed(finalClaim, {
              output: result.output,
              evidence: result.evidence ?? null,
            }, finishedAt)
          : await this.tasks.completeClaimed(finalClaim, {
            output: result.output,
            evidence: result.evidence ?? null,
          }, finishedAt)
        : await this.tasks.failClaimed(finalClaim, result.output, 0, finishedAt);

      return {
        task: finalTask,
        evidence: {
          taskId: task.id,
          connectivity: state,
          networkRequirement: plan.networkRequirement,
          decision: readyToPublish ? "ready-to-publish" : "execute",
          selectedWorkerId: selection.worker.descriptor.id,
          selectedPlatform: selection.worker.descriptor.platform,
          reason: readyToPublish
            ? "offline development verified and persisted for publication after reconnect"
            : result.ok ? "offline-first execution completed" : "worker execution failed and entered retry policy",
          at: finishedAt.toISOString(),
        },
      };
    }
  }

  private async executeWithClaimHeartbeat<T>(
    initialClaim: DurableTaskExecutionClaim,
    execute: () => Promise<T>,
    clock: () => Date,
  ): Promise<{ result: T; claim: DurableTaskExecutionClaim }> {
    let claim = initialClaim;
    let heartbeatError: unknown;
    const abort = new AbortController();
    const heartbeat = (async () => {
      while (!abort.signal.aborted) {
        try {
          await delay(this.heartbeatIntervalMs, undefined, { signal: abort.signal });
        } catch (error) {
          if (abort.signal.aborted) return;
          heartbeatError = error;
          return;
        }
        if (abort.signal.aborted) return;
        try {
          claim = await this.tasks.heartbeatClaimed(claim, this.leaseMs, clock());
        } catch (error) {
          heartbeatError = error;
          return;
        }
      }
    })();

    let result: T;
    try {
      result = await execute();
    } finally {
      abort.abort();
      await heartbeat;
    }

    if (heartbeatError) {
      const detail = heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError);
      throw new Error(`EXECUTION_LEASE_LOST: ${detail}`);
    }
    return { result, claim };
  }
}

export function createStaticOfflineExecutionResolver(
  plans: Readonly<Record<string, OfflineExecutionPlan>>,
): OfflineExecutionResolver {
  return (task) => {
    const plan = plans[task.type];
    if (!plan) throw new Error(`No offline execution plan registered for task type ${task.type}`);
    return plan;
  };
}
