# GORIQ Online/Offline Self-Development Implementation Plan

> **For implementation:** Execute this plan task by task with
> `superpowers:test-driven-development`. Before claiming completion or publishing
> evidence, use `superpowers:verification-before-completion`.

**Goal:** Compose the existing Goal, worker, offline, sync, Builder, verifier,
and release components into one durable GORIQ self-development runtime that can
accept instructions from one iPhone, one ZBook, or one MacBook and continue
development both online and offline.

**Architecture:** One authoritative `DevelopmentOrchestrator` owns durable jobs
and state transitions. Replaceable local and external Builders produce isolated
Change Sets. Independent verifiers, semantic conflict integration, and a
separate release gate advance the same job through reconnect, PR, merge,
deployment, and post-deployment verification. Existing Goal Controller,
Compass, Worker Runtime, Sync Engine, task authorization, and Human Gates remain
authoritative.

**Tech stack:** TypeScript 6, Node.js 24 test runner, Compass SQLite adapters,
JSON atomic stores for device-local state, existing GAI Worker Runtime, Git,
GitHub API capability, macOS/iOS toolchain, Windows PowerShell services.

**Design:** `docs/superpowers/specs/2026-09-26-goriq-offline-self-development-design.md`

## Task 1: Define the durable Development Job contract

**Files:**

- Create: `src/orchestrator/development-job.ts`
- Create: `src/orchestrator/development-job-store.ts`
- Test: `tests/development-job.test.ts`
- Test: `tests/development-job-store.test.ts`

### Step 1: Write failing contract tests

Cover:

- a job requires Goal linkage, DoD, base revision, approval scope, and at least
  one Work Item;
- only the State Controller can apply legal transitions;
- transitions are append-only and idempotent by transition ID;
- success without required evidence becomes `BLOCKED`, never `COMPLETED`;
- `WAITING_FOR_CONNECTIVITY`, `READY_TO_PUBLISH`, `HUMAN_GATE`, `RECOVERING`,
  `VERIFYING`, and `COMPLETED` are distinct states;
- failure signatures and rejected strategy IDs survive reconstruction;
- JSON persistence uses atomic replacement and detects corrupt versions.

Run:

```bash
node --test tests/development-job.test.ts tests/development-job-store.test.ts
```

Expected: FAIL because the new modules do not exist.

### Step 2: Implement the minimal contract and store

Use explicit discriminated transition inputs. Keep model/Builder output outside
the transition authority. Store no secret values. Use a versioned snapshot and
atomic temp-file rename, following `durable-task-runtime.ts`.

### Step 3: Run focused tests and commit

```bash
node --test tests/development-job.test.ts tests/development-job-store.test.ts
git add src/orchestrator/development-job.ts src/orchestrator/development-job-store.ts tests/development-job.test.ts tests/development-job-store.test.ts
git commit -m "feat(goriq): add durable development jobs"
```

## Task 2: Convert the self-development loop into a compatibility facade

**Files:**

- Modify: `src/orchestrator/self-development-loop.ts`
- Modify: `tests/self-development-loop.test.ts`
- Test: `tests/self-development-compatibility.test.ts`

### Step 1: Add failing compatibility tests

Prove that the legacy `createDevelopmentState` and `nextDevelopmentState`
surface maps to durable job transitions, preserves existing callers, never uses
a fixed failure count to abandon the Goal, and records each legacy attempt with
a stable failure signature.

```bash
node --test tests/self-development-loop.test.ts tests/self-development-compatibility.test.ts
```

Expected: FAIL on durable mapping and progress-aware recovery.

### Step 2: Implement the facade

Keep legacy exports but delegate state progression to pure transition helpers
from `development-job.ts`. Strategy exhaustion enters replanning or a truthful
stop reason; it does not convert Goal failure into success.

### Step 3: Verify and commit

```bash
node --test tests/self-development-loop.test.ts tests/self-development-compatibility.test.ts
git add src/orchestrator/self-development-loop.ts tests/self-development-loop.test.ts tests/self-development-compatibility.test.ts
git commit -m "refactor(goriq): persist self-development state"
```

## Task 3: Introduce one bounded Builder contract for local and external work

**Files:**

- Create: `src/orchestrator/development-builder.ts`
- Create: `src/orchestrator/local-development-builder.ts`
- Modify: `src/orchestrator/runtime-builder-capability.ts`
- Modify: `src/orchestrator/builder-router.ts`
- Modify: `scripts/code-builder-worker-service.ts`
- Test: `tests/development-builder.test.ts`
- Test: `tests/local-development-builder.test.ts`
- Modify: `tests/runtime-builder-capability.test.ts`

