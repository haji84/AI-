# AI-09 automatic advisory review: activation and recovery

Issue #1798 and PR #1799. This proposed workflow is NOT active until merged
into the default branch. This runbook is not independent approval or ZBook proof.

## Safety invariants

- A completed CI workflow_run must resolve to the exact open same-repo PR
  head/base. Reject forks, stale SHA, foreign runs, invalid data.
- Preflight and posting use GitHub-hosted workers. The Windows local-model job
  checks out only pinned trusted main source. Never execute PR-head code.
- Local Ollama is fixed at 127.0.0.1:11434. Default model:
  qwen2.5-coder:3b. No remote/paid model fallback.
- Only the hosted poster has issues:write, solely for advisory comments.
  Every receipt is AI_ASSERTED, never GitHub APPROVED or merge authorization.
- The GitHub API patch must have all addition/deletion hunks according to
  GitHub file stats, checked by reviewer and poster. Unavailable, truncated
  or inconsistent patches fail closed.
- Limits: 30 files, 120 KiB entire patch, 16 KiB per chunk, 12 chunks.
  Single oversize files fail closed. Maximum local inference timeout is
  120 seconds per chunk; Windows job timeout is 30 minutes.
- Workflow selector is generic self-hosted Windows X64; to fail closed on
  unexpected machines the FIRST review step compares RUNNER_NAME to repository
  Actions variable GORIQ_AI09_EXPECTED_RUNNER_NAME. Missing/blank/mismatched
  variable or wrong OS/arch blocks BEFORE checkout or Ollama inference.
  This variable is not a secret, token, new credential or runner permission.
  Its value must be obtained from authenticated owner inspection of the
  intended registered ZBook runner. This workflow does NOT set it or change
  labels, machine privileges, ACLs or GitHub permissions.
  A matched name alone still does NOT prove physical ZBook execution:
  GitHub documents that RUNNER_NAME need not be globally unique across runner
  groups. Require RUNNER_ENVIRONMENT=self-hosted as a separate sanity check,
  and cross-check the GitHub job's actual runner identity, runner group and
  native ZBook evidence before treating the physical test as verified.

## Reviewer model and deterministic false-clean backstop

The **proposed** default model for the local review CLI and CI reviewer is
`qwen2.5-coder:3b` (already observed installed on ZBook). Earlier
owner-supplied synthetic tests returned 3/3 expected verdicts for 3B and 0/3
for 1.5B on ordinary arithmetic, obvious command injection and path traversal.
That is a tiny non-blinded sample, NOT a verified vulnerability detection rate
or approval to trust model-proposed code fixes. Model suggestions such as
replacing `exec` with `execSync` are NOT automatically safe.

A narrow static backstop examines **added** patch lines for direct
`console.log(request.headers.authorization)`, direct credential-cookie
logging, and comparable direct console/logger invocations. If every model
chunk claims NO_ACTIONABLE_FINDINGS in the presence of a known pattern, the
result becomes BLOCKED with fixed reason
`deterministic_sensitive_logging_risk`. On the GitHub-hosted posting
boundary, the same check is repeated on the independently reconstructed
GitHub diff before a purported clean advisory can be published. This guard
does not authorize a merge, execute a fix, or replace human/security review.

Limitations: it intentionally avoids inferring executable JavaScript syntax
from string literals or comments and does not detect every wrapped, aliased,
multiline, or transformed credential leak. It is **not** a complete static
analyzer, and safe output cannot establish overall code safety. Existing
INCONCLUSIVE and CHANGES_REQUESTED flow is preserved; risky patches cannot
be self-certified clean. Keep recovery bounded and review each new SHA.

Any source/model-default changes after an exact-head owner authorization
require fresh CI/review and *renewed* scope-bound permission/governance gate
before main integration. Native ZBook PR-to-GitHub-comment E2E and shared
runner isolation are separate outstanding acceptance criteria.

## Public-repository self-hosted runner risk

GitHub's Secure use reference warns that publicly accessible repositories
should almost never use persistent self-hosted runners. A same-repo PR filter
and trusted pinned-main checkout reduce exposure for THIS workflow, but do
not prove the ZBook is isolated from other jobs, users or internal services.
Before activating this workflow, obtain and record owner-side evidence that
the intended registered runner is correctly scoped, its other eligible
workflows and access are controlled, and the host is suitably isolated from
sensitive files/credentials and networks. Prefer dedicated, isolated runner
capacity if it can be arranged through separately authorized changes.
The RUNNER_NAME match alone cannot provide that evidence.

Do NOT modify runner groups, labels, host ACLs, tokens, network access or
repository visibility as part of this read-only review. Missing isolation
evidence is an activation HOLD requiring the applicable separate Human Gate.

## Activation gates

1. Re-read exact main SHA/tree, AGENTS, roadmap, state, Issues #1796/#1798,
   head-specific CI, open comments and required independent reviews.
2. Obtain properly independent authorized security/reviewer sign-off or
   an explicit separately approved documented governance exception.
   The author haji84 cannot self-APPROVE these PRs.
3. Integrate PR #1797 first only if its gate passes. Retarget PR #1799
   to that new main, reconfirm all changed files and fresh CI. Obtain
   workflow/permission-change Human Gate for the current revision.
