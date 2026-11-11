# 2026-11-11: Host-independent Goal Job routing (source-only proposal)

Status: **Proposed; not deployed or authorized to bypass any existing gate**
Issue: #1219. Supersedes no credential, production, or permission decision.

## Problem

The GORIQ goal is independent of a permanently running ZBook. GitHub-hosted CI,
read-only repository control and AI-09 advisory review exist, while Windows-only,
local-model, and device evidence requires an actual healthy owner node. A failed
or disconnected ZBook must not block unrelated, independently eligible hosted
work. Conversely a green hosted test must never count as physical evidence.

Existing `Mobile Autonomy` executes a bounded explicit command on manual/dispatch
inputs. Its six-hour **schedule is status-only**; no automatic thinking or coding
is enabled merely because the workflow runs. The existing `Research Control
Plane` reports hosted-vs-worker routes hourly, but that is not the same as a
durable Goal Controller Job receipt.

## Source-only decision

- Reuse the existing `routeFabricJob` policy and add a per-**Job**, not per-Goal,
  pure `routeDurableGoalJobs` candidate selector.
- Consume already-known Goal ID, Job ID, queued phase, dependencies, independent
  verification result, existing Human Gate and verified node capability catalog.
  Never create new Goal/Job IDs or fabricate a healthy worker.
- A public, low-risk, zero-incremental-cost Job with an explicitly matching
  GitHub-hosted capability is a `RUN_HOSTED` **candidate**, not evidence that
  any command started or finished. No automatic PR merge, deploy, or release.
- The local-only Job remains `WAITING_FOR_CAPABILITY` when its owner worker is
  offline; independent public hosted work may remain routable. Successors
  remain `WAITING_FOR_DEPENDENCY` until their actual predecessor is both
  COMPLETED and independently verified; existing RUNNING/VERIFYING/PAUSED
  states are not duplicated or overridden.
- High/critical and explicitly Human-Gated jobs remain `HUMAN_REQUIRED`.
  Private/sensitive work is never routed through a generic public GitHub host.
  Unknown models/capabilities, network readiness, or payment permissions are
  not inferred from source code or from the presence of an agent file.
- Routing is **read-only**. The existing Goal Controller, CapabilityRegistry,
  durable WorkState/lease/fencing, Verifier and Human Gate remain authoritative.

## Validation and next integration gate

Test identical offline/online capability catalog variants, independent hosted
Jobs, verified dependency ordering, duplicate and invalid goal/worker IDs,
privacy/risk/cost refusal, in-flight deduplication, and boundedness.

The *next* implementation gate is wiring this candidate policy into the
existing durable Goal Controller's real Job enqueue/dispatch decision. That
requires a trusted GitHub-hosted executor receipt, persisted owner identity
and proven exact-Goal resume; this pure function alone does **not** satisfy
Issue #1219 E2E. No workflow schedule, token, privilege, repository setting,
main deployment or resident ZBook/Mac process is changed by this proposal.

## Reversibility

Remove the new source module, tests, and this proposed decision if rejected;
existing Issue #1219, PR #1905, runtime state, CI and protected main remain
unchanged. No database migration or task credential changes are involved.
