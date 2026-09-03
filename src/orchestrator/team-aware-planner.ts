import type { ActionResult, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import type { ContextItem, Goal } from "./goal-loop.ts";
import { detectLocalOnlyBlocker, selectParallelCloudCandidates } from "./model-planner.ts";
import { buildTeamPlanningBundle } from "./team-planning-context.ts";

export class TeamAwarePlanner implements Planner {
  private readonly delegate: Planner;

  constructor(delegate: Planner) {
    this.delegate = delegate;
  }

  inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent> {
    return this.delegate.inferIntent(input);
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
    previousResult?: ActionResult | null;
  }): Promise<ProposedAction | null> {
    const localBlocker = detectLocalOnlyBlocker(input.context);
    if (!localBlocker) return this.delegate.proposeNextAction(input);

    const selection = selectParallelCloudCandidates(input.context);
    const candidate = selection.candidates[0];
    if (!candidate) return this.delegate.proposeNextAction(input);

    const bundle = await buildTeamPlanningBundle({ issue: candidate });
    if (bundle.execution.stopReason === "approval_required") {
      return {
        id: `team:human-gate:${candidate.number}`,
        description: `Selected Issue #${candidate.number} requires Human Gate before production roles. Signals: ${bundle.team.humanGateSignals.join(", ")}.`,
        capability: "team.human_gate",
        risk: "high",
        irreversible: false,
        externalSideEffect: false,
        requiresHumanApproval: true,
        input: { candidate, team: bundle.team, execution: bundle.execution },
      };
    }

    if (bundle.execution.stopReason !== "completed") {
      return {
        id: `team:blocked:${candidate.number}`,
        description: `Selected Issue #${candidate.number} team execution stopped with ${bundle.execution.stopReason}.`,
        capability: "runtime.local_blocker",
        risk: "low",
        irreversible: false,
        externalSideEffect: false,
        input: { candidate, team: bundle.team, execution: bundle.execution },
      };
    }

    return this.delegate.proposeNextAction({
      ...input,
      context: [...input.context, bundle.context],
    });
  }
}
