import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CertifiedSkillExecutionRuntime } from "../src/gai/skill-execution-runtime.ts";
import { PersistentSkillLibrary } from "../src/gai/skill-library.ts";
import { JarvisExecutionRouter } from "../src/jarvis/execution-router.ts";
import { JarvisFleetManager } from "../src/jarvis/fleet-manager.ts";
import { JarvisTaskQueue } from "../src/jarvis/task-queue.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

async function setup(procedure = '{"capability":"local-model","input":{"mode":"bounded"}}', connectivity: "offline-capable" | "online-required" = "offline-capable") {
  const dir = await mkdtemp(join(tmpdir(), "gai-exec-"));
  const skills = new PersistentSkillLibrary(join(dir, "skills.json"));
  await skills.createCandidate({
    id: "research", name: "Research", description: "local research", procedure, applicability: ["research"],
    evidence: ["verifier:pass"], verificationPassed: true, success: true, confidence: 0.9, source: "task:1",
    constraints: { capabilities: ["local-model"], connectivity, maxRisk: "medium" },
  });
  const fleet = new JarvisFleetManager();
  const node: JarvisNode = {
    id: "worker-a", label: "Worker A", kind: "windows", status: "ready", capabilities: ["local-model"],
    policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
    telemetry: { network: "offline", checkedAt: new Date(0).toISOString() }, enrollment: "full", lastSeenAt: new Date(0).toISOString(),
  };
  fleet.register(node);
  const queue = new JarvisTaskQueue();
  const router = new JarvisExecutionRouter(fleet, queue);
  return { skills, queue, runtime: new CertifiedSkillExecutionRuntime(skills, router) };
}

const offline = { mobileOnline: false, pcOnline: false, sameLanAvailable: false };
const online = { mobileOnline: true, pcOnline: true, sameLanAvailable: true };
const environment = { capabilities: ["local-model"], online: false, risk: "low" as const };

test("only certified active skills execute", async () => {
  const { runtime } = await setup();
  await assert.rejects(() => runtime.start({ skillId: "research", environment, connectivity: offline }), /not certified active/);
});

test("strict execution envelope rejects malformed and unknown capabilities", async () => {
  for (const procedure of ["do whatever", '{"capability":"research.local"}']) {
    const { skills, runtime } = await setup(procedure);
    await skills.certify("research", ["eval:pass"]);
    await assert.rejects(() => runtime.start({ skillId: "research", environment, connectivity: offline }), /execution envelope|unknown Jarvis capability/);
  }
});

test("offline-capable certified skill routes by capability without device names", async () => {
  const { skills, runtime } = await setup();
  await skills.certify("research", ["eval:pass"]);
  const started = await runtime.start({ skillId: "research", environment, connectivity: offline, input: { query: "x" } });
  assert.equal(started.decision.status, "dispatched");
  assert.equal(started.decision.node?.id, "worker-a");
  assert.deepEqual(started.task.requiredCapabilities, ["local-model"]);
  assert.equal((started.task.payload.skill as { id: string }).id, "research");
});

test("online-required skill waits for connectivity rather than failing", async () => {
  const { skills, runtime } = await setup('{"capability":"local-model"}', "online-required");
  await skills.certify("research", ["eval:pass"]);
  const started = await runtime.start({ skillId: "research", environment, connectivity: offline });
  assert.equal(started.decision.status, "waiting-connectivity");
});

test("existing Jarvis Human Gate remains authoritative", async () => {
  const { skills, runtime } = await setup();
  await skills.certify("research", ["eval:pass"]);
  const started = await runtime.start({ skillId: "research", environment: { ...environment, online: true }, connectivity: online, destructive: true });
  assert.equal(started.decision.status, "waiting-human");
  assert.match(started.decision.reasons.join(" "), /Human Gate/);
});

test("idempotency prevents duplicate skill work", async () => {
  const { skills, runtime, queue } = await setup();
  await skills.certify("research", ["eval:pass"]);
  await runtime.start({ skillId: "research", environment, connectivity: offline, input: { query: "same" } });
  await assert.rejects(() => runtime.start({ skillId: "research", environment, connectivity: offline, input: { query: "same" } }), /already exists/);
  assert.equal(queue.list().length, 1);
});

test("skill outcome changes only after evidence-backed execution verification", async () => {
  const { skills, runtime, queue } = await setup();
  await skills.certify("research", ["eval:pass"]);
  const started = await runtime.start({ skillId: "research", environment, connectivity: offline, input: { query: "verify" } });
  assert.equal((await skills.get("research"))?.successes, 0);
  await assert.rejects(() => runtime.recordVerifiedOutcome({ taskId: started.task.id, passed: true, evidence: [] }), /requires evidence/);
  queue.markRunning(started.task.id);
  const updated = await runtime.recordVerifiedOutcome({ taskId: started.task.id, passed: true, evidence: ["artifact:ok"] });
  assert.equal(updated.successes, 1);
  assert.equal(queue.get(started.task.id)?.status, "completed");
});
