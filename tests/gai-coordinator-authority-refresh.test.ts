import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DistributedCoordinatorRuntime, JsonFileCoordinatorStore, MemoryCoordinatorStore } from "../src/gai/distributed-coordinator.ts";

const at = new Date("2026-10-01T00:00:00.000Z");
const candidates = (macAvailable = true) => [
  { nodeId: "macbook", score: 100, available: macAvailable, eligible: true, observedAt: at.toISOString() },
  { nodeId: "zbook", score: 50, available: true, eligible: true, observedAt: at.toISOString() },
];

for (const mode of ["memory", "json"] as const) {
  test(`${mode}: an already initialized Runtime rejects ownership replaced by another Runtime`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "coordinator-refresh-"));
    try {
      const store = mode === "memory" ? new MemoryCoordinatorStore() : new JsonFileCoordinatorStore(join(dir, "lease.json"));
      const oldRuntime = new DistributedCoordinatorRuntime(store, "goriq");
      const oldClaim = await oldRuntime.elect(candidates(), 10_000, at);
      const replacement = new DistributedCoordinatorRuntime(store, "goriq");
      const newClaim = await replacement.elect(candidates(false), 10_000, at);
      assert.equal(oldClaim.epoch, 1);
      assert.equal(newClaim.epoch, 2);
      await assert.rejects(() => oldRuntime.assertAuthoritative(oldClaim, at), /STALE_COORDINATOR_CLAIM/);
      await assert.rejects(() => oldRuntime.renew(oldClaim, candidates(), 10_000, at), /STALE_COORDINATOR_CLAIM/);
      assert.equal((await store.load())?.fencingToken, newClaim.fencingToken);
      assert.equal((await oldRuntime.current())?.coordinatorId, "zbook");
      assert.deepEqual(await oldRuntime.elect(candidates(), 10_000, at), newClaim);
      await oldRuntime.assertAuthoritative(newClaim, at);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("a deleted lease cannot leave cached authority valid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coordinator-missing-"));
  const file = join(dir, "lease.json");
  try {
    const runtime = new DistributedCoordinatorRuntime(new JsonFileCoordinatorStore(file), "goriq");
    const claim = await runtime.elect(candidates(), 10_000, at);
    await rm(file);
    assert.equal(await runtime.current(), null);
    await assert.rejects(() => runtime.assertAuthoritative(claim, at), /STALE_COORDINATOR_CLAIM/);
    await assert.rejects(() => runtime.renew(claim, candidates(), 10_000, at), /STALE_COORDINATOR_CLAIM/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt or wrong-cluster persisted state fails closed instead of trusting cache", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coordinator-invalid-"));
  const file = join(dir, "lease.json");
  try {
    const store = new JsonFileCoordinatorStore(file);
    const runtime = new DistributedCoordinatorRuntime(store, "goriq");
    const claim = await runtime.elect(candidates(), 10_000, at);
    const valid = await store.load();
    await writeFile(file, "{invalid", "utf8");
    await assert.rejects(() => runtime.assertAuthoritative(claim, at), SyntaxError);
    await assert.rejects(() => runtime.renew(claim, candidates(), 10_000, at), SyntaxError);
    await store.save({ ...valid!, clusterId: "other-cluster" });
    await assert.rejects(() => runtime.assertAuthoritative(claim, at), /belongs to cluster/);
    await assert.rejects(() => runtime.elect(candidates(), 10_000, at), /belongs to cluster/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
