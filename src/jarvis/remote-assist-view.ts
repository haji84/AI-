export type RemoteAssistViewMode = "single" | "split2" | "split4" | "fleet";

export const REMOTE_ASSIST_FLEET_WINDOW = 12;
export const REMOTE_ASSIST_REFRESH_CONCURRENCY = 4;
export const REMOTE_ASSIST_MULTI_REFRESH_MS = 4_000;

export function remoteAssistViewLimit(mode: RemoteAssistViewMode): number {
  if (mode === "single") return 1;
  if (mode === "split2") return 2;
  if (mode === "split4") return 4;
  return REMOTE_ASSIST_FLEET_WINDOW;
}

export function remoteAssistVisibleSerials(input: {
  mode: RemoteAssistViewMode;
  availableSerials: string[];
  selectedSerials?: string[];
  fleetPage?: number;
}): string[] {
  const available = [...new Set(input.availableSerials.map((serial) => serial.trim()).filter(Boolean))];
  if (input.mode === "fleet") {
    const page = Number.isInteger(input.fleetPage) && (input.fleetPage ?? 0) >= 0 ? input.fleetPage ?? 0 : 0;
    const start = page * REMOTE_ASSIST_FLEET_WINDOW;
    return available.slice(start, start + REMOTE_ASSIST_FLEET_WINDOW);
  }

  const limit = remoteAssistViewLimit(input.mode);
  const availableSet = new Set(available);
  const requested = [...new Set((input.selectedSerials ?? []).filter((serial) => availableSet.has(serial)))];
  for (const serial of available) {
    if (requested.length >= limit) break;
    if (!requested.includes(serial)) requested.push(serial);
  }
  return requested.slice(0, limit);
}

export async function runRemoteAssistBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) throw new Error("Remote Assist concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
