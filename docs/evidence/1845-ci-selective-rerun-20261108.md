# Issue #1845: Read-only CI failure triage and selective retry (2026-11-08)

## Scope and authority

This is a subtask of the **existing** [Issue #1845](https://github.com/haji84/AI-/issues/1845), not a new Goal or Issue. The parent #681/#1219 Goals and required security, independent verifier, protected branch, native evidence and Human Gates remain unchanged.

The `scripts/goriq-ci-retry-triage.mjs` helper is read-only, uses Node built-ins, accepts only previously fetched GitHub metadata, and **never calls GitHub API, runs tests, requests models, changes files or starts a retry**. The helper does not alter `.github/workflows/ci.yml`, production/deployment workflow triggers, runner permissions, or the existing ZBook recovery worker.

### What the existing GitHub feature does

GitHub supports `Re-run failed jobs` and `gh run rerun RUN_ID --failed`, which rerun failed jobs and their dependent jobs on **the original commit SHA and ref**. Thus:

- **No code change, credible transient failure:** after current PR head and scope checks, inspect the logs and *manually* rerun only failed jobs on that run.
- **Code changed to fix deterministic failure:** create a new commit; run the normal CI on the new SHA. Previous successful checks on an older SHA **cannot certify the new code**. Run targeted tests locally to avoid expensive speculative CI loops; preserve all required full CI/security/physical acceptance.
- **Unknown, high-risk, stale SHA, cancelled, timeout or repeated deterministic failure:** diagnose, do not automatically retry. Never erase unsuccessful results, fabricate success or use old SHA as new HEAD proof.

Official GitHub reference: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

## Verified example: failing PR #1905

Read-only observations from `haji84/AI-` on 2026-11-08:

- Target: [CI run 42458502182](https://github.com/haji84/AI-/actions/runs/42458502182), PR [#1905](https://github.com/haji84/AI-/pull/1905); source SHA `cfe69a91da20058511083fdd66070ac0bc23bab4`.
- `project-checks`: success; `repository-guard`: success.
- `windows-runtime-byte-fixtures`: failure in *Owner credential plan-only and temporary encrypted fixtures*. Detailed log listed **seven failed tests**, including descriptor EOF/peer containment and original-state Job cleanup contracts.
- `independent-verifier-container`: failure at *Real restricted-container six-check verification*; the verifier returned `FAILED` and `physicalAcceptanceVerified=false`. The exact internal root cause has **not** been established by this triage.
- These failures are **not proven transient**. Do **not** rerun this old SHA blindly. The PR itself concerns Owner credential/recovery cutover; any source fix must follow its own scope/Human Gates and a new SHA's full required checks.

The job log names and outcomes support the failure classification, not the cause. A runner success on another SHA or an old merged PR does not close this failure.

## Repeatable, Codex-free triage (read-only)

From a trusted machine with an existing authorized GitHub CLI login, use a temporary folder and an exact `RUN_ID`/PR number:

```bash
RUN_ID=42458502182
PR=1905
TMP="$(mktemp -d)"
gh api "repos/haji84/AI-/actions/runs/$RUN_ID" > "$TMP/run.json"
gh api "repos/haji84/AI-/actions/runs/$RUN_ID/jobs?per_page=100" > "$TMP/jobs.json"
gh api "repos/haji84/AI-/pulls/$PR" > "$TMP/pr.json"
node scripts/goriq-ci-retry-triage.mjs "$TMP/run.json" "$TMP/jobs.json" "$TMP/pr.json"
```

The helper rejects partial job lists, wrong or closed PRs, mismatched HEAD/branch, non-PR triggers, incomplete job state and exhausted retry budget. It prints only a **manual candidate** command for a completed failed PR CI whose SHA still equals the current PR head. Review the failure logs and classify transient vs deterministic *before* invoking the command.

If a genuinely transient failure is verified on the same head, GitHub's native command is:

```bash
gh run rerun 42458502182 --failed -R haji84/AI-
```

**This command is illustrative, not approved or executed for #1905.** For a selected individual failed job, use `gh run rerun --job JOB_ID -R haji84/AI-` only after comparable identity/permission review. New-SHA CI must still run every required check.

## Acceptance and residual gates

- Local synthetic tests for `inspectCiRetry`: **8 PASS** using Node built-in test runner on 2026-11-08; these are not a current-main CI result.
- Await protected PR exact-head CI, review and owner-authorized integration of this helper. No automated rerun, workflow permission, trigger, deployment, credential, ZBook process or billing change is proposed.
- No claim of measured Codex/Work token savings yet. The helper prevents *recommendation* of unsafe stale-code retries; actual reduction requires observing repeat job runs and successful new-head CI.
- Existing Issue #1845 remains open; no ZBook resource-leak root cause or long-run freeze prevention has been proved.
