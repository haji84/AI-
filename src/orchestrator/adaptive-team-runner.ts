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
}

export interface AdaptiveTeamRunReport {
  teamSource: "recalled" | "assembled";
  blueprintId: string | null;
  teamPlan: CapabilityTeamPlan;
  run: BoundedRunReport | null;
  teamOutcome: TeamOutcome | null;
  memoryUpdated: boolean;
  blockedReason?: string;
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

class TeamScopedExecutor implements CapabilityExecutor {
  private readonly delegate: CapabilityExecutor;
  private readonly allowed: Set<string>;

  constructor(delegate: CapabilityExecutor, capabilities: string[]) {
    this.delegate = delegate;
    this.allowed = new Set(capabilities.map(normalized));
  }

  async execute(action: ProposedAction, context: ContextItem[]) {
    if (!this.allowed.has(normalized(action.capability))) {
      return {
        actionId: action.id,
        ok: false,
        summary: `Capability is not part of the active team: ${action.capability}`,
        blocker: `capability_not_in_active_team:${action.capability}`,
      };
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

export async function runAdaptiveTeamGoal(input: AdaptiveTeamRunInput): Promise<AdaptiveTeamRunReport> {
  const availableNames = input.availableCapabilities.map((capability) => capability.name);
  const recalled = input.memory.recall(input.goal, availableNames);
  const eligibleRecalled = recalled && blueprintSatisfiesRequirements(recalled, input.requirements)
    ? recalled
    : null;

  const teamSource = eligibleRecalled ? "recalled" : "assembled";
  const teamPlan = eligibleRecalled
    ? planFromBlueprint(input.goal, eligibleRecalled)
    : assembleCapabilityTeam({
        goal: input.goal,
        availableCapabilities: input.availableCapabilities,
        requirements: input.requirements,
      });

  if (teamPlan.blocked) {
    return {
      teamSource,
      blueprintId: eligibleRecalled?.id ?? null,
      teamPlan,
      run: null,
      teamOutcome: null,
      memoryUpdated: false,
      blockedReason: `missing_required_capabilities:${teamPlan.missingRequiredCapabilities.map((item) => item.capability).join(",")}`,
    };
  }

  const allowedCapabilities = [...new Set(teamPlan.assignments.map((assignment) => assignment.capability))];
  const scopedExecutor = new TeamScopedExecutor(input.executor, allowedCapabilities);
  const loop = input.createLoop(scopedExecutor);
  const run = await runBoundedGoalLoop(loop, input.goal, input.runOptions);
  const teamOutcome = inferTeamOutcome(run);

  let blueprintId: string | null = eligibleRecalled?.id ?? null;
  let memoryUpdated = false;
  if (teamOutcome) {
    if (eligibleRecalled) {
      input.memory.record(eligibleRecalled.id, teamOutcome);
      blueprintId = eligibleRecalled.id;
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
  };
}
