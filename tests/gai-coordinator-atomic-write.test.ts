import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DistributedCoordinatorRuntime, JsonFileCoordinatorStore, MemoryCoordinatorStore, type CoordinatorLease, type CoordinatorStore } from "../src/gai/distributed-coordinator.ts";

const at = new Date("2026-10-01T00:00:00.000Z");
const candidates = (macAvailable = true) => [
  { nodeId: "macbook", score: 100, available: macAvailable, eligible: true, observedAt: at.toISOString() },
  { nodeId: "zbook", score: 50, available: true, eligible: true, observedAt: at.toISOString() },
];

test("a delayed old renewal cannot overwrite a completed higher-epoch election", async () => {
  const store = new MemoryCoordinatorStore();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const delayed: CoordinatorStore = {
    load: () => store.load(),
    save: async lease => { enter(); await released; await store.save(lease); },
    compareAndSwap: async (expected, next) => { enter(); await released; return store.compareAndSwap(expected, next); },
  };
  const oldClaim = await new DistributedCoordinatorRuntime(store, "goriq").elect(candidates(), 10_000, at);
  const oldRuntime = new DistributedCoordinatorRuntime(delayed, "goriq");
  const renewal = oldRuntime.renew(oldClaim, candidates(), 20_000, at);
  const rejected = assert.rejects(renewal, /COORDINATOR_WRITE_CONFLICT/);
  await entered;
  const newClaim = await new DistributedCoordinatorRuntime(store, "goriq").elect(candidates(false), 10_000, at);
  release();
  await rejected;
  assert.equal((await store.load())?.epoch, 2);
  assert.equal((await store.load())?.fencingToken, newClaim.fencingToken);
});

test("competing initial elections cannot both commit epoch one", async () => {
  const store = new MemoryCoordinatorStore();
  const outcomes = await Promise.allSettled([
    new DistributedCoordinatorRuntime(store, "goriq").elect(candidates(), 10_000, at),
    new DistributedCoordinatorRuntime(store, "goriq").elect(candidates(false), 10_000, at),
  ]);
  assert.equal(outcomes.filter(v => v.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(v => v.status === "rejected" && /COORDINATOR_WRITE_CONFLICT/.test(String(v.reason))).length, 1);
  assert.equal((await store.load())?.epoch, 1);
});

test("Runtime refuses election on a Store without atomic writes", async () => {
  const memory = new MemoryCoordinatorStore();
  const unsafe = { load: () => memory.load(), save: (lease: CoordinatorLease) => memory.save(lease) };
  await assert.rejects(() => new DistributedCoordinatorRuntime(unsafe, "goriq").elect(candidates(), 10_000, at), /COORDINATOR_ATOMIC_STORE_REQUIRED/);
  assert.equal(await memory.load(), null);
});

test("independent JSON Stores serialize compare-and-swap and preserve the winning lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coordinator-cas-"));
  const file = join(dir, "lease.json");
  try {
    const a = new JsonFileCoordinatorStore(file);
    const b = new JsonFileCoordinatorStore(file);
    await new DistributedCoordinatorRuntime(a, "goriq").elect(candidates(), 10_000, at);
    const expected = (await a.load())!;
    const one = { ...expected, epoch: 2, fencingToken: "candidate-one" };
    const two = { ...expected, epoch: 2, fencingToken: "candidate-two" };
    const outcomes = await Promise.all([a.compareAndSwap(expected, one), b.compareAndSwap(expected, two)]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal((await a.load())?.fencingToken, outcomes[0] ? "candidate-one" : "candidate-two");
    assert.equal(await b.compareAndSwap(expected, expected), false);
    // A stale leaseUntil must also conflict when the epoch/token stayed unchanged.
    const current = (await a.load())!;
    assert.equal(await a.compareAndSwap(current, { ...current, leaseUntil: "2026-10-01T00:00:20.000Z" }), true);
    assert.equal(await b.compareAndSwap(current, current), false);
    // An exception under the writer lease must release the lease for recovery.
    await writeFile(file, "{invalid", "utf8");
    await assert.rejects(() => a.compareAndSwap(current, current), SyntaxError);
    await a.save(current);
    assert.equal(await b.compareAndSwap(current, { ...current, epoch: 3 }), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
