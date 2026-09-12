import assert from "node:assert/strict";
import test from "node:test";
import { routeResearchWork, type ResearchWorkerState } from "../src/gai/research-control-plane.ts";

const offlineWorkers: ResearchWorkerState[] = [
  { id: "zbook", platform: "windows", online: false, capabilities: ["local-model", "gpu", "windows-tooling", "long-running"] },
  { id: "macbook", platform: "macos", online: false, capabilities: ["local-model", "macos-tooling", "long-running"] },
];

test("evidence/control work stays runnable when every workstation is offline", () => {
  assert.equal(routeResearchWork({ id: "ledger", kind: "evidence" }, offlineWorkers).action, "run-hosted");
  assert.equal(routeResearchWork({ id: "control", kind: "control" }, offlineWorkers).action, "run-hosted");
  assert.equal(routeResearchWork({ id: "safe", kind: "local-safe" }, offlineWorkers).action, "run-hosted");
});

test("local-model work fails over from ZBook to MacBook", () => {
  const workers: ResearchWorkerState[] = [
    { ...offlineWorkers[0] },
    { ...offlineWorkers[1], online: true },
  ];
  const decision = routeResearchWork({ id: "r2", kind: "local-model", preferredWorkerId: "zbook" }, workers);
  assert.equal(decision.action, "run-worker");
  assert.equal(decision.workerId, "macbook");
});

test("GPU work is deferred instead of crashing the control plane", () => {
  const decision = routeResearchWork({ id: "r18", kind: "gpu" }, offlineWorkers);
  assert.equal(decision.action, "defer");
  assert.equal(decision.queueState, "WAITING_FOR_CAPABILITY");
});

test("cross-device work requires two online local-model platforms", () => {
  const oneWorker: ResearchWorkerState[] = [{ ...offlineWorkers[1], online: true }];
  assert.equal(routeResearchWork({ id: "r13", kind: "cross-device" }, oneWorker).action, "defer");

  const both = offlineWorkers.map((worker) => ({ ...worker, online: true }));
  const decision = routeResearchWork({ id: "r13", kind: "cross-device" }, both);
  assert.equal(decision.action, "run-worker");
  assert.equal(decision.workerId, "macbook,zbook");
});

test("external and human stages remain gated", () => {
  assert.equal(routeResearchWork({ id: "r3", kind: "external-runtime" }, offlineWorkers).queueState, "EXTERNAL_GATE");
  assert.equal(routeResearchWork({ id: "r20", kind: "human-review" }, offlineWorkers).queueState, "HUMAN_GATE");
});
