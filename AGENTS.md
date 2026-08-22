# AI Software Company Rules

Before modifying anything, read in order:
1. `PROJECT_STATE.md`
2. `ROADMAP.md`
3. the assigned GitHub issue
4. relevant files under `docs/architecture/` and `docs/decisions/`

## Mandatory workflow
- Investigate current behavior before editing.
- Identify affected and related files.
- State a minimal change plan.
- Use one issue per branch and normally one PR per issue.
- Run the required checks after editing.
- Report changed files, changes, verification commands, unresolved items, and rollback notes.

## Prohibited without explicit human approval
- direct commits to `main`
- file or folder renames
- unrelated refactoring
- database schema changes or migration execution
- breaking public API changes
- secrets or permission changes
- production deployment
- paid service activation
- data deletion
- weakening or disabling tests to obtain a pass
- hiding errors
- adding features outside the issue

If requirements or scope are unclear, stop and mark the task BLOCKED.

## Human gate
A human must approve: merge to main, production deployment, destructive database operations, secrets, permissions, billing, external publication, destructive changes, and unresolved license/security risk.

## Retry limit
Maximum automatic fix attempts per issue: 3. After that, mark BLOCKED and return to Governor.
