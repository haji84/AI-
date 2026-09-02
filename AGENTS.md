# AI Software Company Rules

Before modifying anything, read in order:
1. `PROJECT_STATE.md`
2. `ROADMAP.md`
3. the assigned GitHub issue
4. relevant files under `docs/architecture/` and `docs/decisions/`

## Goal-driven operating loop
For every non-trivial task, operate as a bounded loop instead of a one-shot chat response:
1. read the explicit goal and success criteria
2. read current project state and the current next action
3. collect only the context required for that action from available capabilities
4. infer likely user intent from explicit goals, constraints, preferences, and recent decisions; attach confidence and evidence and never claim mind-reading
5. propose the smallest next action that advances the goal
6. classify risk before execution
7. execute low-risk reversible work when policy permits
8. verify the result
9. write back completed work, blockers, verification, and next action
10. repeat only when the runtime explicitly schedules another cycle

Stop immediately when the goal is complete, the project is paused, a blocker exists, retry budget is exhausted, or Human Gate approval is required. Never create a silent infinite loop.

Available connectors and tools are capabilities, not assumptions. GitHub, conversation files, web research, mail, calendar, local runtimes, or other providers may be used only when actually available and relevant to the goal. Missing capability must be reported, never fabricated.

## Compass handoff protocol
When the Compass MCP is available, every AI employee must use it as the persistent task handoff layer.

Before work:
1. call `get_goal`
2. call `get_state`
3. call `get_next_action`
4. retrieve only the additional repository context required for the current issue
5. plan the minimum approved change

After work that changes task state:
1. verify the result
2. call `record_verification` when a standalone verification record is useful
3. call `write_back` with status, summary, completed work, blockers, verification, and next action
4. confirm the resulting state/history when continuity depends on it

Do not treat chat history as persistent project state. Compass SQLite is the source of truth only for Compass goal/state/history. `PROJECT_STATE.md` remains the repository governance source and must never be silently overwritten or synchronized by Compass.

If Compass is unavailable, continue using the repository-governed workflow below, record the handoff in the issue/PR and `PROJECT_STATE.md` where required, and explicitly report that Compass write-back was unavailable. Compass availability must not be fabricated.

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
