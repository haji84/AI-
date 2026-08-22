# Codex PR Fixer Runbook

## Purpose
Provide a bounded automation loop for fixing CI failures or actionable review feedback on existing pull requests.

## Default state
DISABLED while `AI_COMPANY_PAUSED` exists.

## Trigger
Run only when an open pull request has at least one of:
- failing required CI/check
- `CHANGES_REQUESTED`
- actionable unresolved review feedback

Do not run for a healthy PR that is only waiting for human approval.

## Preconditions
Before any modification:
1. Read `AGENTS.md`.
2. Read `PROJECT_STATE.md`.
3. Confirm whether `AI_COMPANY_PAUSED` exists.
4. Identify the target PR and its head branch.
5. Confirm the branch is not `main`.
6. Read the relevant Issue/acceptance criteria when available.
7. Inspect CI/review evidence and reproduce the failure where practical.

If `AI_COMPANY_PAUSED` exists, stop with `PAUSED` and make no code or git changes.

## Allowed actions
When unpaused and the trigger is valid:
- fetch the latest remote state
- checkout the existing PR head branch
- inspect logs, diffs and review comments
- reproduce the failure
- apply the smallest authorized fix
- run the failed check plus relevant regression checks
- commit only files required for the fix
- push normally to the existing PR branch

## Forbidden actions
- direct commit or push to `main`
- force push
- rebase or history rewrite
- merge or auto-merge
- production deploy
- destructive database changes
- database migration execution
- Secrets or credential changes
- billing or paid-service changes
- unrelated refactoring
- file/folder renames unless explicitly authorized
- weakening, deleting or bypassing tests to obtain a pass
- changing public API/data formats outside the authorized scope

## Fix loop
Maximum automatic fix attempts per failure: `3`.

Each attempt must follow:
1. Reproduce or verify the failure.
2. Identify a concrete root-cause hypothesis supported by evidence.
3. Make the minimum scoped change.
4. Run the failed check and relevant regression checks.
5. Inspect `git diff` and verify no unrelated changes.
6. If checks pass, commit and push to the existing PR branch.
7. Re-check CI/review state.

After 3 unsuccessful attempts, stop and return `BLOCKED`. Do not start a fourth attempt automatically.

## Human Gate
Stop and request human approval when any of the following is required:
- merge to `main`
- production deploy
- destructive DB change or migration execution
- Secrets/credentials/permissions change
- billing or new paid external service
- data deletion
- breaking API or persistent data-format change
- requirement is unclear or conflicting
- fix requires work outside the authorized Issue/PR scope

## Output
Return:
- `STATUS`: PASS / FIXED / PAUSED / BLOCKED / HUMAN_APPROVAL_REQUIRED
- `PR`
- `BRANCH`
- `FAILURE_EVIDENCE`
- `ROOT_CAUSE`
- `ATTEMPT_COUNT`
- `CHANGED_FILES`
- `TESTS_RUN`
- `TEST_RESULTS`
- `COMMIT_SHA`
- `PUSH_RESULT`
- `REMAINING_ISSUES`
- `NEXT_ACTION`

## Success condition
The automation is successful only when the original CI/review failure is resolved, required checks pass, no unrelated changes were introduced, and the PR remains unmerged for human review.
