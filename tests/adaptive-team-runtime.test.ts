import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultApprovalPolicy,
  GoalDrivenLoop,
  type ActionResult,
  type CapabilityExecutor,
  type InferredIntent,
  type LoopState,
  type Planner,
  type ProposedAction,
  type StateStore,
  type VerificationResult,
  type Verifier,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { runAdaptiveTeamGoal } from "../src/orchestrator/adaptive-team-runner.ts";
import { JsonFileTeamMemoryStore } from "../src/orchestrator/persistent-team-memory.ts";
import { TeamMemory } from "../src/orchestrator/team-organizational-memory.ts";

const goal = {
  title: "CSVを集計する",
  successCriteria: ["集計結果が検証済み"],
  constraints: [],
};

class MemoryStateStore implements StateStore {
  readonly records: WriteBackRecord[] = [];
  private readonly state: LoopState;

  constructor(state: Partial<LoopState> = {}) {
    this.state = { completed: [], blockers: [], ...state };
  }

  async getState(): Promise<LoopState> {
    return structuredClone(this.state);
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    this.records.push(structuredClone(record));
  }
}

class SingleActionPlanner implements Planner {
  private readonly action: ProposedAction;

  constructor(action: ProposedAction) {
    this.action = action;
  }

  async inferIntent(): Promise<InferredIntent> {
    return { summary: "execute requested goal", confidence: 1, evidence: [] };
  }

  async proposeNextAction(): Promise<ProposedAction> {
    return { ...this.action };
  }
}

class PassVerifier implements Verifier {
  async verify(): Promise<VerificationResult> {
    return { ok: true, summary: "verified" };
  }
}

function createLoopFactory(action: ProposedAction, state: Partial<LoopState> = {}) {
  return (executor: CapabilityExecutor) => new GoalDrivenLoop(
    new SingleActionPlanner(action),
    [],
    executor,
    new PassVerifier(),
    new MemoryStateStore(state),
    new DefaultApprovalPolicy(),
  );
}

function successfulExecutor(counter?: { calls: number }): CapabilityExecutor {
  return {
    async execute(action: ProposedAction): Promise<ActionResult> {
      if (counter) counter.calls += 1;
      return { actionId: action.id, ok: true, summary: "executed" };
    },
  };
}

const analyzeAction: ProposedAction = {
  id: "analyze",
  description: "CSVを集計する",
  capability: "data.analyze",
  risk: "low",
  completesBoundedCommand: true,
};

const documentAction: ProposedAction = {
  id: "document",
  description: "集計結果を文書化する",
  capability: "document.write",
  risk: "low",
  completesBoundedCommand: true,
};

const catalog = [
  { name: "data.analyze", roles: ["分析"], matchTerms: ["csv", "集計"] },
  { name: "document.write", roles: ["文書作成"], matchTerms: ["報告書", "文書"] },
];
const requirements = [{ role: "分析", capability: "data.analyze", reason: "CSV集計に必要" }];

test("assemble -> verified execution -> persist -> new process recall -> learn again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "team-memory-"));
  const path = join(directory, "teams.json");
  try {
    const persistence = new JsonFileTeamMemoryStore(path);
    const firstMemory = new TeamMemory();
    const first = await runAdaptiveTeamGoal({
      goal,
      availableCapabilities: catalog,
      requirements,
      memory: firstMemory,
      persistence,
      executor: successfulExecutor(),
      createLoop: createLoopFactory(analyzeAction),
      createBlueprintId: () => "team-csv",
    });

    assert.equal(first.teamSource, "assembled");
    assert.equal(first.run?.stopReason, "goal_complete");
    assert.equal(first.teamOutcome?.verified, true);
    assert.equal(first.memoryUpdated, true);
    assert.equal(firstMemory.get("team-csv")?.uses, 1);

    const secondMemory = await persistence.load();
    const second = await runAdaptiveTeamGoal({
      goal,
      availableCapabilities: catalog,
      requirements,
      memory: secondMemory,
      persistence,
      executor: successfulExecutor(),
      createLoop: createLoopFactory(analyzeAction),
    });

    assert.equal(second.teamSource, "recalled");
    assert.equal(second.blueprintId, "team-csv");
    assert.equal(secondMemory.get("team-csv")?.uses, 2);

    const thirdProcessMemory = await persistence.load();
    assert.equal(thirdProcessMemory.get("team-csv")?.uses, 2);
    assert.equal(thirdProcessMemory.get("team-csv")?.verifiedSuccesses, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("necessary registered capability is added at runtime and execution continues", async () => {
  const counter = { calls: 0 };
  const memory = new TeamMemory();
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory,
    executor: successfulExecutor(counter),
    createLoop: createLoopFactory(documentAction),
    createBlueprintId: () => "team-expanded",
    evaluateExpansionNecessity: () => ({ necessary: true, reason: "required to satisfy the deliverable" }),
  });

  assert.equal(report.run?.stopReason, "goal_complete");
  assert.equal(counter.calls, 1);
  assert.equal(report.expansions.length, 1);
  assert.equal(report.expansions[0]?.accepted, true);
  assert.ok(report.teamPlan.assignments.some((assignment) => assignment.capability === "document.write"));
  assert.ok(memory.get("team-expanded")?.assignments.some((assignment) => assignment.capability === "document.write"));
});

test("unnecessary requested capability is not added or executed", async () => {
  const counter = { calls: 0 };
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory: new TeamMemory(),
    executor: successfulExecutor(counter),
    createLoop: createLoopFactory(documentAction),
    evaluateExpansionNecessity: () => ({ necessary: false, reason: "not required by current DoD" }),
  });

  assert.equal(counter.calls, 0);
  assert.equal(report.run, null);
  assert.equal(report.expansions[0]?.accepted, false);
  assert.match(report.blockedReason ?? "", /capability_expansion_not_necessary/);
});

