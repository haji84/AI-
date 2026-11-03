import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWorkerResourcePlacement, validateWorkerResourceRequirements } from "../src/gai/worker-runtime.ts";
import type { WorkerResourceRequirements, WorkerResourceSnapshot } from "../src/gai/worker-runtime.ts";

test("commit exhaustion rejects placement even when physical RAM is available", () => {
  const result = evaluateWorkerResourcePlacement({
    resources: { memoryAvailableMb: 48000, committedMemoryMb: 99000, commitLimitMb: 100000 },
    requirements: { minMemoryAvailableMb: 2048, maxCommitPercent: 85 },
  });
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /commit/);
});

test("commit and additional disk/GPU limits admit their boundary and reject excess pressure", () => {
  const resources = { committedMemoryMb: 85000, commitLimitMb: 100000, diskLoadPercent: 90, gpuMemoryAvailableMb: 256 };
  const requirements = { maxCommitPercent: 85, maxDiskLoadPercent: 90, minGpuMemoryAvailableMb: 256 };
  assert.equal(evaluateWorkerResourcePlacement({ resources, requirements }).eligible, true);
  for (const update of [
    { committedMemoryMb: 85001 }, { diskLoadPercent: 90.1 }, { gpuMemoryAvailableMb: 255 },
  ]) assert.equal(evaluateWorkerResourcePlacement({ resources: { ...resources, ...update }, requirements }).eligible, false);
});

test("missing required commit, disk load or GPU memory remains unknown and ineligible", () => {
  for (const requirements of [
    { maxCommitPercent: 85 }, { maxDiskLoadPercent: 90 }, { minGpuMemoryAvailableMb: 256 },
  ]) assert.equal(evaluateWorkerResourcePlacement({ resources: {}, requirements }).eligible, false);
});

test("invalid observed numbers cannot pass placement or become ranking evidence", () => {
  const fields = ["memoryAvailableMb", "diskAvailableMb", "gpuMemoryAvailableMb", "committedMemoryMb", "commitLimitMb",
    "cpuLoadPercent", "gpuLoadPercent", "diskLoadPercent"] as const;
  for (const field of fields) {
    for (const value of [NaN, Infinity, -1]) {
      const resources = { [field]: value } as WorkerResourceSnapshot;
      assert.equal(evaluateWorkerResourcePlacement({ resources }).eligible, false, `${field}: ${value}`);
    }
  }
  assert.equal(evaluateWorkerResourcePlacement({ resources: { cpuLoadPercent: 101 } }).eligible, false);
  assert.equal(evaluateWorkerResourcePlacement({ resources: { gpuLoadPercent: 101 } }).eligible, false);
  assert.equal(evaluateWorkerResourcePlacement({ resources: { diskLoadPercent: 101 } }).eligible, false);
});

test("contradictory commit counters cannot authorize placement", () => {
  for (const resources of [
    { committedMemoryMb: 100, commitLimitMb: 99 },
    { committedMemoryMb: 0, commitLimitMb: 0 },
  ]) assert.equal(evaluateWorkerResourcePlacement({ resources }).eligible, false);
});

test("new resource requirements validate finite ranges before routing", () => {
  for (const requirements of [
    { maxCommitPercent: NaN }, { maxCommitPercent: 101 }, { maxDiskLoadPercent: -1 },
    { maxDiskLoadPercent: Infinity }, { minGpuMemoryAvailableMb: NaN }, { minGpuMemoryAvailableMb: -1 },
  ]) assert.throws(() => validateWorkerResourceRequirements(requirements as WorkerResourceRequirements));
});
