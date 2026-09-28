import assert from "node:assert/strict";
import test from "node:test";
import { MultiWorkerRuntime, createFunctionWorker, type WorkerDescriptor } from "../src/gai/worker-runtime.ts";

const task = { id: "resource-task", title: "resource task", description: "resource-aware placement", difficulty: 3, risk: "LOW" as const, requiresFrontierReasoning: false, requiresLongContext: false };
const descriptor = (id: string, platform: WorkerDescriptor["platform"] = "windows"): WorkerDescriptor => ({ id, label: id, platform, capabilities: ["filesystem"], maxParallelTasks: 2, enabled: true });