### Step 1: Write failing routing and authority tests

Prove that:

- local and external candidates accept the same request and return the same
  Change Set envelope;
- a Builder response cannot contain commit, push, merge, deploy, permission, or
  credential authority;
- `localOnly: true` excludes external candidates;
- external failure selects an available local candidate without losing attempt
  identity;
- a materially equivalent failed strategy is rejected unless its hypothesis or
  evidence changed;
- changed paths must remain inside the isolated workspace and declared scope.

```bash
node --test tests/development-builder.test.ts tests/local-development-builder.test.ts tests/runtime-builder-capability.test.ts
```

Expected: FAIL because the shared Change Set contract and local-only route do
not exist.

### Step 2: Implement the contract and local adapter

The local adapter invokes an explicitly configured local command/model over
loopback or a direct child process, with no shell interpolation, bounded input,
timeout, workspace containment, and captured patch metadata. Extend the worker
service response to return a Change Set digest and affected paths without
exposing credentials or full sensitive logs.

### Step 3: Verify and commit

```bash
node --test tests/development-builder.test.ts tests/local-development-builder.test.ts tests/runtime-builder-capability.test.ts tests/http-worker-builder-capability.test.ts tests/code-builder-codex-exec-contract.test.ts
git add src/orchestrator/development-builder.ts src/orchestrator/local-development-builder.ts src/orchestrator/runtime-builder-capability.ts src/orchestrator/builder-router.ts scripts/code-builder-worker-service.ts tests/development-builder.test.ts tests/local-development-builder.test.ts tests/runtime-builder-capability.test.ts
git commit -m "feat(goriq): unify local and external builders"
```

## Task 4: Add local repository intelligence and plan decomposition

**Files:**

- Create: `src/orchestrator/repository-development-context.ts`
- Create: `src/orchestrator/development-orchestrator.ts`
- Modify: `src/orchestrator/runtime-development-planner.ts`
- Test: `tests/repository-development-context.test.ts`
- Test: `tests/development-orchestrator.test.ts`
- Modify: `tests/runtime-development-planner.test.ts`

### Step 1: Write failing planning tests

Test symbol/file/test/requirement mapping, bounded context selection, Work Item
dependencies, required device capabilities, TDD-first steps, rollback fields,
and different strategy selection after a recorded failure signature. Ensure
repository content cannot grant authority through prompt text.

```bash
node --test tests/repository-development-context.test.ts tests/development-orchestrator.test.ts tests/runtime-development-planner.test.ts
```

Expected: FAIL on structured Work Item decomposition and local context.

### Step 2: Implement the smallest deterministic index and orchestrator

Use repository paths, imports, requirement references, and test references.
Persist only digests and bounded summaries required by the next action. The
planner may use a model to rank host-created candidates but cannot invent
capabilities, risk, approval, or completion.

### Step 3: Verify and commit

```bash
node --test tests/repository-development-context.test.ts tests/development-orchestrator.test.ts tests/runtime-development-planner.test.ts
git add src/orchestrator/repository-development-context.ts src/orchestrator/development-orchestrator.ts src/orchestrator/runtime-development-planner.ts tests/repository-development-context.test.ts tests/development-orchestrator.test.ts tests/runtime-development-planner.test.ts
git commit -m "feat(goriq): plan development from repository evidence"
```

## Task 5: Persist offline Change Sets and publication waits

**Files:**

- Create: `src/orchestrator/development-change-set.ts`
- Create: `src/orchestrator/development-change-set-store.ts`
- Modify: `src/gai/offline-first-runtime.ts`
- Modify: `src/gai/durable-task-runtime.ts`
- Test: `tests/development-change-set.test.ts`
- Test: `tests/development-offline-runtime.test.ts`
- Modify: `tests/gai-offline-first-runtime.test.ts`

### Step 1: Write failing offline tests

Cover immutable base revision, device ownership, affected paths/symbols,
content/patch digest, evidence digest, rollback metadata, `READY_TO_PUBLISH`,
restart recovery, and secret-pattern rejection. Simulate GitHub offline while a
local Builder and local Verifier complete a Change Set.

```bash
node --test tests/development-change-set.test.ts tests/development-offline-runtime.test.ts tests/gai-offline-first-runtime.test.ts
```

Expected: FAIL because development Change Sets are not a durable offline entity.

### Step 2: Implement Change Set persistence and connectivity behavior

