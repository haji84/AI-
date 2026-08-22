# Phase 0 Governance DRY RUN

## Purpose

This non-executable document is the scoped change for Issue #2. It validates the Phase 0 operating loop without starting Phase 1 or changing application behavior.

## Safety state

- `AI_COMPANY_PAUSED` remains present and set to `PAUSED`.
- No application code, workflow, runbook or existing project-state file is changed.
- Scheduled Automation and the Codex PR Fixer do not make changes during this DRY RUN.

## Workflow under validation

Issue -> dedicated branch -> minimal governance change -> CI -> QA -> Review -> pull request -> Human Gate

Automation must stop after the required checks, QA and Review pass. Only a human may decide whether to merge the pull request into `main`.

## Rollback

Before merge, close the pull request without merging. After merge, revert the DRY RUN commit; do not rewrite history.
