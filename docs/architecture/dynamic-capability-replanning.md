# Dynamic Capability Replanning

## Purpose
A task may reveal a capability need after execution has started. That condition is not treated as an automatic failure and is not permission to execute arbitrary tools. It is a bounded replanning signal.

## Decision path
1. Planner proposes an action.
2. Existing risk policy and Human Gate run first.
3. If the action is approved for execution but its capability is outside the active team, the team-scoped executor emits an internal expansion signal before the underlying tool is called.
4. The orchestrator verifies that the capability exists in the current catalog.
5. A necessity evaluator must determine that the capability is genuinely required for the current Goal/DoD. Planner desire alone is insufficient.
6. The expansion budget must still have capacity.
7. Only then is the capability formally added to the active team and the bounded GoalDrivenLoop restarted with the expanded team.
8. The added capability still passes the same current Risk/Approval/Verifier/Retry/Write-back rules. Team membership grants no permission.

## Non-negotiable Human Gates
Dynamic replanning never auto-approves payment/purchase, destructive deletion, permission or credential changes, production deployment/publication, security-policy weakening, or any other action classified by the existing approval policy as requiring a human.

These actions are gated before a team-scope expansion can reach the actual capability executor. A remembered or newly expanded team cannot inherit prior permission.

## Necessity and bounded growth
The default necessity evaluator is conservative and requires evidence in the current Goal, description, success criteria, or constraints that matches the requested registered capability. Higher-level planners may provide an explicit necessity evaluator, but it must return an auditable reason.

Expansion is bounded by `maxCapabilityExpansions` (default 8, maximum 100). Unknown capabilities are never fabricated. Rejected, unavailable, and budget-exhausted requests return visible blockers.

## Organizational learning
If an expanded team reaches verified goal completion, the resulting assignment set is persisted. If the run began from a recalled blueprint, the expanded team is stored as a child generation rather than overwriting its parent evidence. On equal recall evidence, the newer proven generation is preferred. This lets repeated late-discovered needs move into the initial team on later similar tasks.

## Safety invariant
`dynamic team growth != dynamic permission growth`.

The system may recruit a capability when it is truly needed. It may not use that mechanism to skip a Human Gate, weaken governance, create an unavailable capability, or grow without a hard bound.
