import assert from "node:assert/strict";
import test from "node:test";
import { CompassStore } from "../src/compass/store.ts";
import { CompassWorkStateStoreAdapter } from "../src/orchestrator/compass-work-state-store.ts";
import type {
  ActionResult,
  ContextItem,
  Goal,
  LoopState,
  ProposedAction,
  StateStore,
  WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import {
  WorkStateContextSource,
  WorkStateGuardedExecutor,
  WorkStateWriteBackStore,
  goalWorkStateId,
  type WorkStateAction,
  type WorkStateActionResult,
} from "../src/orchestrator/work-state-integration.ts";
import type { WorkEvent, WorkState, WorkStateStore } from "../src/orchestrator/work-state.ts";

const goal: Goal = {
  title: "Ship autonomous work state",
  description: "Make work resumable across agents",
  successCriteria: ["implementation verified", "handoff verified"],
  constraints: ["no Addness dependency"],
};

class MemoryWorkStateStore implements WorkStateStore {
  state: WorkState | null = null;
  events: WorkEvent[] = [];
  async get(goalId: string) { return this.state?.goalId === goalId ? structuredClone(this.state) : null; }
  async put(state: WorkState) { this.state = structuredClone(state); }
  async appendEvent(_goalId: string, event: WorkEvent) { this.events.push(structuredClone(event)); }
}

class MemoryLoopStore implements StateStore {
  records: WriteBackRecord[] = [];
  async getState(): Promise<LoopState> { return { completed: [], blockers: [], nextAction: null }; }
  async writeBack(record: WriteBackRecord) { this.records.push(record); }
}

test("work-state context initializes from the goal and exposes a resumable handoff", async () => {
  const store = new MemoryWorkStateStore();
  const source = new WorkStateContextSource(store);
  const items = await source.collect({ goal, nextAction: null });

  assert.equal(items.length, 1);
  assert.equal(items[0].source, "gai-work-state");
  assert.equal(store.state?.definitionOfDone.length, 2);
  assert.equal(store.state?.constraints[0], "no Addness dependency");
  assert.equal(store.state?.goalId, goalWorkStateId(goal));
});

test("material mutation automatically creates a bounded child work item before execution", async () => {
  const store = new MemoryWorkStateStore();
  await new WorkStateContextSource(store).collect({ goal, nextAction: null });
  const calls: ProposedAction[] = [];
  const inner = {
    async execute(action: ProposedAction, _context: ContextItem[]): Promise<ActionResult> {
      calls.push(action);
      return { actionId: action.id, ok: true, summary: "executed" };
    },
  };
  const guarded = new WorkStateGuardedExecutor(inner, store, goal);
  const action: WorkStateAction = {
    id: "mutate-1",
    description: "change code",
    capability: "shell",
    risk: "low",
  };

  const accepted = await guarded.execute(action, []);
  assert.equal(accepted.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(action.workItemId, "action-mutate-1");
  assert.equal(store.state?.childWorkItems[0].id, "action-mutate-1");
  assert.equal(store.state?.childWorkItems[0].status, "IN_PROGRESS");
});

test("explicit binding to an inactive child work item is rejected", async () => {
  const store = new MemoryWorkStateStore();
  await new WorkStateContextSource(store).collect({ goal, nextAction: null });
  store.state!.childWorkItems.push({
    id: "done-child",
    objective: "old change",
    definitionOfDone: [{ id: "done-dod", description: "verified" }],
    affectedScope: ["src"],
    executionApproach: "edit",
    verificationMethod: "tests",
    status: "COMPLETED",
  });
  const guarded = new WorkStateGuardedExecutor({
    async execute(action: ProposedAction): Promise<ActionResult> {
      return { actionId: action.id, ok: true, summary: "should not run" };
    },
  }, store, goal);
  const rejected = await guarded.execute({
    id: "mutate-2",
    description: "change code again",
    capability: "shell",
    risk: "low",
    workItemId: "done-child",
  } as WorkStateAction, []);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.blocker, "bound_work_item_not_active");
});

test("verified cycle writes artifacts, decisions, DoD and next action back to work state", async () => {
  const workStore = new MemoryWorkStateStore();
  await new WorkStateContextSource(workStore).collect({ goal, nextAction: null });
  workStore.state!.childWorkItems.push({
    id: "child-1",
    objective: "implement",
    definitionOfDone: [{ id: "child-dod", description: "verified" }],
    affectedScope: ["src"],
    executionApproach: "implement",
    verificationMethod: "tests",
    status: "IN_PROGRESS",
  });
  const base = new MemoryLoopStore();
  const store = new WorkStateWriteBackStore(base, workStore);
  const result: WorkStateActionResult = {
    actionId: "a1",
    ok: true,
    summary: "implementation complete",
    currentState: "implementation complete and tested",
    artifacts: [{ id: "code", uri: "repo://src/change.ts", kind: "code" }],
    decisions: [{ id: "d1", summary: "use provider-neutral store", at: "2026-09-13T00:00:00Z" }],
  };
  await store.writeBack({
    goal,
    intent: { summary: "continue", confidence: 1, evidence: [] },
    action: {
      id: "a1",
      description: "implement",
      capability: "shell",
      risk: "low",
      workItemId: "child-1",
      completesWorkItem: true,
      satisfiesDefinitionOfDone: ["criterion-1"],
    } as WorkStateAction,
    result,
    verification: { ok: true, summary: "tests pass", evidence: "node --test" },
    stopReason: "continue",
    nextAction: "verify handoff",
  });

  assert.equal(base.records.length, 1);
  assert.equal(workStore.state?.verificationResults[0].itemId, "criterion-1");
  assert.equal(workStore.state?.artifacts[0].id, "code");
  assert.equal(workStore.state?.decisions[0].id, "d1");
  assert.equal(workStore.state?.childWorkItems[0].status, "COMPLETED");
  assert.equal(workStore.state?.nextAction, "verify handoff");
  assert.equal(workStore.events.length, 1);
});

test("Compass adapter persists work state and events without a provider dependency", async () => {
  const compass = new CompassStore(":memory:");
  const adapter = new CompassWorkStateStoreAdapter(compass);
  const state: WorkState = {
    goalId: "g1",
    objective: "persist",
    definitionOfDone: [],
    currentState: "ready",
    status: "IN_PROGRESS",
    riskClass: "R1",
    constraints: [],
    decisions: [],
    artifacts: [],
    verificationResults: [],
    childWorkItems: [],
    blockers: [],
    nextAction: "continue",
    updatedAt: "2026-09-13T00:00:00Z",
  };
  await adapter.put(state);
  await adapter.appendEvent("g1", { id: "e1", at: "2026-09-13T00:00:01Z", type: "test", summary: "persisted" });

  assert.deepEqual(await adapter.get("g1"), state);
  const active = compass.getState().active as Array<Record<string, unknown>>;
  assert.equal(active.length, 1);
  assert.equal((active[0].events as unknown[]).length, 1);
  compass.close();
});
