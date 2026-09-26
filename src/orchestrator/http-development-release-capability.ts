import type { ContextItem, Goal } from "./goal-loop.ts";
import type { DevelopmentChangeSet } from "./development-change-set.ts";
import type { DevelopmentJob } from "./development-job.ts";
import type { ResidentDevelopmentReleaseState } from "./resident-development-goal-host.ts";

export class HttpDevelopmentReleaseCapability {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: { url: string; token: string }, fetchImpl: typeof fetch = fetch) {
    const parsed = new URL(input.url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
      throw new Error("development release capability requires HTTPS or loopback HTTP");
    }
    if (!input.token.trim()) throw new Error("development release capability token is required");
    this.url = input.url.replace(/\/$/, "");
    this.token = input.token;
    this.fetchImpl = fetchImpl;
  }

  private headers() { return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }; }

  async state(input: { job: DevelopmentJob; changeSet: DevelopmentChangeSet }): Promise<ResidentDevelopmentReleaseState> {
    const query = new URLSearchParams({ jobId: input.job.jobId, changeSetId: input.changeSet.changeSetId, taskScopeId: input.job.approvalScope.taskScopeId });
    const response = await this.fetchImpl(`${this.url}/state?${query}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`development release state HTTP ${response.status}`);
    const state = await response.json() as ResidentDevelopmentReleaseState;
    if (state.taskScopeId !== input.job.approvalScope.taskScopeId) throw new Error("development release state scope mismatch");
    return state;
  }

  async execute(action: string, input: { operationId: string; job: DevelopmentJob; changeSet: DevelopmentChangeSet; goal: Goal; context: ContextItem[] }): Promise<void> {
    const response = await this.fetchImpl(`${this.url}/actions`, {
      method: "POST", headers: { ...this.headers(), "Idempotency-Key": input.operationId },
      body: JSON.stringify({ action, operationId: input.operationId, jobId: input.job.jobId, changeSetId: input.changeSet.changeSetId, taskScopeId: input.job.approvalScope.taskScopeId, candidateRevision: input.changeSet.candidateRevision, artifactDigest: input.changeSet.artifactDigest }),
    });
    if (!response.ok) throw new Error(`development release action HTTP ${response.status}`);
  }
}