Reuse atomic versioned stores. Network-required publication waits must not
consume a repair attempt or fail the parent Goal. On reconnect, resume the exact
job and Change Set rather than regenerating work.

### Step 3: Verify and commit

```bash
node --test tests/development-change-set.test.ts tests/development-offline-runtime.test.ts tests/gai-offline-first-runtime.test.ts tests/gai-durable-task-runtime.test.ts
git add src/orchestrator/development-change-set.ts src/orchestrator/development-change-set-store.ts src/gai/offline-first-runtime.ts src/gai/durable-task-runtime.ts tests/development-change-set.test.ts tests/development-offline-runtime.test.ts tests/gai-offline-first-runtime.test.ts
git commit -m "feat(goriq): persist offline development changes"
```

## Task 6: Implement autonomous semantic conflict integration

**Files:**

- Create: `src/orchestrator/development-conflict-integrator.ts`
- Modify: `src/gai/sync-engine.ts`
- Test: `tests/development-conflict-integrator.test.ts`
- Modify: `tests/gai-sync-engine.test.ts`

### Step 1: Write failing conflict tests

Use fixtures for:

- independent file changes that merge directly;
- two AST-level changes to the same TypeScript function that can be integrated;
- contradictory Goal changes that must remain unresolved;
- a generated candidate that drops one acceptance criterion and is rejected;
- the first candidate failing tests and a materially different candidate
  passing;
- provenance retaining both source Change Set digests and new verifier evidence.

```bash
node --test tests/development-conflict-integrator.test.ts tests/gai-sync-engine.test.ts
```

Expected: FAIL because critical conflicts currently stop at `conflicted`.

### Step 2: Implement a pluggable integration strategy

`SyncEngine` remains the causal detector. It delegates development Change Set
conflicts to a bounded integrator that can use deterministic merge, AST-aware
merge, or Builder-generated candidates. Every candidate is applied in an
isolated workspace and must pass the supplied verifier contract. Authority and
Goal conflicts never auto-resolve.

### Step 3: Verify and commit

```bash
node --test tests/development-conflict-integrator.test.ts tests/gai-sync-engine.test.ts
git add src/orchestrator/development-conflict-integrator.ts src/gai/sync-engine.ts tests/development-conflict-integrator.test.ts tests/gai-sync-engine.test.ts
git commit -m "feat(goriq): verify automatic change integration"
```

## Task 7: Unify device intake and three-device development routing

**Files:**

- Create: `src/orchestrator/device-development-intake.ts`
- Modify: `src/orchestrator/goal-controller-runtime.ts`
- Modify: `src/gai/worker-runtime.ts`
- Modify: `src/gai/initial-worker-profiles.ts`
- Modify: `src/gai/iphone-worker-bridge.ts`
- Test: `tests/device-development-intake.test.ts`
- Test: `tests/goriq-three-device-development.test.ts`
- Modify: `src/gai/iphone-worker-bridge.test.ts`

### Step 1: Write failing device tests

Prove instruction intake from ZBook, MacBook, and exactly one iPhone; stable
idempotency across devices; offline inbox persistence; capability-based routing;
signed iPhone result binding; and explicit physical evidence wait when the
iPhone is unavailable. Ensure iPhone is never selected for unrestricted daemon
or compile work.

```bash
node --test tests/device-development-intake.test.ts tests/goriq-three-device-development.test.ts src/gai/iphone-worker-bridge.test.ts
```

Expected: FAIL on unified offline intake and development-specific routing.

### Step 2: Implement intake envelopes and routing constraints

Add causal parent, Goal snapshot digest, device identity, idempotency key, and
offline-received marker. Reuse Goal Resolver for authority. Extend the iPhone
bridge only with bounded deferred intake/result persistence; preserve signed
task/result checks and one-device acceptance.

### Step 3: Verify and commit

```bash
node --test tests/device-development-intake.test.ts tests/goriq-three-device-development.test.ts src/gai/iphone-worker-bridge.test.ts tests/gai-multi-worker-runtime.test.ts tests/goal-controller-runtime.test.ts
git add src/orchestrator/device-development-intake.ts src/orchestrator/goal-controller-runtime.ts src/gai/worker-runtime.ts src/gai/initial-worker-profiles.ts src/gai/iphone-worker-bridge.ts tests/device-development-intake.test.ts tests/goriq-three-device-development.test.ts src/gai/iphone-worker-bridge.test.ts
git commit -m "feat(goriq): route development across owner devices"
```

## Task 8: Compose independent verification and release gating

**Files:**

