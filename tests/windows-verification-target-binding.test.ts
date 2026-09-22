import assert from "node:assert/strict";
import test from "node:test";
import { MultiWorkerRuntime, createFunctionWorker } from "../src/gai/worker-runtime.ts";
import { WindowsRealMachineVerifier } from "../src/orchestrator/windows-real-machine-verifier.ts";
import { validateWindowsVerificationDispatch } from "../src/orchestrator/windows-verification-dispatch.ts";
const task = { id: "pin", description: "bounded check", difficulty: 1, risk: "LOW" as const, requiresFrontierReasoning: false };
test("Windows verification rejects a missing target before any worker action", async () => {
 let executions = 0;
 const worker = createFunctionWorker({ descriptor: { id: "other", label: "Other", platform: "windows", capabilities: ["windows-tooling"], maxParallelTasks: 1, enabled: true }, run: async () => { executions++; return "ok"; } });
 await assert.rejects(() => new WindowsRealMachineVerifier(new MultiWorkerRuntime([worker])).verify({ task, operation: "smoke", preferredWorkerId: "expected" }));
 assert.equal(executions, 0);
});
test("Windows verification never falls back to another platform", async () => {
 let executions = 0;
 const worker = createFunctionWorker({ descriptor: { id: "other", label: "Other", platform: "linux", capabilities: ["windows-tooling"], maxParallelTasks: 1, enabled: true }, run: async () => { executions++; return "ok"; } });
 await assert.rejects(() => new WindowsRealMachineVerifier(new MultiWorkerRuntime([worker])).verify({ task, operation: "smoke" }));
 assert.equal(executions, 0);
});
test("dispatch binds target and differentiates payloads for idempotency", () => {
 const node = { id: "zbook", kind: "windows", capabilities: ["windows-tooling"] };
 assert.throws(() => validateWindowsVerificationDispatch({ targetNodeId: "someone-else", operation: "smoke" }, node), /target/);
 const a = validateWindowsVerificationDispatch({ targetNodeId: "zbook", operation: "test", payload: { target: "a" } }, node);
 const b = validateWindowsVerificationDispatch({ targetNodeId: "zbook", operation: "test", payload: { target: "b" } }, node);
 assert.notEqual(a.idempotencyKey, b.idempotencyKey);
});
