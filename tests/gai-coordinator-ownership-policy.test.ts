import assert from "node:assert/strict";
import test from "node:test";
import { DistributedCoordinatorRuntime, MemoryCoordinatorStore } from "../src/gai/distributed-coordinator.ts";
import { assertCurrentWorkloadClaim, canReassignWorkload } from "../src/gai/coordinator-ownership-policy.ts";

const t0 = new Date("2026-10-09T00:00:00.000Z");
const candidate = (nodeId: string, available = true) => ({ nodeId, available, eligible: true, score: 1, observedAt: t0.toISOString() });

test("stale coordinator cannot commit workload after ownership changes", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const mac = await runtime.elect([candidate("mac"), candidate("zbook")], 10000, t0);
  const claim = { taskId: "t1", nodeId: "mac", epoch: 1, token: "token-1", coordinator: mac };
  await assertCurrentWorkloadClaim(runtime, claim, claim, new Date(t0.getTime() + 100));
  await runtime.elect([candidate("mac", false), candidate("zbook")], 10000, new Date(t0.getTime() + 200));
  await assert.rejects(() => assertCurrentWorkloadClaim(runtime, claim, claim, new Date(t0.getTime() + 300)), /STALE_COORDINATOR_CLAIM/);
});

test("stale task epoch or token is rejected", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const coordinator = await runtime.elect([candidate("mac")], 10000, t0);
  const current = { taskId: "t1", nodeId: "mac", epoch: 2, token: "new", coordinator };
  await assert.rejects(() => assertCurrentWorkloadClaim(runtime, { ...current, epoch: 1 }, current, new Date(t0.getTime() + 100)), /STALE_WORKLOAD_CLAIM/);
  await assert.rejects(() => assertCurrentWorkloadClaim(runtime, { ...current, token: "old" }, current, new Date(t0.getTime() + 100)), /STALE_WORKLOAD_CLAIM/);
});

test("migration class requires checkpoint or side-effect reconciliation", () => {
  assert.equal(canReassignWorkload("MIGRATABLE", false, false), false);
  assert.equal(canReassignWorkload("MIGRATABLE", true, false), true);
  assert.equal(canReassignWorkload("RESTARTABLE", false, false), true);
  assert.equal(canReassignWorkload("PINNED", true, true), false);
  assert.equal(canReassignWorkload("SIDE_EFFECTING", true, false), false);
  assert.equal(canReassignWorkload("SIDE_EFFECTING", false, true), true);
});
