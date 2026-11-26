import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import { ProductionAutonomyRuntime } from "../src/gai/production-autonomy-runtime.ts";
import { readJarvisRecoveryDashboard } from "../src/jarvis/recovery-dashboard.ts";
import { GoalDrivenLoop } from "../src/orchestrator/goal-loop.ts";

const observedAt = "2026-11-05T06:00:00.000Z";
const earlierAt = "2026-11-05T05:59:00.000Z";
const terminalSummary = "PUBLIC_DUMMY_REQUIRED_ARTIFACT_NOT_VERIFIED";

async function runFile(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-terminal-blocker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "runs.json");
}

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    cycle: 2,
    observedAt,
    kind: "terminal",
    summary: terminalSummary,
    blocker: null,
    actionId: null,
    actionDescription: null,
    ...overrides,
  };
}

function blockedRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "public-dummy-blocked-run",
    goal: { title: "Public dummy artifact acceptance", successCriteria: ["artifact verified"], constraints: [] },
    state: "blocked",
    cycles: 2,
    updatedAt: observedAt,
    completionEvidence: [],
    failureHistory: [terminal()],
    recoveryHistory: [],
    journal: { nextAction: "Inspect the required artifact" },
    ...overrides,
  };
}

function recovery(overrides: Record<string, unknown> = {}) {
  return {
    cycle: 1,
    observedAt: earlierAt,
    action: "blocked",
    reason: "Recovery strategy exhausted",
    blocked: true,
    nextStrategyPivot: 0,
    actionId: null,
    actionDescription: null,
    nextAction: "Inspect the recovery budget",
    ...overrides,
  };
}

async function persist(path: string, runs: unknown[]) {
  await writeFile(path, `${JSON.stringify({ version: 1, runs })}\n`, "utf8");
}

test("OPS-009 exposes a real Goal Loop completion blocker persisted by ProductionAutonomyRuntime", async (t) => {
  const path = await runFile(t);
  const goal = { title: "Public dummy artifact acceptance", successCriteria: ["artifact verified"], constraints: ["fixture only"] };
  const runtime = new ProductionAutonomyRuntime(path, () => new GoalDrivenLoop(
    { inferIntent: async () => ({ summary: "public dummy goal", confidence: 1, evidence: [] }), proposeNextAction: async () => null },
    [],
    { execute: async () => { throw new Error("completion-blocked goal must not execute"); } },
    { verify: async () => { throw new Error("completion-blocked goal must not verify an action"); } },
    {
      getState: async () => ({ completed: [], blockers: [], nextAction: null }),
      writeBack: async () => {},
      completionBlockers: async () => [terminalSummary],
    },
  ));

  const run = await runtime.run({ runId: "public-dummy-blocked-run", goal, maxCycles: 1 });
  const sourceBefore = await readFile(path, "utf8");
  const persisted = JSON.parse(sourceBefore);
  assert.equal(run.state, "blocked");
  assert.equal(run.lastReport?.stopReason, "blocked");
  assert.equal(persisted.runs[0].failureHistory[0].kind, "terminal");
  assert.equal(persisted.runs[0].failureHistory[0].summary, terminalSummary);

  const dashboard = await readJarvisRecoveryDashboard(path);
  assert.equal(dashboard.state, "blocked");
  assert.equal(dashboard.blocker, terminalSummary);
  assert.equal(dashboard.reason, terminalSummary);
  assert.equal(dashboard.cycle, 1);
  assert.equal(dashboard.observedAt, persisted.runs[0].failureHistory[0].observedAt);
  assert.equal(dashboard.recoveryAction, null);
  assert.equal(dashboard.nextAction, terminalSummary);
  assert.equal(await readFile(path, "utf8"), sourceBefore);
});

test("OPS-009 projects trimmed terminal summary and explicit blocker independently", async (t) => {
  const path = await runFile(t);
  await persist(path, [blockedRun({ failureHistory: [terminal({ summary: "  Required artifact is unverified  ", blocker: "  Artifact verification missing  " })] })]);

  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.reason, "Required artifact is unverified");
  assert.equal(report.blocker, "Artifact verification missing");
  assert.equal(report.cycle, 2);
  assert.equal(report.observedAt, observedAt);
});

test("OPS-009 terminal projection omits raw evidence, action descriptions and last reports without rewriting persistence", async (t) => {
  const path = await runFile(t);
  const rawEvidence = "PUBLIC_DUMMY_RAW_EVIDENCE_DO_NOT_COPY";
  await persist(path, [blockedRun({
    failureHistory: [terminal({ actionId: rawEvidence, actionDescription: rawEvidence, evidence: { rawEvidence } })],
    completionEvidence: [{ rawEvidence }],
    lastReport: { stopReason: "blocked", result: { evidence: rawEvidence }, action: { description: rawEvidence } },
  })]);
  const sourceBefore = await readFile(path, "utf8");

  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.blocker, terminalSummary);
  assert.equal(JSON.stringify(report).includes(rawEvidence), false);
  assert.equal("failureHistory" in report, false);
  assert.equal("lastReport" in report, false);
  assert.equal(await readFile(path, "utf8"), sourceBefore);
});

