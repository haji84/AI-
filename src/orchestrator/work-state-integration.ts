import { createHash } from "node:crypto";
import type {
  ActionResult,
  CapabilityExecutor,
  ContextItem,
  ContextSource,
  Goal,
  Planner,
  ProposedAction,
  StateStore,
  Verifier,
  WriteBackRecord,
} from "./goal-loop.ts";
import { GoalDrivenLoop, type ApprovalPolicy, type GoalLoopOptions } from "./goal-loop.ts";
import {
  createHandoffSnapshot,
  deriveWorkStatus,
  mergeDefinitionOfDoneResults,
  validateMutationBinding,
  type ArtifactRef,
  type ChildWorkItem,
  type DecisionRecord,
  type DefinitionOfDoneResult,
  type WorkEvent,
  type WorkRiskClass,
  type WorkState,
  type WorkStateStore,
} from "./work-state.ts";

export interface WorkStateAction extends ProposedAction {
  materialMutation?: boolean;
  workItemId?: string | null;
  satisfiesDefinitionOfDone?: string[];
  completesWorkItem?: boolean;
}

export interface WorkStateActionResult extends ActionResult {
  artifacts?: ArtifactRef[];
  decisions?: DecisionRecord[];
  definitionOfDoneResults?: DefinitionOfDoneResult[];
  currentState?: string;
  blockers?: string[];
  resolvedBlockers?: string[];
}

export function goalWorkStateId(goal: Goal): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ title: goal.title, description: goal.description ?? "" }))
    .digest("hex")
    .slice(0, 16);
  return `goal-${digest}`;
}

function initialWorkState(goal: Goal, goalId: string, now: string): WorkState {
  return {
    goalId,
    objective: goal.description?.trim() || goal.title,
    definitionOfDone: goal.successCriteria.map((description, index) => ({
      id: `criterion-${index + 1}`,
      description,
      required: true,
    })),
    currentState: "",
    status: "NOT_STARTED",
    riskClass: "R0",
    constraints: [...goal.constraints],
    decisions: [],
    artifacts: [],
    verificationResults: [],
    childWorkItems: [],
    blockers: [],
    nextAction: null,
    updatedAt: now,
  };
}

function riskClass(record: WriteBackRecord, current: WorkRiskClass): WorkRiskClass {
  switch (record.riskDecision?.level) {
    case "CRITICAL": return "R4";
    case "HIGH": return "R3";
    case "MEDIUM": return "R2";
    case "LOW": return "R1";
    default: return current;
  }
}

async function ensureState(store: WorkStateStore, goal: Goal): Promise<WorkState> {
  const goalId = goalWorkStateId(goal);
  const existing = await store.get(goalId);
  if (existing) return existing;
  const state = initialWorkState(goal, goalId, new Date().toISOString());
  await store.put(state);
  return state;
}

function hasMutationSignal(action: ProposedAction): boolean {
  const bound = action as WorkStateAction;
  if (bound.materialMutation === true) return true;
  if (action.externalSideEffect === true || action.irreversible === true) return true;
  if (Object.values(action.riskSignals ?? {}).some((value) => value === true)) return true;
  return /(^|[.:_-])(write|edit|patch|mutate|create|update|commit|merge|deploy|publish|delete|remove|propose_pr|shell|powershell|pwsh|npm)([.:_-]|$)/i
    .test(action.capability);
}

function affectedScope(action: ProposedAction): string[] {
  const input = action.input;
  if (input && typeof input === "object") {
    const files = (input as { files?: unknown }).files;
    if (Array.isArray(files)) {
      const paths = files
        .map((file) => file && typeof file === "object" ? (file as { path?: unknown }).path : null)
        .filter((path): path is string => typeof path === "string" && path.trim().length > 0);
      if (paths.length > 0) return paths;
    }
  }
  return [action.capability];
}

function automaticWorkItem(action: ProposedAction): ChildWorkItem {
  return {
    id: `action-${action.id}`,
    objective: action.description,
    definitionOfDone: [{ id: `action-${action.id}-verified`, description: "Goal Loop verifier accepts the action result" }],
    affectedScope: affectedScope(action),
    executionApproach: `Execute through capability ${action.capability}`,
    verificationMethod: "Goal Loop verifier evidence",
    status: "IN_PROGRESS",
  };
}

export class WorkStateContextSource implements ContextSource {
  readonly name = "gai-work-state";
  private readonly store: WorkStateStore;

  constructor(store: WorkStateStore) {
    this.store = store;
  }

  async collect(input: { goal: Goal }): Promise<ContextItem[]> {
    const state = await ensureState(this.store, input.goal);
    const snapshot = createHandoffSnapshot(state);
    return [{
      source: this.name,
      summary: `Work state ${snapshot.status}; next=${snapshot.nextAction ?? "none"}; blockers=${snapshot.blockers.length}; remaining_dod=${snapshot.remainingDefinitionOfDone.length}`,
      data: snapshot,
    }];
  }
}

