import type { ContextItem, ContextSource, LoopState, StateStore, WriteBackRecord } from "./goal-loop.ts";
import type { GitHubReadClient } from "./github-capability.ts";
import type { CompassStore } from "../compass/store.ts";
import { CompassStateStoreAdapter, compassStateToLoopState } from "./compass-state-store.ts";

export const DEFAULT_CLOUD_GOAL = {
  title: "Advance the repository according to its explicit project state",
  description: "Read PROJECT_STATE.md, AGENTS.md, relevant issues/PRs and current verification state; choose the smallest safe next action; execute only bounded low-risk work; verify and write back.",
  successCriteria: [
    "Current explicit repository goal is complete",
    "Required verification passes",
    "No unresolved blocker remains",
  ],
  constraints: [
    "Preserve Human Gate for merge, deployment, destructive changes, secrets, permissions, billing and external publication",
    "Never invent unavailable connector state",
    "Never run an unbounded loop",
  ],
};

export function ensureCloudGoal(compass: CompassStore): void {
  if (!compass.getGoal()) compass.setGoal(DEFAULT_CLOUD_GOAL);
}

export function applyCloudControl(compass: CompassStore, mode: "run" | "pause" | "resume" | "status"): void {
  if (mode === "pause") compass.updateState({ status: "PAUSED" });
  if (mode === "resume" && compass.getState().status === "PAUSED") compass.updateState({ status: "READY" });
}

export class CloudCompassStateStoreAdapter implements StateStore {
  private readonly compass: CompassStore;
  private readonly delegate: CompassStateStoreAdapter;

  constructor(compass: CompassStore) {
    this.compass = compass;
    this.delegate = new CompassStateStoreAdapter(compass);
  }

  async getState(): Promise<LoopState> {
    const state = compassStateToLoopState(this.compass.getState());
    return {
      ...state,
      blockers: state.blockers.filter((blocker) => blocker !== "local_runtime_required"),
    };
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    await this.delegate.writeBack(record);
  }
}

export class GitHubRepositoryContextSource implements ContextSource {
  readonly name = "github-repository";
  private readonly client: GitHubReadClient;

  constructor(client: GitHubReadClient) {
    this.client = client;
  }

  async collect(): Promise<ContextItem[]> {
    try {
      const state = await this.client.readRepositoryState();
      return [{ source: "github.repository_state", summary: "GitHub repository state collected", data: state }];
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "unknown GitHub context error";
      return [{ source: "github.repository_state", summary: `unavailable:${message}`, data: { available: false } }];
    }
  }
}
