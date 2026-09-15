import type { CapabilityExecutor, Goal, GoalDrivenLoop } from "./goal-loop.ts";
import {
  runAdaptiveTeamGoal,
  type AdaptiveTeamRunReport,
  type CapabilityExpansionDecision,
  type CapabilityExpansionContext,
  type TeamMemoryPersistence,
} from "./adaptive-team-runner.ts";
import type { CapabilityDescriptor, CapabilityRequirement } from "./dynamic-capability-team.ts";
import type { TeamMemory } from "./team-organizational-memory.ts";
import type { BoundedRunOptions } from "./bounded-runner.ts";

export interface DynamicAgentRole {
  role: string;
  capability: string;
}

export interface DynamicMultiAgentRunInput {
  goal: Goal;
  availableCapabilities: CapabilityDescriptor[];
  requirements?: CapabilityRequirement[];
  memory: TeamMemory;
  persistence?: TeamMemoryPersistence;
  executor: CapabilityExecutor;
  createLoop(executor: CapabilityExecutor): GoalDrivenLoop;
  runOptions?: BoundedRunOptions;
  maxAgents?: number;
  maxMidTaskRecruitments?: number;
  evaluateRecruitmentNecessity?: (
    context: CapabilityExpansionContext,
  ) => CapabilityExpansionDecision | Promise<CapabilityExpansionDecision>;
}

export interface DynamicMultiAgentRunReport extends AdaptiveTeamRunReport {
  agents: DynamicAgentRole[];
}

/**
 * Execution-grade one-front-door multi-agent facade.
 *
 * Agents are logical task-scoped roles backed by registered capabilities. The
 * facade deliberately delegates risk, Human Gate, verification, retry and
 * write-back semantics to the existing GoalDrivenLoop instead of creating a
 * second governance path. Mid-task recruitment is bounded and can only use
 * capabilities already present in the supplied catalog.
 */
export async function runDynamicMultiAgentGoal(
  input: DynamicMultiAgentRunInput,
): Promise<DynamicMultiAgentRunReport> {
  const maxAgents = input.maxAgents ?? 3;
  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > 32) {
    throw new Error("maxAgents must be an integer from 1 to 32");
  }

  const report = await runAdaptiveTeamGoal({
    goal: input.goal,
    availableCapabilities: input.availableCapabilities,
    requirements: input.requirements,
    memory: input.memory,
    persistence: input.persistence,
    executor: input.executor,
    createLoop: input.createLoop,
    runOptions: input.runOptions,
    maxCapabilityExpansions: input.maxMidTaskRecruitments ?? Math.max(0, maxAgents - 1),
    evaluateExpansionNecessity: input.evaluateRecruitmentNecessity,
  });

  const agents = report.teamPlan.assignments.map(({ role, capability }) => ({ role, capability }));
  const uniqueCapabilities = new Set(agents.map((agent) => agent.capability.trim().toLowerCase()));
  if (uniqueCapabilities.size > maxAgents) {
    return {
      ...report,
      run: null,
      teamOutcome: null,
      memoryUpdated: false,
      agents,
      blockedReason: `dynamic_agent_budget_exhausted:${uniqueCapabilities.size}>${maxAgents}`,
    };
  }

  return { ...report, agents };
}
