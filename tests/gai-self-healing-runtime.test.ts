import assert from "node:assert/strict";
import test from "node:test";
import {
  SelfHealingRuntime,
  classifyActionFailure,
  classifyFailure,
  classifyVerificationFailure,
  decideHealing,
} from "../src/gai/self-healing-runtime.ts";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";
import { MultiWorkerRuntime, createFunctionWorker, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";

const workerDescriptor = (id: string): WorkerDescriptor => ({
  id,
  label: id,
  platform: id === "zbook" ? "windows" : "macos",
  deviceType: "laptop",
  capabilities: ["local-model"],
  executionModes: ["resident"],
  networkRequirement: "offline-capable",
  maxParallelTasks: 1,
  enabled: true,
});

const history = (attemptsForSignature = 1, strategyPivots = 0, totalAttempts = 1) => ({
  failureSignature: "",
  attemptsForSignature,
  strategyPivots,
  totalAttempts,
});

test("classifies ordinary failures into repairable taxonomy", () => {
  assert.equal(classifyFailure("ECONNREFUSED network offline").kind, "connectivity");
  assert.equal(classifyFailure("CUDA out of memory").kind, "gpu");
  assert.equal(classifyFailure("ollama model unavailable").kind, "model");
  assert.equal(classifyFailure("verification expected actual mismatch").kind, "verification");
  assert.equal(classifyFailure("UI selector element missing").kind, "ui");
  assert.equal(classifyFailure("command not found tool").kind, "tool");
});

test("standing Human Gate classes are hard blockers and cannot auto-repair", () => {
  for (const text of [
    "credential token missing",
    "permission forbidden 403",
    "billing payment required",
    "destructive irreversible delete production",
    "security governance weakening requested",
    "HUMAN_GATE approval required",
  ]) {
    const failure = classifyFailure(text);
    assert.equal(failure.hardBlocker, true, text);
    const decision = decideHealing({ failure, history: history() });
    assert.equal(decision.action, "blocked", text);
    assert.equal(decision.recovery.blocked, true, text);
  }
});

test("connectivity and resource conditions wait rather than burn repair loop", () => {
  const connectivity = decideHealing({
    failure: classifyFailure("network offline"),
    history: history(2, 1, 5),
  });
  assert.equal(connectivity.action, "wait_connectivity");

  const resource = decideHealing({
    failure: classifyFailure("GPU resource busy"),
    history: history(2, 1, 5),
  });
  assert.equal(resource.action, "wait_resource");
});

test("repeated implementation failure pivots into a replan instead of looping", () => {
  const failure = classifyFailure("model inference produced invalid output");
  const decision = decideHealing({
    failure,
    history: history(3, 0, 3),
    limits: { maxAttemptsPerSignature: 3, maxStrategyPivots: 2, maxTotalAttempts: 9 },
  });
  assert.equal(decision.action, "replan");
  assert.match(decision.replanHint ?? "", /materially different strategy/);
});

test("total recovery budget remains bounded", () => {
  const decision = decideHealing({
    failure: classifyFailure("unknown repeated failure"),
    history: history(2, 2, 9),
    limits: { maxAttemptsPerSignature: 3, maxStrategyPivots: 2, maxTotalAttempts: 9 },
  });
  assert.equal(decision.action, "blocked");
  assert.equal(decision.recovery.blocked, true);
});

test("worker failure falls back to another compatible worker but waits for verifier before completion", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({
    id: "fallback-task",
    idempotencyKey: "fallback-task",
    type: "local-research",
    requiredCapabilities: ["local-model"],
  });
  await tasks.lease("fallback-task", "zbook", 60_000);
  await tasks.markRunning("fallback-task", "zbook");
  const task = (await tasks.get("fallback-task"))!;

  const zbook = createFunctionWorker({
    descriptor: workerDescriptor("zbook"),
    run: async () => { throw new Error("worker unavailable"); },
  });
  const macbook = createFunctionWorker({
    descriptor: workerDescriptor("macbook"),
    run: async () => "recovered on macbook",
  });
  const runtime = new SelfHealingRuntime({
    tasks,
    workers: new MultiWorkerRuntime([zbook, macbook]),
  });
  const request = {
    task: {
      id: "fallback-task",
      description: "local research",
      difficulty: 3,
      requiresFrontierReasoning: false,
      requiresLongContext: false,
      requiresToolUse: true,
      risk: "LOW" as const,
    },
    input: "test",
    requestedCapability: "local-model" as const,
    requiredCapabilities: ["local-model" as const],
  };

  const outcome = await runtime.handleTaskFailure({
    task,
    failure: "worker unavailable on zbook",
    history: history(),
    failedWorkerId: "zbook",
    request,
  });

  assert.equal(outcome.decision.action, "fallback_worker");
  assert.equal(outcome.evidence.selectedFallbackWorkerId, "macbook");
  assert.equal(outcome.evidence.verificationRequired, true);
  assert.equal(outcome.fallbackResult?.ok, true);
  assert.equal(outcome.task.status, "running");
  assert.equal(outcome.task.leaseOwner, "macbook");

  const completed = await runtime.completeAfterVerification({
    taskId: "fallback-task",
    workerId: "macbook",
    workerResult: outcome.fallbackResult!,
    verification: { ok: true, summary: "fallback evidence verified" },
  });
  assert.equal(completed.status, "completed");
  assert.equal((completed.result as { recoveredBy?: string }).recoveredBy, "macbook");
});

