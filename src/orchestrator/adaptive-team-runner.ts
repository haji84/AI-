import type {
  CapabilityExecutor,
  ContextItem,
  Goal,
  GoalDrivenLoop,
  ProposedAction,
} from "./goal-loop.ts";
import {
  assembleCapabilityTeam,
  type CapabilityDescriptor,
  type CapabilityRequirement,
  type CapabilityTeamPlan,
} from "./dynamic-capability-team.ts";
import {
  createTeamBlueprint,
  deriveTeamBlueprint,
  type TeamBlueprint,
  type TeamMemory,
  type TeamOutcome,
} from "./team-organizational-memory.ts";
import {
  runBoundedGoalLoop,
  type BoundedRunOptions,
  type BoundedRunReport,
} from "./bounded-runner.ts";

export interface TeamMemoryPersistence {
  persist(memory: TeamMemory): Promise<void>;
}

export interface CapabilityExpansionDecision {
  necessary: boolean;
  reason: string;
}

export interface CapabilityExpansionRecord {
  capability: string;
  actionId: string;
  actionDescription: string;
  accepted: boolean;
  reason: string;
}

export interface CapabilityExpansionContext {
  goal: Goal;
  action: ProposedAction;
  descriptor: CapabilityDescriptor;
  activeTeam: CapabilityTeamPlan;
  expansionCount: number;
}

export interface AdaptiveTeamRunInput {
  goal: Goal;
  availableCapabilities: CapabilityDescriptor[];
  requirements?: CapabilityRequirement[];
  memory: TeamMemory;
  persistence?: TeamMemoryPersistence;
  executor: CapabilityExecutor;
  createLoop(executor: CapabilityExecutor): GoalDrivenLoop;
  runOptions?: BoundedRunOptions;
  createBlueprintId?: (goal: Goal) => string;
  createBlueprintName?: (goal: Goal) => string;
  maxCapabilityExpansions?: number;
  evaluateExpansionNecessity?: (
    context: CapabilityExpansionContext,
  ) => CapabilityExpansionDecision | Promise<CapabilityExpansionDecision>;
}

export interface AdaptiveTeamRunReport {
  teamSource: "recalled" | "assembled";
  blueprintId: string | null;
  teamPlan: CapabilityTeamPlan;
  run: BoundedRunReport | null;
  teamOutcome: TeamOutcome | null;
  memoryUpdated: boolean;
  expansions: CapabilityExpansionRecord[];
  blockedReason?: string;
}

class CapabilityExpansionNeeded extends Error {
  readonly action: ProposedAction;

  constructor(action: ProposedAction) {
    super(`capability expansion needed:${action.capability}`);
    this.name = "CapabilityExpansionNeeded";
    this.action = action;
  }
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function blueprintSatisfiesRequirements(
  blueprint: TeamBlueprint,
  requirements: CapabilityRequirement[] = [],
): boolean {
  const capabilities = new Set(blueprint.assignments.map((assignment) => normalized(assignment.capability)));
  return requirements
    .filter((requirement) => requirement.required !== false)
    .every((requirement) => capabilities.has(normalized(requirement.capability)));
}

function planFromBlueprint(goal: Goal, blueprint: TeamBlueprint): CapabilityTeamPlan {
  return {
    goalTitle: goal.title,
    assignments: blueprint.assignments.map((assignment) => ({ ...assignment })),
    missingRequiredCapabilities: [],
    blocked: false,
  };
}

function defaultBlueprintId(goal: Goal): string {
  const slug = goal.title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `team:${slug || "goal"}:${Date.now()}`;
}

function defaultExpansionNecessity(context: CapabilityExpansionContext): CapabilityExpansionDecision {
  const goalText = [
    context.goal.title,
    context.goal.description ?? "",
    ...context.goal.successCriteria,
    ...context.goal.constraints,
  ].join(" ").toLowerCase();
  const evidenceTerms = [
    context.descriptor.name,
    ...context.descriptor.roles,
    ...(context.descriptor.matchTerms ?? []),
  ].map(normalized).filter((term) => term.length >= 2);
  const matched = evidenceTerms.find((term) => goalText.includes(term));
  if (matched) {
    return { necessary: true, reason: `goal evidence matched:${matched}` };
  }
  return {
    necessary: false,
    reason: "planner requested capability but current Goal/DoD contains no supporting necessity evidence",
  };
}

class TeamScopedExecutor implements CapabilityExecutor {
  private readonly delegate: CapabilityExecutor;
  private readonly allowed: Set<string>;

