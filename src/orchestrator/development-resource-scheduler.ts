import { assertResourceWait, resourceWaitExhausted } from "./development-resource-wait.ts";
import type { WorkRunState } from "./work-run-state.ts";

interface SchedulerOptions {
  read(goalId: string): Promise<{ active: boolean; run: WorkRunState | null }>;
  resume(goalId: string): Promise<void>;
  onError(error: unknown): void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/** One-shot wakeups in the existing Broker. Budgets live in the persisted Work Run. */
export class ResourceWaitScheduler {
  private readonly options: SchedulerOptions;
  private readonly pending = new Map<string, { timer?: unknown }>();
  private closed = false;
  constructor(options: SchedulerOptions) { this.options = options; }

  async arm(goalId: string): Promise<boolean> {
    if (this.closed) return false;
    const old = this.pending.get(goalId);
    if (old?.timer) (this.options.cancel ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)))(old.timer);
    const token: { timer?: unknown } = {};
    this.pending.set(goalId, token);
    const state = await this.options.read(goalId);
    if (this.closed || this.pending.get(goalId) !== token) return false;
    const run = state.run;
    if (!state.active || run?.goalId !== goalId || run.phase !== "RUNNING" || !run.resourceWait) {
      this.pending.delete(goalId); return false;
    }
    assertResourceWait(run.resourceWait);
    const now = (this.options.now ?? Date.now)();
    const due = resourceWaitExhausted(run.resourceWait, new Date(now)) ? now : Math.min(Date.parse(run.resourceWait.retryAt), Date.parse(run.resourceWait.deadline));
    token.timer = (this.options.schedule ?? setTimeout)(() => {
      if (this.closed || this.pending.get(goalId) !== token) return;
      this.pending.delete(goalId);
      void this.wake(goalId).catch(this.options.onError);
    }, Math.max(0, due - now));
    return true;
  }

  private async wake(goalId: string): Promise<void> {
    const state = await this.options.read(goalId);
    if (this.closed || !state.active || state.run?.goalId !== goalId || state.run.phase !== "RUNNING" || !state.run.resourceWait) return;
    const wait = state.run.resourceWait;
    assertResourceWait(wait);
    const now = (this.options.now ?? Date.now)();
    if (!resourceWaitExhausted(wait, new Date(now)) && now < Date.parse(wait.retryAt)) {
      await this.arm(goalId); return;
    }
    // Executor rechecks authority and resources; an exhausted wait becomes BLOCKED there.
    await this.options.resume(goalId);
  }

  close(): void {
    this.closed = true;
    for (const { timer } of this.pending.values()) {
      if (timer) (this.options.cancel ?? (value => clearTimeout(value as ReturnType<typeof setTimeout>)))(timer);
    }
    this.pending.clear();
  }
}