test("unregistered capability is never fabricated", async () => {
  const counter = { calls: 0 };
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: [{ name: "data.analyze", roles: ["分析"], matchTerms: ["csv"] }],
    requirements,
    memory: new TeamMemory(),
    executor: successfulExecutor(counter),
    createLoop: createLoopFactory(documentAction),
    evaluateExpansionNecessity: () => ({ necessary: true, reason: "needed" }),
  });

  assert.equal(counter.calls, 0);
  assert.match(report.blockedReason ?? "", /capability_not_registered:document.write/);
});

test("capability expansion budget prevents unbounded team growth", async () => {
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory: new TeamMemory(),
    executor: successfulExecutor(),
    createLoop: createLoopFactory(documentAction),
    maxCapabilityExpansions: 0,
    evaluateExpansionNecessity: () => ({ necessary: true, reason: "needed" }),
  });

  assert.equal(report.expansions[0]?.accepted, false);
  assert.match(report.blockedReason ?? "", /capability_expansion_budget_exhausted/);
});

test("human approval gate remains authoritative before dynamic capability expansion", async () => {
  const counter = { calls: 0 };
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory: new TeamMemory(),
    executor: successfulExecutor(counter),
    createLoop: createLoopFactory({
      ...documentAction,
      id: "production-deploy",
      description: "本番へデプロイする",
      capability: "document.write",
      risk: "high",
      requiresHumanApproval: true,
    }),
    evaluateExpansionNecessity: () => ({ necessary: true, reason: "planner says needed" }),
  });

  assert.equal(report.run?.stopReason, "approval_required");
  assert.equal(counter.calls, 0);
  assert.equal(report.expansions.length, 0);
  assert.equal(report.teamOutcome, null);
});

test("missing required capability blocks before GoalDrivenLoop is created", async () => {
  let loopCreated = false;
  const report = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements: [{ role: "画像", capability: "image.render", reason: "成果物が必要" }],
    memory: new TeamMemory(),
    executor: successfulExecutor(),
    createLoop(executor) {
      loopCreated = true;
      return createLoopFactory(analyzeAction)(executor);
    },
  });

  assert.equal(report.run, null);
  assert.equal(report.teamPlan.blocked, true);
  assert.equal(loopCreated, false);
  assert.match(report.blockedReason ?? "", /image.render/);
});

test("paused and approval-required runs do not contaminate team performance", async () => {
  const pausedMemory = new TeamMemory();
  const paused = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory: pausedMemory,
    executor: successfulExecutor(),
    createLoop: createLoopFactory(analyzeAction, { paused: true }),
    createBlueprintId: () => "paused-team",
  });
  assert.equal(paused.run?.stopReason, "paused");
  assert.equal(paused.teamOutcome, null);
  assert.equal(pausedMemory.get("paused-team"), null);

  const approvalMemory = new TeamMemory();
  const approval = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory: approvalMemory,
    executor: successfulExecutor(),
    createLoop: createLoopFactory({ ...analyzeAction, requiresHumanApproval: true }),
    createBlueprintId: () => "approval-team",
  });
  assert.equal(approval.run?.stopReason, "approval_required");
  assert.equal(approval.teamOutcome, null);
  assert.equal(approvalMemory.get("approval-team"), null);
});

test("successful expanded child team is preferred on equal recall evidence", async () => {
  const memory = new TeamMemory();
  await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory,
    executor: successfulExecutor(),
    createLoop: createLoopFactory(analyzeAction),
    createBlueprintId: () => "team-parent",
  });

  const expanded = await runAdaptiveTeamGoal({
    goal,
    availableCapabilities: catalog,
    requirements,
    memory,
    executor: successfulExecutor(),
    createLoop: createLoopFactory(documentAction),
    createBlueprintId: () => "team-child",
    evaluateExpansionNecessity: () => ({ necessary: true, reason: "needed for final deliverable" }),
  });
  assert.equal(expanded.blueprintId, "team-child");
  assert.equal(memory.get("team-child")?.parentId, "team-parent");
  assert.ok(memory.get("team-child")?.assignments.some((assignment) => assignment.capability === "document.write"));

  const recalled = memory.recall(goal, catalog.map((capability) => capability.name));
  assert.equal(recalled?.id, "team-child");
});

test("corrupt persistent team memory fails visibly instead of silently resetting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "team-memory-corrupt-"));
  const path = join(directory, "teams.json");
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{not-json", "utf8");
    await assert.rejects(() => new JsonFileTeamMemoryStore(path).load());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
