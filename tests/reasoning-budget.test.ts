import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readReasoningUsage, recordReasoningUse } from "../src/orchestrator/reasoning-budget.ts";

test("counts only fresh Work and Codex handoffs", () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoning-budget-"));
  try {
    const now = new Date("2026-09-03T12:00:00.000Z");
    assert.deepEqual(readReasoningUsage(dir, now), { work: 0, codex: 0 });
    assert.deepEqual(recordReasoningUse(dir, "chat", now), { work: 0, codex: 0 });
    assert.deepEqual(recordReasoningUse(dir, "work", now), { work: 1, codex: 0 });
    assert.deepEqual(recordReasoningUse(dir, "codex", now), { work: 1, codex: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resets counters on a new UTC day", () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoning-budget-"));
  try {
    recordReasoningUse(dir, "codex", new Date("2026-09-03T23:59:00.000Z"));
    assert.deepEqual(readReasoningUsage(dir, new Date("2026-09-04T00:01:00.000Z")), { work: 0, codex: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
