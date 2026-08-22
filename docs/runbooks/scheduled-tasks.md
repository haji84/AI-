# Scheduled Task Runbook

## Governor Check
Cadence: hourly.
Read PROJECT_STATE, open PRs, CI, open issues and blockers. Do not implement. Select the next safe action. If `AI_COMPANY_PAUSED` exists, return PAUSED and perform no implementation.

## PR Babysitter
Cadence: hourly.
Inspect open PRs for CI failures, review comments, merge conflicts and requested changes. Route fixable failures to Debugger. Stop on destructive changes. Mark ready work for human review.

## Codex PR Fixer
Cadence: condition-based or periodic polling.
Use `docs/runbooks/codex-pr-fixer.md` as the mandatory execution contract. Run only for failing CI or actionable review feedback on an existing PR. Never merge. Stop immediately while `AI_COMPANY_PAUSED` exists. Maximum automatic fix attempts: 3.

## Nightly QA
Cadence: nightly.
Run or inspect deterministic repository checks. Create/route a failure issue when checks fail. Do not silently repair unrelated code.

## Morning Report
Cadence: daily.
Report last 24h: completed work, PRs, test status, failures, blockers, approvals required and next work.

## Research Watch
Cadence: weekly.
Check only material changes to critical AI/media providers and core dependencies. Produce research findings, not automatic migrations.
