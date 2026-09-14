import type { ApprovalPolicy, Goal, ProposedAction } from "./goal-loop.ts";
import type { RiskDecision } from "./risk-policy.ts";
import {
  isTaskCompletionAuthorizationActive,
  isTaskProductionDeployAuthorizationActive,
  type TaskCompletionAuthorization,
} from "./task-authorization.ts";

const NON_DELEGABLE_HIGH_RISK_REASONS = new Set([
  "secretsOrCredentialsChange",
  "permissionChange",
  "billingOrContractChange",
  "destructiveSchemaChange",
  "destructiveOrHardToRecoverDelete",
  "securityWeakening",
  "majorExternalPublicationChange",
  "highRiskMainMerge",
]);

export interface RiskAuthorizationInput {
  goal: Goal;
  action: ProposedAction;
  riskDecision: RiskDecision;
}

/**
 * Owner task-completion authorization is a scoped delegation, not a blanket bypass.
 * It suppresses repetitive approval for reversible, goal-scoped work while preserving
 * explicit human gates, irreversible operations, sensitive security/credential/billing
 * changes, and all CRITICAL execution blocks enforced by the risk policy.
 */
export class DelegatedApprovalPolicy implements ApprovalPolicy {
  private readonly authorization?: TaskCompletionAuthorization;
  private readonly scopeId?: string;
  private readonly now: () => Date;

  constructor(
    authorization?: TaskCompletionAuthorization,
    scopeId?: string,
    options: { now?: () => Date } = {},
  ) {
    this.authorization = authorization;
    this.scopeId = scopeId;
    this.now = options.now ?? (() => new Date());
  }

  requiresApproval(action: ProposedAction): boolean {
    if (action.requiresHumanApproval) return true;
    if (action.irreversible) return true;
    if (action.risk !== "high") return false;
    return !this.hasActiveDelegation();
  }

  authorizesRisk(input: RiskAuthorizationInput): boolean {
    if (!this.hasActiveDelegation()) return false;
    if (input.riskDecision.executionBlocked) return false;
    if (input.action.requiresHumanApproval || input.action.irreversible) return false;

    const reasons = input.riskDecision.reasons;
    if (reasons.some((reason) => NON_DELEGABLE_HIGH_RISK_REASONS.has(reason))) return false;

    if (reasons.includes("productionDeploy")) {
      return isTaskProductionDeployAuthorizationActive(
        this.authorization,
        this.scopeId,
        this.now(),
      );
    }

    return input.riskDecision.level !== "CRITICAL";
  }

  private hasActiveDelegation(): boolean {
    return isTaskCompletionAuthorizationActive(
      this.authorization,
      this.scopeId,
      this.now(),
    );
  }
}