for (const { name, overrides, blocker, reason, cycle } of [
  {
    name: "budget",
    overrides: { recoveryBudget: { blockedReason: "Durable non-progress budget exhausted" }, recoveryHistory: [recovery()] },
    blocker: "Durable non-progress budget exhausted",
    reason: "Recovery strategy exhausted",
    cycle: 1,
  },
  {
    name: "recovery",
    overrides: { recoveryHistory: [recovery()] },
    blocker: "Recovery strategy exhausted",
    reason: "Recovery strategy exhausted",
    cycle: 1,
  },
  {
    name: "approval",
    overrides: { state: "approval-required" },
    blocker: "Human Gate pending",
    reason: null,
    cycle: null,
  },
]) {
  test(`OPS-009 preserves existing ${name} blocker precedence over terminal history`, async (t) => {
    const path = await runFile(t);
    await persist(path, [blockedRun(overrides)]);
    const report = await readJarvisRecoveryDashboard(path);
    assert.equal(report.blocker, blocker);
    assert.equal(report.reason, reason);
    assert.equal(report.cycle, cycle);
  });
}

test("OPS-009 selects the current terminal failure rather than an older history entry", async (t) => {
  const path = await runFile(t);
  await persist(path, [blockedRun({ failureHistory: [terminal(), terminal({ cycle: 1, observedAt: earlierAt, summary: "Previous failure" })] })]);
  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.blocker, terminalSummary);
  assert.equal(report.cycle, 2);
  assert.equal(report.observedAt, observedAt);
});

test("OPS-009 uses current terminal reason and cycle after an earlier nonblocking recovery decision", async (t) => {
  const path = await runFile(t);
  await persist(path, [blockedRun({ recoveryHistory: [recovery({ action: "repair", blocked: false, reason: "Previous repair" })] })]);
  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.blocker, terminalSummary);
  assert.equal(report.reason, terminalSummary);
  assert.equal(report.cycle, 2);
  assert.equal(report.observedAt, observedAt);
});

for (const { name, entry } of [
  { name: "prior cycle even when timestamps tie", entry: terminal({ cycle: 1 }) },
  { name: "prior timestamp even when cycles match", entry: terminal({ observedAt: earlierAt }) },
  { name: "future cycle", entry: terminal({ cycle: 3 }) },
  { name: "future timestamp", entry: terminal({ observedAt: "2026-11-05T06:01:00.000Z" }) },
  { name: "execution failure", entry: terminal({ kind: "execution" }) },
  { name: "verification failure", entry: terminal({ kind: "verification" }) },
]) {
  test(`OPS-009 does not treat a ${name} as the current terminal blocker`, async (t) => {
    const path = await runFile(t);
    await persist(path, [blockedRun({ failureHistory: [entry] })]);
    const report = await readJarvisRecoveryDashboard(path);
    assert.equal(report.state, "blocked");
    assert.equal(report.blocker, null);
    assert.equal(report.reason, null);
    assert.equal(report.cycle, null);
  });
}

for (const state of ["running", "waiting", "completed"]) {
  test(`OPS-009 does not promote terminal history from a ${state} run into a current blocker`, async (t) => {
    const path = await runFile(t);
    await persist(path, [blockedRun({ state })]);
    const report = await readJarvisRecoveryDashboard(path);
    assert.equal(report.blocker, null);
    assert.equal(report.reason, null);
    assert.equal(report.cycle, null);
    assert.equal(report.state, state === "completed" ? "idle" : state === "waiting" ? "waiting" : "unknown");
  });
}

test("OPS-009 never borrows a terminal blocker from an older run", async (t) => {
  const path = await runFile(t);
  await persist(path, [
    blockedRun({ runId: "old-blocked-run", updatedAt: earlierAt, failureHistory: [terminal({ observedAt: earlierAt })] }),
    blockedRun({ runId: "new-blocked-run", failureHistory: [] }),
  ]);
  const report = await readJarvisRecoveryDashboard(path);
  assert.equal(report.runId, "new-blocked-run");
  assert.equal(report.blocker, null);
  assert.equal(report.reason, null);
});

for (const { name, overrides } of [
  { name: "missing cycle count", overrides: { cycles: undefined } },
  { name: "missing failure history", overrides: { failureHistory: undefined } },
]) {
  test(`OPS-009 preserves unknown terminal details for legacy state with ${name}`, async (t) => {
    const path = await runFile(t);
    await persist(path, [blockedRun(overrides)]);
    const report = await readJarvisRecoveryDashboard(path);
    assert.equal(report.state, "blocked");
    assert.equal(report.blocker, null);
    assert.equal(report.reason, null);
    assert.equal(report.cycle, null);
  });
}

for (const { name, history } of [
  { name: "non-array history", history: {} },
  { name: "null history entry", history: [null] },
  { name: "invalid cycle", history: [terminal({ cycle: 0 })] },
  { name: "invalid timestamp", history: [terminal({ observedAt: "not-a-date" })] },
  { name: "unknown failure kind", history: [terminal({ kind: "unknown" })] },
  { name: "empty summary", history: [terminal({ summary: "  " })] },
  { name: "invalid blocker", history: [terminal({ blocker: {} })] },
  { name: "invalid action description", history: [terminal({ actionDescription: 42 })] },
]) {
  test(`OPS-009 rejects malformed terminal failure history: ${name}`, async (t) => {
    const path = await runFile(t);
    await persist(path, [blockedRun({ failureHistory: history })]);
    await assert.rejects(() => readJarvisRecoveryDashboard(path), /invalid production recovery dashboard file/);
  });
}
