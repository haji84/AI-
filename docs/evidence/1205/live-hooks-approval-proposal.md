# Separate approval proposal: live main-push hooks

Status: prepared only, not applied. Task: #1205 / PR #1213 activation. Existing software validation is complete; exact-head remote CI is tracked on the PR.

Two active existing workflows run unrelated live work when #1213 reaches main:
- Broker Refresh updates/restarts the resident Mac Broker.
- One-Tap Enrollment E2E restarts it and creates a fleet enrollment grant.

Proposed exact change: remove only their automatic main-push triggers; retain workflow_dispatch, all steps, permissions and manual tests. No change to CI, scoped Production deployment, Vercel settings, secrets, firewall, worker registrations, or the separately disabled Vercel Sync. Manual invocation is not newly authorized by this change.

Reviewable patch: [live-hooks-manual-only.patch](live-hooks-manual-only.patch). Checked with git apply --check, not applied.

The tradeoff is explicit: these two Mac-side live jobs will no longer run on every matching main push. Normal CI continues. They can be invoked only for a separately scoped operational action. Approval applies to these two trigger changes for this task, not general workflow/governance changes.

After approval: apply exact patch on this task's branch, review/CI, verify that source/trigger diff matches, then re-evaluate main/Production activation under exact task-scope authorization. No physical-facing held PR is merged.
Rollback: restoring automatic triggers is a separate operational decision; do not silently re-enable jobs with live credential/network/enrollment effects.

Rule requiring approval: AGENTS.md Human gate states that workflow changes altering deployment/merge authority/safety enforcement require a separate Human Gate.
