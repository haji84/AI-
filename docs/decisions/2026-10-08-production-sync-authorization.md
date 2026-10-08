# Fail-closed legacy Production Sync authorization (#1724)

Date: 2026-10-08
Status: Implemented candidate; protected integration and hosted denial evidence pending.
Owner gate: https://github.com/haji84/AI-/issues/1724#issuecomment-6050006934
Parent: #1219. This supersedes the legacy assumption that main push or successful CI alone authorizes production sync.

## Decision

Both legacy production jobs execute an inline authorization step before checkout, dependency actions, local runtime changes, environment sync or deployment. The step runs after runner/environment waiting, so a queued job does not reuse an earlier grant. No checkout-provided script is trusted to authorize that checkout. Existing triggers and production environment protection remain; failed authorization makes the job visibly fail and subsequent steps skip.

Reuse Scoped Production Deploy's existing task contract: exact merged PR and main revision, PR task Issue/production approval/unexpired timestamp metadata, repository-owner-created Issue with its recorded completion instruction and production-deploy-authorized flag. The recognized instruction grammar is unchanged. A new chat approval or success of an old deploy does not satisfy missing machine metadata. Do not rewrite the owner's words to satisfy the parser.

Additionally require current main and the latest matching CI workflow main-push run to be completed successfully for that exact SHA. Reject pending/latest-failed CI even if older evidence was successful. Check current main and expiry again immediately before granting. The workflow_run, push, schedule and manual paths share the same checks. Existing job selection remains: deploy-code only runs for successful main CI events; sync retains all existing entrypoints.

The public GitHub metadata path already used by the PC source verifier is reused without tokens or additional workflow permissions. Metadata denial, network failure, timeout, malformed data or rate limiting fails closed. This trades availability for a bounded change with no token-scope expansion. Private-repository migration would require a separately reviewed capability, never a bypass.

The small inline gate is repeated at each job boundary deliberately, avoiding checkout before authorization or a pre-runner decision that can become stale while waiting. Executable fixtures exercise both copies and the existing Scoped Production Deploy contract. CI, secret provisioning, environment protections, preview behavior, runtime recovery and deployment implementations are unchanged. This gate does not authorize those implementations' separately privileged recovery branches.

## Evidence and limits

The pre-change executable tests failed because neither production job began with authorization. The changed workflow passes controlled successful and denied metadata fixtures across all trigger contexts, with current-main/CI/merged-PR/owner/expiry/lookup-error negatives. These are software tests, not production deployment or device evidence. A normal unscoped merge should now produce explicit authorization rejection before mutation; capture the actual hosted result after protected integration.

## Rollback

Baseline: b059424d4904c74d7ff0068652adcfa6380ddb90. No production state or credential migration is part of this change. Reverting the gate would restore the known #1724 governance defect and is not an approved operational rollback. If a defect appears, keep production mutation blocked and repair the validator under review; retain existing runtime and evidence. Any temporary disabling or authority expansion needs its own Human Gate.