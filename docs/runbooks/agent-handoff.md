# Agent Handoff Contract

Every handoff must contain:

TASK_ID
SOURCE_AGENT
TARGET_AGENT
STATUS
OBJECTIVE
SCOPE
FILES_ALLOWED
FILES_FORBIDDEN
ACCEPTANCE_CRITERIA
TESTS_REQUIRED
RESULT
BLOCKERS
NEXT_ACTION

## Standard Compass loop
When Compass MCP is available, the receiving AI employee must reconstruct task context before acting:

1. `get_goal`
2. `get_state`
3. `get_next_action`
4. read the assigned GitHub issue and only the repository context needed for the task
5. plan and act within scope
6. verify the result
7. `write_back` the verified result, blockers, and next action

Use `record_verification` separately when the verification result is useful independently of the task write-back.

A handoff is not complete until the next agent can reconstruct what happened and what comes next from durable sources. Chat history alone is not sufficient.

## Source-of-truth boundary
Compass SQLite is authoritative only for Compass goal/state/history. GitHub issues, PRs, `PROJECT_STATE.md`, and repository documentation remain authoritative for repository governance. Compass must not silently synchronize, replace, or overwrite `PROJECT_STATE.md`.

## Compass-unavailable fallback
If Compass is unavailable, do not block safe repository work solely for that reason unless the assigned issue requires Compass itself. Use the existing GitHub issue/PR and `PROJECT_STATE.md` handoff path, and explicitly record `COMPASS_WRITE_BACK: unavailable` in the task report or PR/issue handoff. Never claim a Compass read or write occurred when it did not.
