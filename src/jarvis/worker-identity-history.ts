import type { JarvisSqliteStateStore } from "./sqlite-state-store.ts";

export type JarvisWorkerLifecycleEventKind = "enrolled" | "revoked";

export interface JarvisWorkerLifecycleEvent {
  nodeId: string;
  event: JarvisWorkerLifecycleEventKind;
  at: string;
}

export interface JarvisWorkerHistoryOptions {
  limit?: number;
}

const DEFAULT_WORKER_HISTORY_LIMIT = 50;
const MAX_WORKER_HISTORY_LIMIT = 200;

function historyLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_WORKER_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WORKER_HISTORY_LIMIT) {
    throw new Error(`worker history limit must be an integer from 1 to ${MAX_WORKER_HISTORY_LIMIT}`);
  }
  return limit;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid worker ${label} timestamp`);
  return parsed;
}

export function readWorkerIdentityHistory(
  store: Pick<JarvisSqliteStateStore, "listWorkerIdentities">,
  options: JarvisWorkerHistoryOptions = {},
): JarvisWorkerLifecycleEvent[] {
  const limit = historyLimit(options.limit);
  const events: JarvisWorkerLifecycleEvent[] = [];

  for (const identity of store.listWorkerIdentities()) {
    const enrolledAt = timestamp(identity.enrolledAt, "enrollment");
    events.push({ nodeId: identity.nodeId, event: "enrolled", at: identity.enrolledAt });

    if (identity.revokedAt) {
      const revokedAt = timestamp(identity.revokedAt, "revocation");
      if (revokedAt < enrolledAt) throw new Error("worker revocation timestamp precedes enrollment");
      events.push({ nodeId: identity.nodeId, event: "revoked", at: identity.revokedAt });
    }
  }

  const eventRank: Record<JarvisWorkerLifecycleEventKind, number> = { revoked: 0, enrolled: 1 };
  return events
    .sort((left, right) => right.at.localeCompare(left.at)
      || left.nodeId.localeCompare(right.nodeId)
      || eventRank[left.event] - eventRank[right.event])
    .slice(0, limit);
}