4. Inspect the authorized registered ZBook runner identity and explicitly
   set repository Actions variable GORIQ_AI09_EXPECTED_RUNNER_NAME to its
   exact verified RUNNER_NAME only under owner-authorized repository settings.
   If this variable is unset, the reviewer will deliberately HOLD.
   Verify Node 24.x, local Ollama and model with read-only checks.
   Do not alter runner labels, credentials, permissions, ACLs, processes
   or networking without authorization.

## Disposable-PR native E2E, not yet completed

1. Create a non-sensitive test PR in the same repo and record base/head SHA.
   Observe CI completion and this exact AI-09 workflow_run event.
2. Record the real runner name, ZBook identity, Node version, Ollama model,
   all model/chunk results, exact patch hash and receipt validation.
3. Observe a PR issue comment with matching SHA, CI run and AI_ASSERTED
   marker; it must deny independent approval and merge authority.
4. Retry the identical head and verify no duplicate comment. Push a new
   commit and verify a new head-scoped advisory comment.
5. Test local-model failure, incomplete API patch and malformed result:
   all must HOLD, not report a clean review.
6. Test a finding and handoff to Builder/Debugger. A GitHub comment alone
   is not a received/acknowledged automatic repair task. Verify task
   receipt and execution only through existing Goal, Task, AllowedPaths,
   bounded-retry, idempotency and Human Gate controls.

Attach CI/run/job IDs, commit SHA, runner/model version, comment URL,
negative cases, handoff receipt and recovery evidence to Issue/PR.

## Failure, recovery and rollback

- On stale PR, timeout, model error, patch mismatch, invalid artifact,
  or failed GitHub write: stop review of the exact head with HOLD and log
  the failed stage and run ID. Do not silently skip a changed file.
- No new credentials/permissions, model services, ACL changes, or process
  stops are authorized by a failed test. Never use a paid fallback.
- New head means new review. Cancelled/stale artifact cannot approve it.
- Authorized rollback requires a reviewed default-branch change, CI
  and explicit verification of workflow events, runner and comment state.
  A Git revert alone is not proof that external state was reversed.

## Bootstrap transition record (2026-10-13 JST)

- PR #1797 was merged with a narrow **owner-authorized one-time exception**
  for the otherwise unavailable separate-account review. Exact merged main:
  `83b1cc9cda738f00bae4f4d2dbe05c46fe6d1b81`. This is NOT
  GitHub APPROVED by an independent account.
- GitHub retargeted stacked PR #1799 to **main** automatically after that
  merge. All old #1799 CI outcomes were for the earlier stacked base; they
  cannot qualify the retargeted PR. A new exact-head/base CI and technical
  review are mandatory before integration.
- The #1797 exception **never** applies to #1799. The workflow trigger
  and hosted `issues:write` permission still require their own separate
  explicit governance Human Gate. This document only prepares testing and
  cannot authorize workflow activation.
- The existing main production-sync workflow is out of scope. Do not
  use a merge or CI event as deployment authorization.


## RACE AI cross-repository pilot (read-only)

- Existing AI-09 employee is reused; CodeRabbit is not a reviewer, approval, or completion source.
- The RACE AI PR #65 \`completion-controller-pilot\` GitHub Action emits a \`race-ai09-review-request\` JSON artifact (\`GORIQ_AI09_ADVISORY_REQUEST_V1\`). Its pilot CI succeeds, but that is **not** AI-09 inference.
- \`scripts/goriq-ai09-race-review.mjs\` receives the extracted request file through \`--manifest <path>\` or explicit \`--pr NUMBER --head SHA --base SHA\`. It accepts only \`haji84/RACE-AI\` and exact live head/base, verifies all three RACE AI checks, bounds the GitHub patch by existing diff limits, invokes the already-installed loopback \`qwen2.5-coder:3b\` model, then rechecks the same PR revision. Nothing from a PR is executed.
- Local readonly manual command, **only after environment isolation and provenance checks**: \`node scripts/goriq-ai09-race-review.mjs --manifest <path-to-extracted-ai09-handoff.json>\`. Or use explicit \`--pr 65 --head <current-full-sha> --base <current-full-sha>\`. Do not reuse outdated SHA values from this runbook. The command fetches public GitHub data; it does not post comments, modify settings, change processes, or trigger Builder/Debugger.
- The emitted JSON is \`AI_ASSERTED\`, with GitHub approval, independent account, physical evidence and merge authorization set false. \`CHANGES_REQUESTED\` carries a proposed Builder/Debugger task identifier, **not an acknowledged or executed task**. Never claim an actual review until the CLI and real model run on an authorized, observed host and the exact output is collected.
- Cross-repository automatic invocation, signed/artifact provenance, verified GitHub comment publication under the target repository's scoped identity and Builder/Debugger task acknowledgement are **NOT yet wired**. No new PAT/OAuth/runner registration or permission scope may be invented. A cross-repository bot comment with an untrusted token or copied output is not acceptable evidence.
- Public repository self-hosted runner isolation remains a hard HOLD for unattended workflow activation. The previous owner exception was bound to an older PR head, and cannot approve the current changed head, workflow_run or issues:write authority. Need fresh review, current-head authorization and physical isolation evidence.

Verification: \`node --test tests/ai09-race-review.test.mjs\`; full CI on exact GORIQ head; separately perform the real isolated model/runner-to-target E2E before activation. These tests simulate the local inference callback and DO NOT verify the native ZBook model.
