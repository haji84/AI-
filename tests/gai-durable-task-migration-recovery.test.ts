import assert from "node:assert/strict";
import test from "node:test";
import { DurableTaskRuntime, MemoryDurableTaskStore } from "../src/gai/durable-task-runtime.ts";

const t0 = new Date("2026-09-28T00:00:00.000Z");
const plus = (ms: number) => new Date(t0.getTime() + ms);
