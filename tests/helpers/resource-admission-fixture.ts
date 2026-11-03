import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDevelopmentResourceAdmission } from "../../src/gai/development-resource-admission.ts";
import type { DevelopmentResourceAdmissionOptions } from "../../src/gai/development-resource-admission.ts";

/** Deterministic host telemetry for tests with a fake model transport; the real admission still runs. */
export async function fixtureResourceAdmission<T>(work: () => Promise<T>, options: DevelopmentResourceAdmissionOptions = {}): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "resource-fixture-"));
  try {
    return await withDevelopmentResourceAdmission(work, { ...options, platform: "win32", leasePath: join(directory, "lane.lock"),
      probe: async () => ({ checkedAt: new Date().toISOString(), resources: {
        cpuLoadPercent: 10, memoryAvailableMb: 16000, diskAvailableMb: 100000, committedMemoryMb: 4000, commitLimitMb: 20000,
      } }) });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
