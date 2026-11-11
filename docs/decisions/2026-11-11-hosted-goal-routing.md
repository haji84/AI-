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

## 2026-11-11 integration update in the same PR

The selected production code path is the existing
`jarvis-goal-executor -> CompassGoalExecutionAdapter -> ResidentDevelopmentGoalHost`.
`HostedGoalControllerAdapter` remains a source/fixture contract; it is not installed
as a second production authority. The normal, sequence and tracked-repair factory
branches all receive the same host-owned admission dependency.

The executor retains the existing OS-backed Compass writer for the entire bounded
continuation and WorkRun writeback. The adapter can acquire that writer itself for
direct callers. Its non-serializable live capability binds the Goal and authority
path, expires on release and cannot be supplied as Goal/context JSON. A competing
executor leaves the active WorkRun unchanged. This is **one local filesystem**;
copying a database, cache or artifact between Actions runs does not create shared
ownership or consensus.

Explicit hosted execution requires an already provisioned signed execution
profile, plus these trusted host settings:

| Setting | Required value and binding |
| --- | --- |
| `GORIQ_EXECUTION_HOST_MODE` | `hosted`; invalid explicit modes fail closed |
| `GORIQ_EXECUTION_HOST_ID` | Actual configured execution node ID |
| `GORIQ_HOSTED_ROUTING_FILE` | Absolute host-owned file outside runtime/candidate workspaces |
| `GORIQ_HOSTED_ROUTING_SHA256` | SHA256 of those exact configuration bytes |

The configuration has exactly `version`, `authorityPath`, `goalId`, `goalDigest`, `taskScopeId`,
`executionContractDigest`, `expiresAt`, `hostId`, `privacy`, and `nodes`.
Version is 1. The authority path pins the existing Compass database and its writer
lock, must match the executor path, and must be outside candidate workspaces.
Goal ID/digest and task scope must match the accepted existing Goal
and Job. The execution contract digest references the existing validated sequence
or tracked-repair manifest; this file cannot define a new Goal, Job, criterion,
Builder, verifier or approval. Nodes use the existing `FabricNode` schema.

Admission reloads and checks the pin, expiry and scope at stage boundaries. The
hosted node must satisfy the actual Job's capabilities, public privacy, LOW risk,
LOCAL evidence mode and zero incremental cost. A resumed in-flight Job keeps its
real phase and requires the live canonical writer and the same current-host
eligibility rules. Missing capability uses the existing durable bounded resource
wait. HIGH/CRITICAL remains a Human Gate. Missing/invalid explicit configuration
does not fall back to a different runtime or coding provider.

The host checks canonical stop/Goal state before and after awaited stages. The
local Ollama and tracked-repair Builders also check immediately before candidate
writes. Generic external HTTP workers do not gain this local write guarantee.
No workflow schedule, token, signer key, remote state service or device service is
provisioned by these changes. The complete Issue #1219 runtime acceptance remains
open, including actual-model repair acceptance and off-run authority continuity.

## Bounded tracked-source repair continuation

The tracked-source profile now accepts an optional host-pinned
`recoveryAttempts: [{workspace, receiptFile}]` list (one to eight additional
attempts). Every listed workspace must be a distinct pre-provisioned detached
worktree at the original pinned base. All attempts retain the same Goal, Job,
model, source slots, frozen probe, verifier public key, scope and expiry.
The existing recovery policy can stop earlier than this capacity ceiling.
Omitting the list preserves the one-attempt contract; a failure does not grant
new inference capacity. Re-pinning the manifest cannot reuse an old Job because
the full execution-contract digest remains part of its existing identity.

The canonical controller's complete independent FAIL is required before selecting
an additional attempt. The factory checks its rejected Change Set, exact failure
transition, persisted attempt and archived signature. Consumed failure receipts
are checked at their recorded consumption time; current host authority and
manifest expiry are still checked at current time. Missing, incomplete, forged,
stale or unrelated evidence is not permission to infer again.
Additional recognized signed checks do not change required-check completeness;
the receipt archive follows the canonical controller's same required-check gate.

Each attempt has separate immutable intent, response, prepared data, candidate
identity, verifier request and receipt. Failed worktrees remain untouched. A
prepared attempt resumes without inference; an intent without prepared output
cannot silently reissue inference. A repeated failed candidate is rejected by
the existing controller. The Broker watches the exact predeclared receipt paths.
All candidate workspaces also reach the production executor's hosted authority
path checks.

This is an extension of the existing source factory, not production activation.
The legacy fixed Actions checkpoint format cannot preserve all failed attempts
and therefore refuses manifests with `recoveryAttempts`; broadening a filename
allowlist would not establish cross-run ownership or complete retention.
The Python sequence profile remains a fixed fixture. Actual model provenance,
shared off-run authority, independently controlled production signing, hosted
continuation and released artifact readback still require real acceptance.
