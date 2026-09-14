import type { GaiWorker } from "./worker-runtime.ts";
import { PersistentWorldResourceModel, type WorldResourceObservation } from "./world-resource-model.ts";

export interface WorldResourceCollectionResult {
  observations: WorldResourceObservation[];
  failures: Array<{ workerId: string; error: string }>;
}

export async function collectWorldResources(input: {
  model: PersistentWorldResourceModel;
  workers: GaiWorker[];
  ttlMs?: number;
  now?: Date;
  provenance?: string;
}): Promise<WorldResourceCollectionResult> {
  const observations: WorldResourceObservation[] = [];
  const failures: Array<{ workerId: string; error: string }> = [];

  for (const worker of input.workers) {
    try {
      const health = await worker.health();
      const observation = await input.model.observeWorker({
        descriptor: worker.descriptor,
        health,
        ttlMs: input.ttlMs,
        now: input.now,
        provenance: [input.provenance ?? "worker-preflight"],
        confidence: 1,
      });
      observations.push(observation);
    } catch (error) {
      failures.push({
        workerId: worker.descriptor.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { observations, failures };
}
