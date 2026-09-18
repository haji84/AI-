/** One capture at a time; repeated refresh requests coalesce into one trailing capture. */
export class RemoteCaptureQueue {
  private context = "";
  private generation = 0;
  private pending: (() => Promise<boolean>) | null = null;
  private running: Promise<boolean> | null = null;
  private inputPending = false;

  setContext(context: string) {
    if (this.context === context) return;
    this.context = context;
    this.generation++;
    this.pending = null;
  }

  request<T>(context: string, capture: () => Promise<T>, publish: (value: T) => void): Promise<boolean> {
    if (!context || context !== this.context || this.inputPending) return Promise.resolve(false);
    const generation = this.generation;
    this.pending = async () => {
      const value = await capture();
      if (generation !== this.generation || context !== this.context) return false;
      publish(value);
      return true;
    };
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  /** A manual input waits for the current frame, never overlaps it or retries.
   * Drop trailing refreshes and duplicate inputs; invalidate on session change. */
  async input<T>(context: string, execute: () => Promise<T>): Promise<T | null> {
    if (!context || context !== this.context || this.inputPending) return null;
    this.inputPending = true;
    this.pending = null;
    const generation = this.generation;
    const deadline = Date.now() + 5000;
    try {
      await this.running;
      if (generation !== this.generation || context !== this.context) return null;
      if (Date.now() >= deadline) throw new Error('画面取得の待機時間を超えました。操作は送信していません');
      return await execute();
    } finally { this.inputPending = false; }
  }

  private async drain() {
    let published = false;
    while (this.pending) {
      const next = this.pending;
      this.pending = null;
      try { published = await next() || published; } catch { /* Caller reports transport failure; keep trailing refresh usable. */ }
    }
    return published;
  }
}
