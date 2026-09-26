# GORIQ Online/Offline Self-Development Design

Date: 2026-09-26 JST  
Parent Goal: Issue #681  
Implementation master: Issue #882  
Requirements: CORE-014 and AUTO-001 through AUTO-031

## Goal

GORIQ accepts development instructions from the owner's iPhone, ZBook, or
MacBook, converges them on one authoritative Goal, and uses all available
devices to design, implement, test, repair, integrate, release, and verify its
own software. Development continues without Internet connectivity wherever the
required capability is available locally. Online-only publication work is
persisted and resumes after connectivity returns.

The required topology contains one iPhone, one ZBook, and one MacBook. Android
is outside this acceptance scope. This design does not relax any Human Gate.

## Current gap

The repository already contains the Goal Controller, Compass persistence,
bounded Goal execution, device workers, offline queues, recovery components,
Builder routing, deterministic verification, safe PR support, and
self-improvement gates. The production path is incomplete as a self-development
system for four reasons:

1. The development state machine is a small in-memory helper rather than the
   durable Development Job authority.
2. The resident Builder path depends on Codex or Aider and does not prove an
   equivalent local-only route.
3. Repository publication and release capabilities are separate from the
   resident Goal execution path.
4. Offline changes, concurrent device work, conflict integration, and
   post-reconnect re-verification are not composed into one accepted runtime.

## Chosen architecture

GORIQ owns a single development control plane. Models and code engines are
replaceable Builder capabilities; they never own Goal state, gates, or release
authority.

```text
Device intake
  -> Goal Controller
  -> Development Orchestrator
  -> Builder Router
  -> isolated Change Set
  -> Independent Verifier
  -> Integration and Release Gate
  -> Goal Evaluator
  -> durable continuation or completion
```

The common pipeline is used for both external-assisted and fully local work.
Duplicating the whole pipeline for local and external operation is rejected
because it would create divergent state, gate, and verification semantics.

## Device roles

### ZBook

- Runs resident long-duration work, Windows verification, GPU/local-model
  inference, repository indexing, and development services.
- Can receive owner instructions and persist them while disconnected.
- Hosts local Builder and Verifier capabilities when they are available.

### MacBook

- Runs macOS and iOS builds, repository work, simulator checks, local-model
  inference, and development services.
- Can receive owner instructions and persist them while disconnected.
- Coordinates the physical iPhone toolchain where iOS requires a Mac host.

### One iPhone

- Is an OS-managed Worker, not an unrestricted resident daemon or compiler.
- Can submit instructions, display Goal state, handle Human Gates, and request
  pause or rollback.
- Executes supported foreground/background/deferred work, physical app launch,
  Keychain/authentication/network checks, sensor work, and iPhone E2E.
- Stores bounded offline intake, task state, and evidence and synchronizes
  signed results after reconnect.

The router selects devices by capability and current World Model facts, never by
hard-coded preference alone. An unavailable iPhone yields an explicit physical
evidence wait; code or simulator success cannot impersonate physical evidence.

## Unified intake and authority

Every device uses the same normalized intake contract. The Goal Resolver
deduplicates requests against active Goal identity and success criteria. A
device disconnected from the current authority records the request in a local
durable inbox with source identity, causal parent, idempotency key, and local
time evidence. It may start only work that is safe and independent under the
last verified Goal snapshot.

Goal creation, Goal mutation, Development Job transitions, completion, and
release remain State Controller decisions. Builders, device Workers, and model
outputs propose actions and return evidence; they cannot commit authority
transitions themselves.

## Durable Development Job

Each Development Job records:

- Goal and requirement linkage;
- acceptance criteria and definition of done;
- risk, approval scope, non-goals, and affected surfaces;
- base revision and Baseline Snapshot;
- plan, Work Items, dependencies, and device/capability requirements;
- Builder selection, attempt identity, strategy identity, and resource budget;
- isolated Change Sets and their reversibility;
- test, security, visual, runtime, and physical-device evidence requirements;
- failure signatures, hypotheses, diagnoses, and rejected strategies;
- integration, PR, merge, deployment, Production verification, and rollback
  state;
- append-only transitions and the next safe action.

The existing `self-development-loop.ts` contract is retained as a compatibility
facade while the durable job state becomes authoritative.

## Builder and planning capability

The Development Orchestrator decomposes the Goal into the smallest useful Work
Items. Before editing, it builds local repository context from symbols,
dependencies, tests, history, requirement traceability, device availability,
and prior failure evidence.

Builder Router candidates share one bounded contract:

1. deterministic transformations and repository tools;
2. local model/code engine on ZBook or MacBook;
3. already-authorized external Builder such as Codex.

Normal routing may race or sequence eligible Builders using historical verified
quality, latency, availability, privacy, and zero-incremental-cost policy. A
fully local route is mandatory acceptance, not merely a fallback declaration.
No Builder may commit, push, merge, deploy, change credentials or permissions,
or weaken tests and governance.

Test-driven development is the default implementation strategy. A Work Item
starts with a failing acceptance test when technically applicable, implements
the smallest change, then runs focused and affected regression checks.

## Online and offline execution

