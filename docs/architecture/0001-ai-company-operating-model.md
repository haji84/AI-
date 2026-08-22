# ADR 0001: AI Company Operating Model

Status: Accepted for Phase 0

## Decision
Use GitHub as the source of truth. Planning/research agents produce scoped work; coding agents implement on branches; deterministic CI verifies machine-checkable conditions; QA and Reviewer provide separate gates; a human retains authority over merge and protected actions.

## Safety constraints
No autonomous production deployment, destructive migration, secrets/billing changes or main merge in v1.0. Maximum three automated fix attempts per issue. `AI_COMPANY_PAUSED` is the kill switch.

## Rollback
Revert the Phase 0 bootstrap PR and disable scheduled tasks.
