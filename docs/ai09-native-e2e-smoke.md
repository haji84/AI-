# AI-09 native integration smoke fixture

This disposable, non-sensitive documentation-only change exercises the genuine
GitHub pull_request CI -> default-branch workflow_run -> GitHub-hosted AI-09
read-only review -> GitHub Actions bot advisory comment path.

Acceptance checks:
- CI links this PR's exact head and base SHA.
- The model receives only the bounded public patch and emits AI_ASSERTED advice.
- The hosted comment job validates the exact revision, CI and patch receipt.
- Repeating the same head never creates duplicate comments.
- A changed head requires a new advisory, not reuse of a stale review.
- No code, credentials, deployment configuration or protections are changed.

The PR is for verification only. Do not merge this fixture into main.

Native retest after scoped safe-poster diagnostics merge: main 5060c2b0e8fcbf72e59bb95823c4ebebaff598d5.

PR write permission verification (comment job only), main dbb433773d86c250bcb341566f7903e4fecbf89a. This is a disposable PR E2E fixture.