- Create: `src/orchestrator/development-verification-plan.ts`
- Create: `src/orchestrator/development-release-gate.ts`
- Modify: `src/orchestrator/runtime-development-verifier.ts`
- Modify: `src/orchestrator/safe-pr-capability.ts`
- Test: `tests/development-verification-plan.test.ts`
- Test: `tests/development-release-gate.test.ts`
- Modify: `tests/runtime-development-verifier.test.ts`
- Modify: `tests/task-auto-merge-connection.test.ts`

### Step 1: Write failing gate tests

Cover affected-surface check selection, Builder/Verifier separation, stale
evidence invalidation, exact revision/artifact binding, task authorization
expiry, protected auto-merge eligibility, `READY_TO_PUBLISH` offline behavior,
main-CI requirement, post-deployment verification, and every non-bypassable
Human Gate.

```bash
node --test tests/development-verification-plan.test.ts tests/development-release-gate.test.ts tests/runtime-development-verifier.test.ts tests/task-auto-merge-connection.test.ts tests/human-gate-shortcuts.test.ts
```

Expected: FAIL because the resident development path has no composed release
gate.

### Step 2: Implement orchestration without widening permissions

Reuse `task-authorization.ts`, `auto-merge-policy.ts`, and the existing GitHub
capability. Do not change workflow permissions, branch protection, credentials,
or Production configuration. The gate emits explicit requests for existing
authorized capabilities and verifies returned evidence.

### Step 3: Verify and commit

```bash
node --test tests/development-verification-plan.test.ts tests/development-release-gate.test.ts tests/runtime-development-verifier.test.ts tests/task-auto-merge-connection.test.ts tests/human-gate-shortcuts.test.ts tests/task-authorization.test.ts
git add src/orchestrator/development-verification-plan.ts src/orchestrator/development-release-gate.ts src/orchestrator/runtime-development-verifier.ts src/orchestrator/safe-pr-capability.ts tests/development-verification-plan.test.ts tests/development-release-gate.test.ts tests/runtime-development-verifier.test.ts tests/task-auto-merge-connection.test.ts
git commit -m "feat(goriq): gate verified development releases"
```

## Task 9: Connect the durable orchestrator to the resident Goal path

**Files:**

- Modify: `src/orchestrator/compass-goal-execution-adapter.ts`
- Modify: `src/orchestrator/goal-controller-execution-bridge.ts`
- Modify: `scripts/jarvis-goal-executor.ts`
- Modify: `scripts/jarvis-broker.ts`
- Test: `tests/goriq-self-development-runtime.test.ts`
- Modify: `tests/goal-controller-execution-bridge.test.ts`
- Modify: `tests/goriq-direct-goal-bridge-resume.test.ts`

### Step 1: Write failing full-path tests

Exercise authenticated intake → Goal decision → durable Development Job → local
or external Builder → independent verifier → publication wait or release gate →
Goal evaluation. Kill and reconstruct the executor between stages and assert no
duplicate build, Change Set, or release effect.

```bash
node --test tests/goriq-self-development-runtime.test.ts tests/goal-controller-execution-bridge.test.ts tests/goriq-direct-goal-bridge-resume.test.ts
```

Expected: FAIL because the resident Goal adapter still calls the old Builder
path directly.

### Step 2: Compose the orchestrator behind an explicit host option

Preserve existing callers. Enable the new path for development Goals only after
store initialization and contract validation. Resume nonterminal jobs on broker
startup and connectivity recovery. Persist safe, bounded event summaries.

### Step 3: Verify and commit

```bash
node --test tests/goriq-self-development-runtime.test.ts tests/goal-controller-execution-bridge.test.ts tests/goriq-direct-goal-bridge-resume.test.ts tests/goriq-direct-goal-bridge.test.mjs
git add src/orchestrator/compass-goal-execution-adapter.ts src/orchestrator/goal-controller-execution-bridge.ts scripts/jarvis-goal-executor.ts scripts/jarvis-broker.ts tests/goriq-self-development-runtime.test.ts tests/goal-controller-execution-bridge.test.ts tests/goriq-direct-goal-bridge-resume.test.ts
git commit -m "feat(goriq): run durable self-development goals"
```

## Task 10: Add local-only, offline, reconnect, and rollback acceptance

**Files:**

- Create: `tests/goriq-self-development-acceptance.test.ts`
- Create: `scripts/goriq-self-development-acceptance.mjs`
- Create: `docs/evidence/681-self-development-acceptance.md`
- Modify: `docs/JARVIS_REQUIREMENT_STATUS.md`
- Modify: `docs/jarvis-reverse-traceability.json`

