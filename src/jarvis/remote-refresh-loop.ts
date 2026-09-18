export function startRemoteRefreshLoop(options: {
  capture: () => Promise<boolean>;
  visible: () => boolean;
  successDelayMs?: number;
  maxFailures?: number;
  onExhausted?: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let failures = 0;
  let nextAttemptAt = 0;
  const now = options.now ?? Date.now;
  const later = (delay: number) => { if (!stopped) timer = schedule(() => void tick(), delay); };
  async function tick() {
    if (stopped || running) return;
    if (!options.visible()) { later(1000); return; }
    running = true;
    let ok = false;
    try { ok = await options.capture(); } catch { /* Failure retries remain bounded by delay. */ }
    finally { running = false; }
    if (stopped) return;
    failures = ok ? 0 : failures + 1;
    if (failures >= (options.maxFailures ?? 4)) { stopped = true; options.onExhausted?.(); return; }
    const delay = ok ? (options.successDelayMs ?? 100) : Math.min(8000, 2000 * 2 ** (failures - 1));
    nextAttemptAt = now() + delay;
    later(delay);
  }
  void tick();
  return {
    resume() {
      if (timer !== undefined) cancel(timer);
      if (!stopped && !running) {
        const remaining = nextAttemptAt - now();
        if (remaining > 0) later(remaining); else void tick();
      }
    },
    stop() { stopped = true; if (timer !== undefined) cancel(timer); },
  };
}