test("failed verification after fallback re-enters retry instead of completing", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "verify-retry", idempotencyKey: "verify-retry", type: "work", maxAttempts: 3 });
  await tasks.lease("verify-retry", "macbook", 60_000);
  await tasks.markRunning("verify-retry", "macbook");
  const runtime = new SelfHealingRuntime({ tasks, workers: new MultiWorkerRuntime([]) });
  const task = await runtime.completeAfterVerification({
    taskId: "verify-retry",
    workerId: "macbook",
    workerResult: { ok: true, workerId: "macbook", platform: "macos", output: "candidate", durationMs: 1 },
    verification: { ok: false, summary: "expected artifact missing" },
  });
  assert.equal(task.status, "retrying");
  assert.match(task.error ?? "", /verification failed/);
});

test("missing fallback capacity waits for resource instead of terminal failure", async () => {
  const tasks = new DurableTaskRuntime(new MemoryDurableTaskStore());
  await tasks.enqueue({ id: "no-fallback", idempotencyKey: "no-fallback", type: "work" });
  const task = (await tasks.get("no-fallback"))!;
  const runtime = new SelfHealingRuntime({ tasks, workers: new MultiWorkerRuntime([]) });
  const outcome = await runtime.handleTaskFailure({
    task,
    failure: "worker unavailable",
    history: history(),
    failedWorkerId: "dead-worker",
    request: {
      task: {
        id: "no-fallback",
        description: "work",
        difficulty: 3,
        requiresFrontierReasoning: false,
        requiresLongContext: false,
        requiresToolUse: true,
        risk: "LOW",
      },
      input: "x",
      requestedCapability: "local-model",
      requiredCapabilities: ["local-model"],
    },
  });
  assert.equal(outcome.task.status, "waiting-resource");
});

test("verification failure is repairable and success is never inferred by classifier", () => {
  const failure = classifyVerificationFailure({ ok: false, summary: "expected file missing" });
  assert.equal(failure?.kind, "verification");
  const decision = decideHealing({ failure: failure!, history: history(1) });
  assert.equal(decision.action, "repair");

  assert.equal(classifyVerificationFailure({ ok: true, summary: "verified" }), null);
  assert.equal(classifyActionFailure({ actionId: "a", ok: true, summary: "done" }), null);
});

test("action failure preserves permission boundary", () => {
  const failure = classifyActionFailure({
    actionId: "permission",
    ok: false,
    summary: "permission change requires Human Gate",
    blocker: "HUMAN_GATE",
  });
  assert.equal(failure?.hardBlocker, true);
  assert.equal(decideHealing({ failure: failure!, history: history() }).action, "blocked");
});