export class WorkStateGuardedExecutor implements CapabilityExecutor {
  private readonly inner: CapabilityExecutor;
  private readonly store: WorkStateStore;
  private readonly goal: Goal;

  constructor(inner: CapabilityExecutor, store: WorkStateStore, goal: Goal) {
    this.inner = inner;
    this.store = store;
    this.goal = goal;
  }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const bound = action as WorkStateAction;
    let state = await ensureState(this.store, this.goal);
    const materialMutation = hasMutationSignal(action);

    if (materialMutation && !bound.workItemId?.trim()) {
      const generated = automaticWorkItem(action);
      const existing = state.childWorkItems.find((item) => item.id === generated.id);
      if (!existing) {
        state = {
          ...state,
          childWorkItems: [...state.childWorkItems, generated],
          updatedAt: new Date().toISOString(),
        };
        await this.store.put(state);
      }
      bound.workItemId = generated.id;
      bound.completesWorkItem ??= true;
    }

    const validation = validateMutationBinding({
      materialMutation,
      workItemId: bound.workItemId,
    }, state);
    if (!validation.ok) {
      return {
        actionId: action.id,
        ok: false,
        summary: `Work-State mutation gate rejected action: ${validation.reason}`,
        blocker: validation.reason,
      };
    }
    return this.inner.execute(action, context);
  }
}

export class WorkStateWriteBackStore implements StateStore {
  private readonly inner: StateStore;
  private readonly workState: WorkStateStore;

  constructor(inner: StateStore, workState: WorkStateStore) {
    this.inner = inner;
    this.workState = workState;
  }

  completionBlockers(goal: Goal) { return this.inner.completionBlockers?.(goal) ?? Promise.resolve([]); }

  getState() {
    return this.inner.getState();
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    await this.inner.writeBack(record);
    let state = await ensureState(this.workState, record.goal);
    const result = record.result as WorkStateActionResult | null | undefined;
    const action = record.action as WorkStateAction | null | undefined;
    const now = new Date().toISOString();

    const incomingResults = [...(result?.definitionOfDoneResults ?? [])];
    if (record.verification?.ok && action?.satisfiesDefinitionOfDone) {
      for (const itemId of action.satisfiesDefinitionOfDone) {
        incomingResults.push({ itemId, passed: true, evidence: record.verification.evidence ?? record.result?.evidence });
      }
    }
    if (incomingResults.length > 0) {
      state = mergeDefinitionOfDoneResults(state, incomingResults, now);
    }

    const resolved = new Set(result?.resolvedBlockers ?? []);
    const blockers = state.blockers.filter((blocker) => !resolved.has(blocker));
    for (const blocker of result?.blockers ?? []) {
      if (!blockers.includes(blocker)) blockers.push(blocker);
    }
    if (record.result?.blocker && !blockers.includes(record.result.blocker)) blockers.push(record.result.blocker);

    const childWorkItems = state.childWorkItems.map((item) => {
      if (action?.completesWorkItem && action.workItemId === item.id && record.verification?.ok) {
        return { ...item, status: "COMPLETED" as const };
      }
      if (action?.workItemId === item.id && record.result?.blocker) {
        return { ...item, status: "BLOCKED" as const };
      }
      return item;
    });

    const next: WorkState = {
      ...state,
      currentState: result?.currentState ?? record.result?.summary ?? record.verification?.summary ?? state.currentState,
      riskClass: riskClass(record, state.riskClass),
      decisions: [...state.decisions, ...(result?.decisions ?? [])],
      artifacts: [...state.artifacts, ...(result?.artifacts ?? [])],
      childWorkItems,
      blockers,
      nextAction: record.nextAction ?? null,
      updatedAt: now,
    };
    next.status = deriveWorkStatus(next);
    await this.workState.put(next);

    const event: WorkEvent = {
      id: `${record.action?.id ?? "cycle"}-${Date.now()}`,
      at: now,
      type: "goal_loop_cycle",
      summary: record.result?.summary ?? record.intent.summary,
      evidence: {
        stopReason: record.stopReason,
        verification: record.verification ?? null,
        riskDecision: record.riskDecision ?? null,
        workItemId: action?.workItemId ?? null,
      },
    };
    await this.workState.appendEvent(next.goalId, event);
  }
}

export function createWorkStateIntegratedGoalLoop(input: {
  goal: Goal;
  planner: Planner;
  contextSources: ContextSource[];
  executor: CapabilityExecutor;
  verifier: Verifier;
  stateStore: StateStore;
  workStateStore: WorkStateStore;
  approvalPolicy?: ApprovalPolicy;
  options?: GoalLoopOptions;
}): GoalDrivenLoop {
  const contextSources = [new WorkStateContextSource(input.workStateStore), ...input.contextSources];
  const executor = new WorkStateGuardedExecutor(input.executor, input.workStateStore, input.goal);
  const store = new WorkStateWriteBackStore(input.stateStore, input.workStateStore);
  return new GoalDrivenLoop(
    input.planner,
    contextSources,
    executor,
    input.verifier,
    store,
    input.approvalPolicy,
    input.options,
  );
}
