import type { MemoryKind, MemoryRecord } from "../gai/types.ts";
import { PersistentMemoryStore } from "../gai/memory-store.ts";

export interface MemoryContextRequest {
  task: string;
  kinds?: MemoryKind[];
  limit?: number;
  minConfidence?: number;
}

/** Read-only memory context adapter for orchestrator/planner callers.
 * It does not authorize execution or alter Human Gate policy.
 */
export async function loadGaiMemoryContext(
  store: PersistentMemoryStore,
  request: MemoryContextRequest,
): Promise<MemoryRecord[]> {
  return store.query({
    text: request.task,
    kinds: request.kinds,
    limit: request.limit ?? 8,
    minConfidence: request.minConfidence ?? 0.5,
  });
}
