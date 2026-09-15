import { createTaskCompletionAuthorization } from "./task-authorization.ts";
import { evaluateRiskPolicy, type MediumRiskChecks, type RiskSignals } from "./risk-policy.ts";

export interface UnifiedAutonomyGoal {
  command: string;
  goal: string;
  definitionOfDone: string[];
  targetNodeId?: string;
  riskSignals?: RiskSignals;
  mediumRiskChecks?: MediumRiskChecks;
}

export interface UnifiedAutonomyDecision {
  goal: UnifiedAutonomyGoal;
  authorization: ReturnType<typeof createTaskCompletionAuthorization>;
  risk: ReturnType<typeof evaluateRiskPolicy>;
  canProceed: boolean;
  humanApprovalRequired: boolean;
  blocker?: string;
}

export interface JarvisAutonomyAdapter<T = unknown> {
  execute(input: {
    command: string;
    goal: string;
    definitionOfDone: string[];
    targetNodeId?: string;
    authorization?: ReturnType<typeof createTaskCompletionAuthorization>;
  }): Promise<T>;
}

export function buildUnifiedAutonomyDecision(input: UnifiedAutonomyGoal): UnifiedAutonomyDecision {
  const authorization = createTaskCompletionAuthorization(input.command);
  const risk = evaluateRiskPolicy(input.riskSignals ?? {}, input.mediumRiskChecks);

  const delegatedProduction = authorization?.allowProductionDeploy === true;
  const delegatedLowMedium = authorization?.allowLowMediumMainMerge === true;

  const canProceed = risk.level === "LOW"
    || (risk.level === "MEDIUM" && (risk.autoExecutionAllowed || delegatedLowMedium))
    || (risk.level === "HIGH" && delegatedProduction && !risk.executionBlocked);

  return {
    goal: input,
    authorization,
    risk,
    canProceed,
    humanApprovalRequired: !canProceed && risk.humanApprovalRequired,
    ...(risk.executionBlocked ? { blocker: `risk:${risk.level.toLowerCase()}` } : {}),
  };
}

export async function runUnifiedAutonomyPath<T>(
  input: UnifiedAutonomyGoal,
  adapter: JarvisAutonomyAdapter<T>,
): Promise<{ decision: UnifiedAutonomyDecision; result?: T }> {
  const decision = buildUnifiedAutonomyDecision(input);
  if (!decision.canProceed) return { decision };

  const result = await adapter.execute({
    command: input.command,
    goal: input.goal,
    definitionOfDone: input.definitionOfDone,
    targetNodeId: input.targetNodeId,
    authorization: decision.authorization,
  });

  return { decision, result };
}