Each device keeps encrypted local state for the Goal snapshot, assigned Work
Items, Change Sets, attempts, failure signatures, evidence manifests, and sync
cursor. Local code, model, dependency, and test caches required for the accepted
offline profile are prepared while online and are versioned.

While devices can communicate, one write lease protects each Work Item. Work is
distributed across different Work Items and capabilities. Before disconnect,
an assigned offline Work Item is bound to an immutable base revision and a
device-owned Change Set.

While disconnected:

- already assigned local-capable work continues;
- new intake is durably recorded;
- independent new work may start against the last verified Goal snapshot;
- online-required actions enter `WAITING_FOR_CONNECTIVITY` without failing the
  Goal;
- no device claims global Goal completion, merge, or deployment.

GitHub push, PR, merge, remote CI, and Production deployment require online
connectivity. Completed offline work remains `READY_TO_PUBLISH` and resumes
from the same Goal and Job after reconnect.

## Automatic synchronization and conflict integration

Synchronization compares Goal ID, causal parent, Work Item, base revision,
affected symbols/files, Change Set digest, and evidence digest. Non-conflicting
events and changes merge automatically.

For a conflict, GORIQ performs autonomous semantic integration before asking
for Human Assistance:

1. reconstruct both intents and acceptance criteria;
2. classify textual, structural, behavioral, requirement, and authority
   conflicts;
3. generate bounded integration candidates using AST-aware transforms,
   targeted regeneration, Work Item decomposition, or clean reimplementation;
4. reject candidates that lose either accepted requirement or cross a gate;
5. run focused tests followed by affected unit, integration, security, build,
   visual, and device checks;
6. select only a fully verified candidate and record both source Change Sets in
   its provenance.

Failed candidates produce failure signatures and cannot be repeated without a
changed hypothesis or new evidence. If all safe strategies are exhausted, the
system preserves every Change Set and stops visibly. Automatic integration
cannot bypass a Human Gate or silently choose between contradictory Goal
changes.

## Verification and recovery

The final Verifier is independent of the selected Builder. Verification is
derived from the affected surfaces and may include lint, type checks, unit,
integration, security, build, browser/visual QA, Windows, macOS, and physical
iPhone E2E. `INCONCLUSIVE` never passes.

On failure, the Orchestrator records the evidence and root-cause status, then
selects a materially different repair, diagnostic experiment, decomposition,
Builder, architecture, or rollback strategy. Restart and device loss resume
from durable state. A fixed retry count does not abandon the Goal; bounded
resource and stagnation guards force replanning.

## Publication and release

After independent verification, the Integration and Release Gate owns staging,
commit, push, PR, protected-branch auto-merge, main CI, exact-artifact
deployment, post-deployment verification, and Goal re-evaluation.

LOW/MEDIUM changes inside active task-scoped completion authorization may
continue automatically through these stages. Required checks, branch freshness,
mergeability, review threads, artifact identity, and authorization expiry must
be machine verified. Builders never receive GitHub or Production authority.

Secrets/credentials, permission or token-scope changes, billing/contracts,
destructive or hard-to-recover changes, security/governance weakening,
protection/audit disabling, and safety-control relaxation remain separate
non-bypassable Human Gates.

## Self-improvement

Verified outcomes update routing and recovery evidence. Repeatedly successful
patterns may become candidate Skills or model/routing improvements only through
sandbox evaluation, held-out regression, relevant device E2E, canary,
monitoring, and known-good rollback. One successful attempt cannot become an
authoritative rule.

## Acceptance

Completion requires machine and physical evidence for all applicable cases:

1. Instructions from iPhone, ZBook, and MacBook converge on one deduplicated
   Goal and start the durable development path.
2. Online execution completes a representative self-change from requirement
   through design, TDD implementation, independent verification, protected PR
   merge, main CI, exact Production deployment, and post-deployment verification.
3. With external Builders disabled, a local Builder completes a representative
   design, implementation, repair, and verification task.
4. With GitHub and inter-device connectivity disabled, assigned development
   continues and persists an independently verifiable Change Set.
5. Reconnect automatically integrates a deliberately conflicting Change Set,
   reruns all affected checks, and preserves provenance.
6. Process termination and device restart resume the same Goal, Job, attempt
   history, and next safe action without duplicate effects.
7. One physical iPhone proves instruction intake, deferred work, device E2E,
   signed result submission, offline retention, and reconnect sync.
8. Missing evidence, stale artifacts, secrets in output, or required Human Gate
   conditions fail closed.
9. A failed canary or regression restores the known-good version and re-verifies
   the restored runtime.

Passing component tests alone is insufficient. Each acceptance record names the
exact revision, artifact, environment, device identity class, and timestamp.

## Rollout

The existing Issue #1218 recovery work remains isolated in PR #1255 and is
completed for the one-iPhone topology before this implementation is published.
Self-development work uses a separate branch and PR under #681/#882.

Implementation proceeds in reversible slices:

1. durable Development Job and compatibility facade;
2. unified external/local Builder contract and local acceptance;
3. offline Change Sets and reconnect synchronization;
4. semantic automatic conflict integration;
5. Integration and Release Gate composition;
6. three-device and failure/restart acceptance;
7. monitored Production rollout and post-deployment verification.

Every slice preserves the previous known-good path until its own verification
and rollback evidence pass.
