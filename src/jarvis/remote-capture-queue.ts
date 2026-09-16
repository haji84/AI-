/** One capture at a time; repeated refresh requests coalesce into one trailing capture. */
export class RemoteCaptureQueue {
  private context = "";
  private generation = 0;
  private pending: (() => Promise<boolean>) | null = null;
  private running: Promise<boolean> | null = null;

  setContext(context: string) {
    if (this.context === context) return;
    this.context = context;
    this.generation++;
    this.pending = null;
  }

  request<T>(context: string, capture: () => Promise<T>, publish: (value: T) => void): Promise<boolean> {
    if (!context || context !== this.context) return Promise.resolve(false);
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
