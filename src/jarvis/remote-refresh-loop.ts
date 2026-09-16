export function startRemoteRefreshLoop(options: {
  capture: () => Promise<boolean>;
  visible: () => boolean;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  const later = (delay: number) => { if (!stopped) timer = schedule(() => void tick(), delay); };
  async function tick() {
    if (stopped || running) return;
    if (!options.visible()) { later(1000); return; }
    running = true;
    let ok = false;
    try { ok = await options.capture(); } catch { /* Failure retries remain bounded by delay. */ }
    finally { running = false; later(ok ? 100 : 2000); }
  }
  void tick();
  return {
    resume() { if (timer !== undefined) cancel(timer); if (!stopped && !running) void tick(); },
    stop() { stopped = true; if (timer !== undefined) cancel(timer); },
  };
}