  constructor(delegate: CapabilityExecutor, capabilities: string[]) {
    this.delegate = delegate;
    this.allowed = new Set(capabilities.map(normalized));
  }

  async execute(action: ProposedAction, context: ContextItem[]) {
    if (!this.allowed.has(normalized(action.capability))) {
      throw new CapabilityExpansionNeeded(action);
    }
    return this.delegate.execute(action, context);
  }
}

function inferTeamOutcome(run: BoundedRunReport): TeamOutcome | null {
  const executed = run.cycles.filter((cycle) => cycle.result !== undefined && cycle.result !== null);
  if (executed.length === 0) return null;

  const executionFailure = executed.find((cycle) => cycle.result?.ok === false || cycle.verification?.ok === false);
  if (executionFailure) {
    return {
      ok: false,
      verified: false,
      score: 0,
      summary: executionFailure.verification?.summary ?? executionFailure.result?.summary ?? "team execution failed",
    };
  }

  if (run.stopReason === "goal_complete") {
    const verified = [...executed].reverse().find((cycle) => cycle.verification?.ok === true);
    if (verified) {
      return {
        ok: true,
        verified: true,
        score: 1,
        summary: verified.verification?.summary ?? verified.result?.summary ?? "goal completed and verified",
      };
    }
  }

  return null;
}

function expandedPlan(
  current: CapabilityTeamPlan,
  descriptor: CapabilityDescriptor,
  action: ProposedAction,
  reason: string,
): CapabilityTeamPlan {
  if (current.assignments.some((assignment) => normalized(assignment.capability) === normalized(descriptor.name))) {
    return current;
  }
  return {
    ...current,
    assignments: [
      ...current.assignments,
      {
        role: descriptor.roles[0] ?? `dynamic:${descriptor.name}`,
        capability: descriptor.name,
        reason: `runtime expansion for ${action.description}: ${reason}`,
        source: "goal-match",
      },
    ],
  };
}

export async function runAdaptiveTeamGoal(input: AdaptiveTeamRunInput): Promise<AdaptiveTeamRunReport> {
  const maxCapabilityExpansions = input.maxCapabilityExpansions ?? 8;
  if (!Number.isInteger(maxCapabilityExpansions) || maxCapabilityExpansions < 0 || maxCapabilityExpansions > 100) {
    throw new Error("maxCapabilityExpansions must be an integer from 0 to 100");
  }

  const availableNames = input.availableCapabilities.map((capability) => capability.name);
  const recalled = input.memory.recall(input.goal, availableNames);
  const eligibleRecalled = recalled && blueprintSatisfiesRequirements(recalled, input.requirements)
    ? recalled
    : null;

  const teamSource = eligibleRecalled ? "recalled" : "assembled";
  let teamPlan = eligibleRecalled
    ? planFromBlueprint(input.goal, eligibleRecalled)
    : assembleCapabilityTeam({
        goal: input.goal,
        availableCapabilities: input.availableCapabilities,
        requirements: input.requirements,
      });
  const expansions: CapabilityExpansionRecord[] = [];

  if (teamPlan.blocked) {
    return {
      teamSource,
      blueprintId: eligibleRecalled?.id ?? null,
      teamPlan,
      run: null,
      teamOutcome: null,
      memoryUpdated: false,
      expansions,
      blockedReason: `missing_required_capabilities:${teamPlan.missingRequiredCapabilities.map((item) => item.capability).join(",")}`,
    };
  }

  let run: BoundedRunReport | null = null;
  while (true) {
    const allowedCapabilities = [...new Set(teamPlan.assignments.map((assignment) => assignment.capability))];
    const scopedExecutor = new TeamScopedExecutor(input.executor, allowedCapabilities);
    const loop = input.createLoop(scopedExecutor);
    try {
      run = await runBoundedGoalLoop(loop, input.goal, input.runOptions);
      break;
    } catch (cause) {
      if (!(cause instanceof CapabilityExpansionNeeded)) throw cause;
      const requested = cause.action.capability;
      const descriptor = input.availableCapabilities.find(
        (capability) => normalized(capability.name) === normalized(requested),
      );
      if (!descriptor) {
        expansions.push({
          capability: requested,
          actionId: cause.action.id,
          actionDescription: cause.action.description,
          accepted: false,
          reason: "capability is not registered in the current catalog",
        });
        return {
          teamSource,
          blueprintId: eligibleRecalled?.id ?? null,
          teamPlan,
          run: null,
          teamOutcome: null,
          memoryUpdated: false,
          expansions,
          blockedReason: `capability_not_registered:${requested}`,
        };
      }

      if (expansions.filter((record) => record.accepted).length >= maxCapabilityExpansions) {
        expansions.push({
          capability: requested,
          actionId: cause.action.id,
          actionDescription: cause.action.description,
          accepted: false,
          reason: "capability expansion budget exhausted",
        });
        return {
          teamSource,
          blueprintId: eligibleRecalled?.id ?? null,
          teamPlan,
          run: null,
          teamOutcome: null,
          memoryUpdated: false,
          expansions,
          blockedReason: `capability_expansion_budget_exhausted:${requested}`,
        };
      }

      const decision = await (input.evaluateExpansionNecessity ?? defaultExpansionNecessity)({
        goal: input.goal,
        action: cause.action,
        descriptor,
        activeTeam: teamPlan,
        expansionCount: expansions.filter((record) => record.accepted).length,
      });
      if (!decision.necessary) {
        expansions.push({
          capability: requested,
          actionId: cause.action.id,
          actionDescription: cause.action.description,
          accepted: false,
          reason: decision.reason,
        });
        return {
          teamSource,
          blueprintId: eligibleRecalled?.id ?? null,
          teamPlan,
          run: null,
          teamOutcome: null,
          memoryUpdated: false,
          expansions,
          blockedReason: `capability_expansion_not_necessary:${requested}`,
        };
      }

      teamPlan = expandedPlan(teamPlan, descriptor, cause.action, decision.reason);
      expansions.push({
        capability: requested,
        actionId: cause.action.id,
        actionDescription: cause.action.description,
        accepted: true,
        reason: decision.reason,
      });
    }
  }

  const teamOutcome = inferTeamOutcome(run);
  let blueprintId: string | null = eligibleRecalled?.id ?? null;
  let memoryUpdated = false;
  if (teamOutcome) {
    const expanded = expansions.some((record) => record.accepted);
    if (eligibleRecalled && !expanded) {
      input.memory.record(eligibleRecalled.id, teamOutcome);
      blueprintId = eligibleRecalled.id;
    } else if (eligibleRecalled && expanded) {
      const derived = deriveTeamBlueprint({
        parent: eligibleRecalled,
        id: input.createBlueprintId?.(input.goal) ?? defaultBlueprintId(input.goal),
        name: input.createBlueprintName?.(input.goal) ?? `${input.goal.title} expanded team`,
        goal: input.goal,
        replaceAssignments: teamPlan.assignments,
      });
      input.memory.save(derived);
      input.memory.record(derived.id, teamOutcome);
      blueprintId = derived.id;
    } else {
      const blueprint = createTeamBlueprint({
        id: input.createBlueprintId?.(input.goal) ?? defaultBlueprintId(input.goal),
        name: input.createBlueprintName?.(input.goal) ?? `${input.goal.title} team`,
        goal: input.goal,
        team: teamPlan,
      });
      input.memory.save(blueprint);
      input.memory.record(blueprint.id, teamOutcome);
      blueprintId = blueprint.id;
    }
    await input.persistence?.persist(input.memory);
    memoryUpdated = true;
  }

  return {
    teamSource,
    blueprintId,
    teamPlan,
    run,
    teamOutcome,
    memoryUpdated,
    expansions,
  };
}
