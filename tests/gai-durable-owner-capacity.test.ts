import assert from "node:assert/strict";
import test from "node:test";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
test("atomic durable capacity blocks a second task on one PC across independent runtime instances", async () => {
  const store = new MemoryDurableTaskStore(), a = new DurableTaskRuntime(store), b = new DurableTaskRuntime(store);
  const now = new Date("2026-10-03T15:00:00Z");
  await a.enqueue({ id: "a", type: "public-digest", idempotencyKey: "a" }, now);
  await a.enqueue({ id: "b", type: "public-digest", idempotencyKey: "b" }, now);
  assert.equal(typeof a.leaseClaimWithCapacity, "function", "atomic owner capacity is required");
  const first = await a.leaseClaimWithCapacity("a", "pc", 1, 120000, now);
  await assert.rejects(() => b.leaseClaimWithCapacity("b", "pc", 1, 120000, now), /OWNER_CAPACITY/);
  assert.equal((await b.get("b"))?.status, "queued");
  const later = new Date(now.getTime() + 120001);
  const second = await b.leaseClaimWithCapacity("b", "pc", 1, 120000, later);
  assert.equal(second.owner, "pc");
  await assert.rejects(() => a.completeClaimed(first, {}, later), /STALE_EXECUTION_CLAIM/);
});
test("overlapping claim snapshots cannot exceed the durable per-owner capacity", async () => {
  const store = new MemoryDurableTaskStore(), a = new DurableTaskRuntime(store), b = new DurableTaskRuntime(store);
  await a.enqueue({ id: "a", type: "public-digest", idempotencyKey: "a" });
  await a.enqueue({ id: "b", type: "public-digest", idempotencyKey: "b" });
  assert.equal(typeof a.leaseClaimWithCapacity, "function");
  const attempts = await Promise.allSettled([a.leaseClaimWithCapacity("a", "pc", 1), b.leaseClaimWithCapacity("b", "pc", 1)]);
  assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await a.list()).filter(x => x.leaseOwner === "pc" && ["leased", "running"].includes(x.status)).length, 1);
});
