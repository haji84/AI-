import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DistributedCoordinatorRuntime,
  JsonFileCoordinatorStore,
  MemoryCoordinatorStore,
  coordinatorCandidateScore,
  type CoordinatorCandidate,
} from "../src/gai/distributed-coordinator.ts";

const t0 = new Date("2026-09-29T00:00:00.000Z");

function candidate(
  nodeId: string,
  score: number,
  available = true,
  eligible = true,
): CoordinatorCandidate {
  return {
    nodeId,
    score,
    available,
    eligible,
    observedAt: t0.toISOString(),
  };
}

test("best eligible node becomes coordinator and valid incumbent is not preempted", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const first = await runtime.elect([
    candidate("macbook", 20),
    candidate("zbook", 15),
  ], 10_000, t0);
  assert.equal(first.coordinatorId, "macbook");
  assert.equal(first.epoch, 1);

  const retained = await runtime.elect([
    candidate("macbook", 20),
    candidate("zbook", 100),
  ], 10_000, new Date(t0.getTime() + 1_000));
  assert.deepEqual(retained, first);
});

test("unavailable incumbent fails over immediately with higher epoch and fences stale claim", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const mac = await runtime.elect([
    candidate("macbook", 30),
    candidate("zbook", 20),
  ], 10_000, t0);

  const zbook = await runtime.elect([
    candidate("macbook", 30, false),
    candidate("zbook", 20),
  ], 10_000, new Date(t0.getTime() + 1_000));
  assert.equal(zbook.coordinatorId, "zbook");
  assert.equal(zbook.epoch, 2);
  assert.notEqual(zbook.fencingToken, mac.fencingToken);

  await assert.rejects(
    () => runtime.assertAuthoritative(mac, new Date(t0.getTime() + 1_001)),
    /STALE_COORDINATOR_CLAIM/,
  );
  await runtime.assertAuthoritative(zbook, new Date(t0.getTime() + 1_001));
});

test("returning better node waits for active lease, then can win deterministic rebalance", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const mac = await runtime.elect([
    candidate("macbook", 30),
    candidate("zbook", 20),
  ], 1_000, t0);

  const zbook = await runtime.elect([
    candidate("macbook", 30, false),
    candidate("zbook", 20),
  ], 1_000, new Date(t0.getTime() + 100));
  assert.equal(zbook.coordinatorId, "zbook");
  assert.equal(zbook.epoch, 2);

  const noPreempt = await runtime.elect([
    candidate("macbook", 100, true),
    candidate("zbook", 20, true),
  ], 1_000, new Date(t0.getTime() + 200));
  assert.equal(noPreempt.coordinatorId, "zbook");
  assert.equal(noPreempt.epoch, 2);

  const rebalanced = await runtime.elect([
    candidate("macbook", 100, true),
    candidate("zbook", 20, true),
  ], 1_000, new Date(t0.getTime() + 1_101));
  assert.equal(rebalanced.coordinatorId, "macbook");
  assert.equal(rebalanced.epoch, 3);
  assert.notEqual(rebalanced.fencingToken, mac.fencingToken);
  assert.notEqual(rebalanced.fencingToken, zbook.fencingToken);
});

test("renew requires the authoritative claim and an eligible incumbent", async () => {
  const runtime = new DistributedCoordinatorRuntime(new MemoryCoordinatorStore(), "goriq");
  const claim = await runtime.elect([candidate("macbook", 20)], 1_000, t0);
  const renewed = await runtime.renew(
    claim,
    [candidate("macbook", 20)],
    2_000,
    new Date(t0.getTime() + 100),
  );
  assert.equal(renewed.epoch, claim.epoch);
  assert.equal(renewed.fencingToken, claim.fencingToken);
  assert.notEqual(renewed.leaseUntil, claim.leaseUntil);

  await assert.rejects(
    () => runtime.renew(claim, [candidate("macbook", 20)], 2_000, new Date(t0.getTime() + 200)),
    /STALE_COORDINATOR_CLAIM/,
  );
});

test("coordinator lease survives JSON store restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "goriq-coordinator-"));
  const file = join(dir, "coordinator.json");
  try {
    const first = new DistributedCoordinatorRuntime(new JsonFileCoordinatorStore(file), "goriq");
    const claim = await first.elect([candidate("zbook", 10)], 10_000, t0);

    const second = new DistributedCoordinatorRuntime(new JsonFileCoordinatorStore(file), "goriq");
    const restored = await second.current();
    assert.equal(restored?.coordinatorId, "zbook");
    assert.equal(restored?.epoch, 1);
    assert.equal(restored?.fencingToken, claim.fencingToken);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("coordinator candidate score prefers confidence, spare capacity, power and connectivity", () => {
  const weak = coordinatorCandidateScore({
    confidence: 0.5,
    maxParallelTasks: 1,
    activeTasks: 1,
    connectivity: "degraded",
    onExternalPower: false,
    memoryAvailableMb: 4_096,
  });
  const strong = coordinatorCandidateScore({
    confidence: 1,
    maxParallelTasks: 4,
    activeTasks: 0,
    connectivity: "online",
    onExternalPower: true,
    memoryAvailableMb: 32_768,
  });
  assert.ok(strong > weak);
});
