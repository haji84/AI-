import assert from "node:assert/strict";
import test from "node:test";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
import { PcDurableWork, validatePcPublicWork, pcDigest } from "../src/jarvis/pc-durable-work.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
const now = new Date("2026-10-03T15:00:00Z");
const capsule = { goal: "#1219", currentJob: "#1662", why: "Execute public digest", workflowPosition: "signed PC work",
  inputs: ["public input"], constraints: ["filesystem only"], decisions: ["restartable"], dependencies: [],
  expectedOutput: ["digest"], definitionOfDone: ["signed verified digest"], verificationContract: "recompute digest", recoveryContext: ["reject stale epoch"] };
const work = { idempotencyKey: "unit-work", goalIssue: 1219, privacyClass: "PUBLIC" as const, content: "public input", capsule };
function node(id: string): JarvisNode {
  return { id, label: id, kind: "windows", status: "ready", capabilities: ["filesystem"], lastSeenAt: now.toISOString(),
    enrollment: "quick", telemetry: { checkedAt: now.toISOString() }, policy: { allowPaidServices: false, allowDestructiveActions: false,
      allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
    pcAuthority: { version: 1, approvalIssue: 1662, goalIssue: 1219, roles: ["Executor"], capabilityCeiling: ["filesystem"] } };
}
test("public PC task rejects sensitive input, arbitrary paths, malformed context and unscoped authority", async () => {
  for (const input of [{ ...work, privacyClass: "SECRET" }, { ...work, path: "private" }, { ...work, command: "anything" },
    { ...work, content: "x".repeat(32769) }, { ...work, capsule: { ...capsule, currentJob: [] } },
    { ...work, capsule: { ...capsule, constraints: [42] } }, { ...work, targetNodeId: 42 }]) {
    assert.throws(() => validatePcPublicWork(input));
  }
  const n = node("pc");
  n.pcAuthority!.roles = ["Storage"];
  const service = new PcDurableWork(new DurableTaskRuntime(new MemoryDurableTaskStore()), () => [n]);
  await assert.rejects(() => service.enqueue(work, now), /AUTHORITY/);
  n.pcAuthority!.roles = ["Executor"];
  await assert.rejects(() => service.enqueue({ ...work, goalIssue: 999, capsule: { ...capsule, goal: "#999" } }, now), /AUTHORITY/);
});
test("expired execution moves to eligible PC and returning stale owner cannot overwrite verified work", async () => {
  const store = new MemoryDurableTaskStore(), runtime = new DurableTaskRuntime(store);
  const a = node("pc-a"), b = node("pc-b"), service = new PcDurableWork(runtime, () => [a, b]);
  const task = await service.enqueue(work, now);
  const first = await service.next(a.id, now);
  assert.equal(first.task?.id, task.id);
  const later = new Date(now.getTime() + 120001);
  a.status = "offline"; b.lastSeenAt = later.toISOString();
  const second = await service.next(b.id, later);
  assert.equal(second.task?.id, task.id);
  assert.equal(second.claim!.epoch, first.claim!.epoch + 1);
  a.status = "ready"; a.lastSeenAt = later.toISOString();
  await assert.rejects(() => service.complete(a.id, { taskId: task.id, claim: first.claim, detail: pcDigest(work.content) }, later), /STALE|CLAIM/);
  const resumed = new PcDurableWork(new DurableTaskRuntime(store), () => [a, b]);
  const done = await resumed.complete(b.id, { taskId: task.id, claim: second.claim, detail: pcDigest(work.content) }, later);
  assert.equal(done.status, "completed");
  assert.equal((done.result as { nodeId: string }).nodeId, b.id);
  assert.equal((await resumed.next(a.id, later)).task, null);
  await assert.rejects(() => resumed.complete(b.id, { taskId: task.id, claim: second.claim, detail: pcDigest(work.content) }, later), /CLAIM/);
});
test("offline or stale nodes never claim work; wrong digest does not complete a claim", async () => {
  const n = node("pc"), runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const service = new PcDurableWork(runtime, () => [n]), task = await service.enqueue(work, now);
  n.status = "offline";
  await assert.rejects(() => service.next(n.id, now), /HEARTBEAT/);
  n.status = "ready"; n.lastSeenAt = new Date(now.getTime() - 300001).toISOString();
  await assert.rejects(() => service.next(n.id, now), /HEARTBEAT/);
  n.lastSeenAt = now.toISOString();
  const assigned = await service.next(n.id, now);
  await assert.rejects(() => service.complete(n.id, { taskId: task.id, claim: assigned.claim, detail: pcDigest("tampered") }, now), /DIGEST/);
  assert.equal((await runtime.get(task.id))?.status, "running");
});
test("Fabric placement is independent of poll order and redistributes queued work around occupied capacity", async () => {
  const a = node("pc-a"), b = node("pc-b");
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const service = new PcDurableWork(runtime, () => [b, a]);
  const first = await service.enqueue(work, now);
  assert.equal((await service.next(b.id, now)).task, null, "lower ranked polling node must not steal placement");
  assert.equal((await service.next(a.id, now)).task?.id, first.id);
  const second = await service.enqueue({ ...work, idempotencyKey: "second" }, now);
  assert.equal((await service.next(b.id, now)).task?.id, second.id, "free eligible capacity gets independent work");
});
test("Fabric excludes stale or unavailable resources while offline local-capable work remains eligible", async () => {
  const a = node("pc-a"), b = node("pc-b");
  const runtime = new DurableTaskRuntime(new MemoryDurableTaskStore());
  const service = new PcDurableWork(runtime, () => [a, b]);
  a.telemetry.cpuAvailable = false;
  b.telemetry.network = "offline"; // no Internet is not loss of local Broker reachability
  const task = await service.enqueue(work, now);
  assert.equal((await service.next(a.id, now)).task, null);
  assert.equal((await service.next(b.id, now)).task?.id, task.id);
});
test("explicit target waits rather than migrates, without blocking unrelated eligible work", async () => {
  const a = node("pc-a"), b = node("pc-b");
  const service = new PcDurableWork(new DurableTaskRuntime(new MemoryDurableTaskStore()), () => [a, b]);
  const pinned = await service.enqueue({ ...work, targetNodeId: a.id }, now);
  a.status = "offline";
  const free = await service.enqueue({ ...work, idempotencyKey: "unrelated" }, now);
  assert.equal((await service.next(b.id, now)).task?.id, free.id);
  assert.notEqual(free.id, pinned.id);
});
test("Fabric allocates multiple pending tasks before either PC polls, reserving targeted capacity", async () => {
  const a = node("pc-a"), b = node("pc-b");
  const service = new PcDurableWork(new DurableTaskRuntime(new MemoryDurableTaskStore()), () => [a, b]);
  const free = await service.enqueue(work, now);
  const targeted = await service.enqueue({ ...work, idempotencyKey: "targeted", targetNodeId: a.id }, now);
  assert.equal((await service.next(b.id, now)).task?.id, free.id);
  assert.equal((await service.next(a.id, now)).task?.id, targeted.id);
});
test("Fabric ignores stale and critical-thermal candidates without waiting for their poll", async () => {
  const a = node("pc-a"), b = node("pc-b"), c = node("pc-c");
  a.lastSeenAt = new Date(now.getTime() - 300001).toISOString();
  b.telemetry.thermalState = "critical";
  const service = new PcDurableWork(new DurableTaskRuntime(new MemoryDurableTaskStore()), () => [a, b, c]);
  const task = await service.enqueue(work, now);
  assert.equal((await service.next(c.id, now)).task?.id, task.id);
});
