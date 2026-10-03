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