### Step 1: Add failing acceptance scenarios

The deterministic suite must simulate all five modes:

1. online external-assisted;
2. online local-only;
3. disconnected local development ending `READY_TO_PUBLISH`;
4. reconnect with a deliberate source conflict and verified automatic
   integration;
5. restart plus failed canary and verified known-good rollback.

Also prove one-iPhone topology and explicit physical-evidence separation.

```bash
node --test tests/goriq-self-development-acceptance.test.ts
```

Expected: FAIL until the complete composition exists.

### Step 2: Implement the acceptance runner and evidence schema

The script must record exact revision, artifact/Change Set digests, environment,
device identity class, timestamps, check results, and secret-scan outcome. It
must distinguish deterministic simulation, real local model, real GitHub, and
physical iPhone evidence.

Only status fields with current evidence may be changed. Do not mark CORE-014
or AUTO requirements COMPLETE from simulated evidence alone.

### Step 3: Run focused acceptance and commit

```bash
node --test tests/goriq-self-development-acceptance.test.ts
node scripts/goriq-self-development-acceptance.mjs --mode=deterministic
git add tests/goriq-self-development-acceptance.test.ts scripts/goriq-self-development-acceptance.mjs docs/evidence/681-self-development-acceptance.md docs/JARVIS_REQUIREMENT_STATUS.md docs/jarvis-reverse-traceability.json
git commit -m "test(goriq): prove self-development recovery modes"
```

## Task 11: Run repository-wide verification

### Step 1: Run focused suites together

```bash
node --test \
  tests/development-job.test.ts \
  tests/development-job-store.test.ts \
  tests/self-development-compatibility.test.ts \
  tests/development-builder.test.ts \
  tests/local-development-builder.test.ts \
  tests/development-orchestrator.test.ts \
  tests/development-offline-runtime.test.ts \
  tests/development-conflict-integrator.test.ts \
  tests/device-development-intake.test.ts \
  tests/goriq-three-device-development.test.ts \
  tests/development-release-gate.test.ts \
  tests/goriq-self-development-runtime.test.ts \
  tests/goriq-self-development-acceptance.test.ts
```

Expected: PASS.

### Step 2: Run full required checks

```bash
pnpm lint
pnpm test
pnpm test:p8-security
pnpm build
git diff --check origin/main...HEAD
```

Expected: all exit 0. Record exact command results and revision.

### Step 3: Perform secret and scope review

```bash
git diff --name-only origin/main...HEAD
git diff --stat origin/main...HEAD
```

Confirm no secrets, credential values, permission widening, workflow permission
changes, destructive migrations, or unrelated files. Commit only a truthful
evidence/status correction if verification changed the recorded facts.

## Task 12: Real device and release acceptance

This task uses existing configured capabilities and must stop at any separate
Human Gate. Do not create credentials, widen permissions, or change billing.

### Step 1: Rebase safely on current main and rerun verification

Fetch the protected base, preserve the approved Change Sets, resolve any
conflict through the verified integrator, and rerun Task 11. Never force-push an
unreviewed divergent branch.

### Step 2: Run real local-only acceptance

On ZBook or MacBook, disable external Builders explicitly and run a bounded
representative repository change in an isolated disposable workspace. Require
local Builder output, independent local verification, restart resume, and a
`READY_TO_PUBLISH` result while network publication is disabled.

### Step 3: Run three-device acceptance

- Submit or resume the same Goal from ZBook and MacBook and verify deduplication.
- From the single physical iPhone, submit a bounded instruction, retain it
  offline, reconnect, execute supported deferred/device E2E work, and return a
  signed result.
- Verify no second iPhone is required or reported.
- Record real device/toolchain evidence separately from deterministic tests.

### Step 4: Publish and let repository protections decide merge

Push the exact verified branch, create the #681/#882-linked PR, attach
machine-readable task authorization for this exact task, and enable repository
native auto-merge only if the release gate says eligible. Wait for all required
checks and review threads. Do not bypass or weaken protection.

### Step 5: Verify main and Production

After merge, require successful main CI for the exact merge commit. Use the
existing authorized deployment path without changing Production configuration.
Verify deployed artifact identity, broker health, Goal resume, local-only
Builder health, one-iPhone signed round trip, and rollback readiness. Mark the
Goal achieved only when all required evidence is present.

### Step 6: Write back final state

Update the Issue/PR, `PROJECT_STATE.md`, requirement status, traceability, and
evidence with exact revisions and unresolved limitations. If Compass is
available, record verification and write-back there; otherwise state that the
Compass write-back capability was unavailable.
