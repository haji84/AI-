# GORIQ Resident Authority Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. This assignment forbids additional agents, commits and remote writes; those instructions override generic skill handoff/commit steps.

**Goal:** Make the existing Broker-selected executor, GoalController execution bridge and Resident host consume one explicitly selected authority, while preserving default Compass behavior and refusing incomplete shared imports.

**Architecture:** Inject an authority/storage adapter into the existing Resident execution branch, not a second Goal controller. The Compass adapter retains the existing local lock and SQLite transaction semantics. The GitHub adapter projects a required authenticated import and append-only updates from the existing encrypted, claim-fenced checkpoint root; every shared read, mutation, Job and Change Set uses that root.

**Tech Stack:** TypeScript, Node 24.22.1 in this workspace (repository floor >=24.19.0 <25), existing Node test runner, existing SQLite Compass, GitHubCoordinatorStore encryption/archive/CAS and existing CoordinatorClaim.

**Spec:** Existing Issue #1219 owner completion plan (comment 6857508059); 2026-11-15 canonical handoff (comment 6886977769, parent-verified local copy `/workspace/scratch/d10f272cafc1/goriq-work/current_issue_handoff.md`); `docs/handoffs/GORIQ_CURRENT_HANDOFF.md`; `docs/decisions/2026-11-11-hosted-goal-routing.md`.

## Global Constraints

- Original Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37` remain HOLD; fixtures never stand in for recovered original state.
- No new Goal, bootstrap/import endpoint, coordinator election, protocol gateway, key, credential, permission, state branch, scheduler, provider, billing or production activation.
- Existing GoalControllerExecutionBridge and ResidentDevelopmentGoalHost remain the execution/state-machine owners.
- Preserve pause, cancellation, canonical requirements, blockers, Human Gates, approval expiry, resource and continuation budgets, signature binding, failed candidates and rejected strategies.
- Shared selection is trusted code dependency injection; no model/context JSON or arbitrary module path may select an authority. The ordinary CLI remains Compass until an authorized host supplies an existing shared binding.
- No local fallback after explicit shared selection, including factory creation, admission, progress projection, final result or error writeback.
- Preserve the existing WeakSet-branded local writer and host-owned lock path. A shared claim supplements the local writer; JSON cannot impersonate it.
- Shared root CAS rejects a stale/expired claim and conflicts without automatic refresh/retry. External side effects retain their own required downstream fencing.
- Work only in `/workspace/scratch/d10f272cafc1/goriq-g3`, branch `work/1219-g3-authority-binding-20261115`, base `33eb098df543fc7331414a02a717c28c98b37853`. Do not edit the main worktree, commit, push or mutate remote state.

## Review Focus

1. A shared import missing canonical control or WorkState must refuse before constructing a Builder; an empty local Compass must not become authority.
2. Pause/Human Gate or requirement changes during awaited work must stop candidate/progress/status writes, including the catch path.
3. Epoch takeover or an uncertain/conflicting CAS must not be repaired by stale-owner final or error writeback.
4. Restart must read rejected candidates and recovery state from the injected store, including closures created by the tracked-repair factory.
5. Broker scheduling and executor startup must read the same canonical budget and stop state; a local scheduling cache cannot grant authority.

## Confirmed Baseline and Scope Decision

The executor currently opens Compass in `configuredDevelopmentRuntime`, `appendEvent`, `updateWorkRun`, `checkpointGoalContinuation`, startup and catch. The Resident adapter opens it for Goal/control/progress, and hosted admission opens it again. Broker scheduling/retries use a separate CompassWorkRunStore. The two manifest factories construct local Job/Change Set stores, and tracked repair closes over `changes` for recovery. A store-only swap would split truth.

`GitHubGoalCheckpoint` already authenticates Goal, WorkRun, Development Jobs, task state and append-only events under one encrypted CAS root. It lacks an imported canonical control/WorkState record. Therefore the first implementation patch must deliver the authority journal **and an actual executor/bridge/host consumer**, with explicit shared scheduling support. An unused interface, a factory-only test or a fake green hosted activation is insufficient.

The patch is source-only. The production path remains unavailable until recovered originals and an existing authorized store/key/claim/freshness floor are supplied and the real host binds them. G1 and actual Actions A/B acceptance cannot be closed by these tests.

## Contract Decisions

### Trusted authority interface

Create `src/orchestrator/resident-execution-authority.ts` with these types:

```ts
interface ResidentControlState {
  status: string | null;
  blockers: unknown[];
  active: unknown[];
  nextAction: string | null;
}
interface ResidentAuthoritySnapshot {
  goalId: string;
  goal: Goal;
  control: ResidentControlState;
  run: WorkRunState;
  work: WorkState | null;
  events: GoalBridgeEvent[];
}
interface ResidentExecutionAuthority {
  readonly kind: "compass" | "shared";
  readonly authorityPath: string;
  readonly persistence: ResidentPersistence;
  read(goalId: string): Promise<ResidentAuthoritySnapshot>;
  assertFence(): Promise<void>;
  commit(expected: ResidentAuthoritySnapshot,
    next: ResidentAuthoritySnapshot): Promise<void>;
}
type ResidentPersistence = Pick<
  ConstructorParameters<typeof ResidentDevelopmentGoalHost>[0],
  "jobs" | "changeSets"
>;
```

Snapshots are host-returned observed objects; implementations retain their observed backend revision in a WeakMap. A caller-created snapshot is not valid `expected`. `commit` verifies immutable Goal identity and rereads canonical controls under the backend transaction/CAS before updating projections. Callers copy a snapshot for `next`; they cannot reset immutable source identity, terminal state, event prefixes or completed progress. Failure invalidates the observation and is not automatically retried.

`authorityPath` identifies the existing host-owned local serialization scope and must match the pinned hosted routing configuration and writer path. It is not a remote credential or proof of shared authority. Shared identity additionally comes from the injected checkpoint store and its authenticated claim.

Control `active` preserves unknown entries and canonical requirement records. Managed Compass WorkRun/WorkState/bridge-event envelopes are read/written through their typed stores; shared control projection excludes these envelopes to prevent stale duplicate authority. The original complete StateRecord remains retained in the immutable shared import event.

`read` validates Goal ID/digest, WorkRun identity and all required imports. The shared adapter requires a complete non-null imported WorkState. The Compass adapter preserves its existing legitimate null WorkState and creates progress only through the current verified Resident projection logic.

### Shared journal format

Create `scripts/goriq-github-resident-authority.ts`. Reuse `GitHubFencedCheckpointStores.load/commitTogether`, `GitHubGoalCheckpoint.events`, event SHA256, imported `developmentJobs` and `createGitHubResidentPersistence`; do not introduce another root or schema migration.

- Exactly one `goriq-resident-authority-import-v1` record is mandatory, bound to `goalId`, `goalContractDigest`, complete original `StateRecord`, existing WorkState and existing bridge-event history.
- Validate its WorkRun/WorkState/bridge envelope projections against the imported source and current authenticated checkpoint history. Reject duplicate import, update-before-import, unsupported authority version, digest mismatch, malformed control/work, missing Jobs/Change Set import and mismatched Goal/run/criteria.
- `goriq-resident-authority-update-v1` records bind `goalId`, `goalContractDigest`, previous authority-record SHA256, normalized control, WorkState and bridge-event projection. Preserve the original event history, ordered previous-record chain and recognized event prefixes; no truncation/reset.
- Only fixture code supplies fixture import records in this patch. Production code contains no operation that fabricates, seeds or imports an original.
- A commit writes the WorkRun and authority update in one `commitTogether` CAS. Jobs and Change Sets use the same injected fenced stores; each existing state-machine boundary remains separately atomic/recoverable as today.
- `assertFence` must perform a fresh current-claim validation using the existing coordinator runtime/store contract, not a cached claim or a no-op read. Extend the existing stores with an explicit read-only fence assertion if needed, backed by the same store/claim pair.

### Executor and adapter binding

Export `executeGoal(input: { goalId: string; context: unknown[]; authority: ResidentExecutionAuthority; runtime?: DevelopmentGoalRuntime; writer?: ResidentExecutionWriter }): Promise<GoalExecutionResult>` from a focused executor-runner module. It owns the current bounded startup/resource/continuation/status/event sequence and always invokes the existing GoalControllerExecutionBridge. The current script constructs the default Compass authority and selected runtime, calls the runner, and retains its CLI exit-code behavior.

Extend `DevelopmentRuntimeOptions` with a trusted `authority?: ResidentExecutionAuthority`; supplied runtime, authority and writer must bind to the same Goal and authorityPath. The Resident branch reads/projections through that authority. Existing non-Resident/cognitive/completion/inspection paths retain their existing Compass behavior and reject shared authority rather than falling back to them.

Extract the existing `projectResidentProgress` validation and projection so it can use the selected snapshot without duplicating its criterion/evidence checks. Its final commit checks current controls and the remote fence atomically with the selected backend, preserving the existing Compass SQLite precondition.

Extend hosted admission with trusted `authority?: ResidentExecutionAuthority`; it still validates the original host-owned configuration, expiry, execution contract, capabilities, risk/privacy/cost and branded writer. Its canonical Goal/control/WorkRun/WorkState reads use the supplied authority when present.

Both manifest factories take `persistence?: ResidentPersistence`. Normal executor runtime construction also uses that dependency. Default construction retains the existing file stores. Tracked repair assigns `changes` once from the selected persistence, and every recovery lookup uses that variable.

### Broker binding

Extract a small scheduling predicate/dispatch helper used by the existing Broker, consuming `ResidentExecutionAuthority.read` for current Goal, runnable WorkRun, canonical stops and waits. Add a trusted host composition option for an injected executor callback using the same authority instance/factory; the default callback retains the existing child CLI.

The shared callback executes the same exported `executeGoal` runner. Broker owns scheduling only, while the existing bridge/Resident own work. Do not add an environment module loader, network protocol or separate daemon. Default Broker keeps the existing process isolation; fixture shared composition can run the injected callback with its bounded scheduling semantics. Production shared activation remains disabled/unconfigured.

## Task 1: Add the authority journal and default Compass adapter with failing safety tests

**Files:** Create `src/orchestrator/resident-execution-authority.ts`, `src/orchestrator/compass-resident-execution-authority.ts`, `scripts/goriq-github-resident-authority.ts`, `tests/resident-execution-authority.test.ts`, `tests/github-resident-authority.test.ts`; modify `scripts/goriq-github-checkpoint-stores.ts` only for fresh fence assertion if required.

**Interfaces:** Produces the trusted contract above and `createCompassResidentExecutionAuthority({compassPath})`, `createGitHubResidentExecutionAuthority({stores, authorityPath})`.

- [x] Write failing tests for complete observed read/conditional commit, missing import, duplicate/unsupported import, tampered event digest/chain, Goal/run/DoD mismatch, canonical requirement preservation and mandatory shared WorkState.
- [x] Run `node --test tests/resident-execution-authority.test.ts tests/github-resident-authority.test.ts`; record RED assertion output.
- [x] Implement the adapters with observed revision tracking, same-root CAS, fresh fence checks, append-only histories and no fallback. Preserve unknown source active records verbatim.
- [x] Add tests for stale expected snapshot, concurrent CAS winner, expired/taken-over claim, unknown commit outcome, terminal overwrite and pause/Human Gate preserved during commit.
- [x] Run both focused files to PASS. Review the source for no bootstrap/Goal/key/election/import endpoint and zero local Job/Change Set writes in shared mode.

## Task 2: Connect the existing Resident adapter and admission to the selected authority

**Files:** Modify `src/orchestrator/compass-goal-execution-adapter.ts`, `src/orchestrator/runtime-resident-admission.ts`; create `src/orchestrator/resident-progress-projection.ts` only to hold the existing extracted validation; extend `tests/resident-hosted-admission.test.ts` and `tests/resident-compass-progress.test.ts`.

**Interfaces:** Consumes Task 1 authority; produces `DevelopmentRuntimeOptions.authority` and hosted admission's trusted optional authority input. The bridge interface remains unchanged.

- [x] Write RED tests where local Compass is empty/stale but the injected shared authority contains the accepted Goal; invoke the existing adapter and host, not a replacement adapter.
- [x] Add pause, Human Gate, canonical requirement and epoch takeover during awaited Builder/verifier/progress tests; assert no candidate/progress/terminal write after rejection and no local read fallback.
- [x] Run the two focused files and record RED.
- [x] Replace only the Resident branch's Goal/context/control/progress reads with the selected authority; retain the existing branded writer and all evidence/criterion checks.
- [x] Run existing and new admission/progress tests to PASS, including direct Compass callers.

## Task 3: Inject persistence into all real runtime factories, including recovery closures

**Files:** Modify `src/orchestrator/sequenced-resident-runtime.ts`, `src/orchestrator/tracked-repair-resident-runtime.ts`, normal host construction in `scripts/jarvis-goal-executor.ts`; extend `tests/sequenced-resident-runtime.test.ts`, `tests/autonomous-tracked-repair-runtime.test.ts`.

**Interfaces:** Each factory accepts `persistence?: ResidentPersistence`; no manifest field may supply it.

- [x] Write RED tests proving supplied Job/Change Set stores receive real factory transitions while default local files stay absent.
- [x] Add a tracked-repair rejected-candidate recovery fixture that succeeds only when `recoveryContext` reads the supplied journal; keep all signed complete-FAIL requirements.
- [x] Run the selected factory test names to RED, implement the dependency selection once per factory, and rerun to PASS.
- [x] Confirm omission retains all existing factory and prepared-replay semantics.

## Task 4: Route the actual bounded executor through the selected authority

**Files:** Create `src/orchestrator/resident-goal-executor.ts`; modify `scripts/jarvis-goal-executor.ts`; create `tests/shared-resident-goal-executor.test.ts`; extend `tests/development-resource-executor.test.ts` and `tests/goriq-broker-writer-contention-recovery.test.ts` as needed.

**Interfaces:** Produces the exported `executeGoal` contract above, consumed by the CLI and Task 5. Context/Goal input cannot provide an authority.

- [x] Write an integration test using the real encrypted GitHubCoordinatorStore with fixture fetch/CAS, existing checkpoint/fenced stores, real bridge and existing Resident host. First run builds to verifier wait; discard every store/runtime object, reconstruct them, then resume without a second build and advance to the approved next Job using fixture verification.
- [x] Assert shared WorkRun/control/WorkState/events/Jobs/Change Sets survive reconstruction and no local JSON/Compass projection supplies success. Label this fixture evidence explicitly.
- [x] Run the test to RED, then extract the existing executor sequence into the runner and make the ordinary CLI call it.
- [x] Add negatives for resource retry-at/budget, continuation retry-at/20-slice ceiling, paused startup, terminal WorkRun, invalid profile/shared fallback, takeover before status and takeover before catch writeback.
- [x] Run the integration, resource executor and contention tests to PASS. Verify original exit 75 contention behavior and no losing-writer status update.

## Task 5: Make Broker scheduling consume the same authority and real runner

**Files:** Create `src/orchestrator/resident-goal-scheduling.ts`; modify `scripts/jarvis-broker.ts`; create `tests/shared-resident-goal-scheduling.test.ts`; retain `tests/autonomous-resident-sequence-broker-e2e.test.ts` and existing Broker restart tests.

**Interfaces:** Consumes Tasks 1 and 4. Exposes an injected trusted scheduling composition `{authority, execute}`; both use the same authority binding. The default Broker composition uses Compass and its existing child CLI.

- [x] Write RED scheduling tests with disagreeing local cache/shared controls, duplicate active dispatch, future waits, exhausted waits, canonical pause/Human Gate and changed Goal.
- [x] Implement the selected-authority scheduling check and bounded callback integration in the existing Broker path. Do not install a second controller or activate a shared production host.
- [x] Run the new scheduling tests and existing Broker fixture/restart tests to PASS. Confirm shared execution cannot select the ordinary Compass CLI fallback.

## Task 6: Reconcile traceability and validate the source patch

**Files:** Update only changed existing rows/add necessary new runtime surface rows in `docs/jarvis-reverse-traceability.json`; update `docs/decisions/2026-11-11-hosted-goal-routing.md` with source binding and explicit activation gap. Keep historical evidence intact.

- [x] Recompute actual SHA256 for modified tracked source surfaces, preserve classification/requirement/owner decisions and inspect every registry diff.
- [x] Run `node scripts/jarvis-requirement-audit.mjs`, `node_modules/.bin/tsc --noEmit --incremental false`, and `node_modules/.bin/eslint` on all changed/new TS files. Inspect failures; do not weaken checks.
- [x] Run one focused combined test command for authority/journal/admission/progress/executor/factories/Broker changes with `/workspace/scratch/d10f272cafc1/tools/pwsh` on PATH where required. Record counts and any existing conditional skips exactly.
- [x] Run `git diff --check` and inspect `git diff --stat`/full diff. No commits or remote writes. Parent performs the full suite and protected integration.
- [x] Report source/test files, actual commands/results, remaining G1/activation/Actions/model/signing gaps and rollback. Source rollback removes this dependency binding; there is no production data migration to reverse.

## Completion Boundary and Plan Self-Review

This patch is complete only when the same real runner used by the default CLI can traverse the existing bridge/host against reconstructed shared authority fixtures, all listed negatives pass, default Compass behavior passes, and Broker shared scheduling uses the same authority. If the implementation cannot meet that boundary in one patch, stop before claiming G3 source completion and report the exact unfinished consumer; do not ship an unused abstraction as completion.

Coverage review: Task 1 owns complete import and atomic projections; Task 2 owns canonical stop/progress/admission behavior; Task 3 owns recovery closure persistence; Task 4 owns actual executor, budget and final/catch writes; Task 5 owns scheduling; Task 6 owns fingerprints and validation. Every Review Focus condition has an explicit failing test in its owning task. Production original-state import, actual-model recovery, independently authenticated production receipts, Actions A/B execution and final artifact readback remain separate unproved gates.

## Execution Ledger (2026-11-15)

- Tasks 1–5 have source consumers and focused tests. The ordinary Resident CLI calls the same exported runner as the encrypted-store reconstruction test; the existing Broker calls the same scheduling composition as the exclusive-shared/duplicate/stop/budget tests. Both runtime factories consume injected persistence, and signed-FAIL tracked recovery tests read the injected rejected history across reconstructed factories.
- Task 1 review corrections were tested RED then GREEN: clone the proposed snapshot before awaiting; validate complete typed source state/work and unique versioned projections; preserve existing run blockers/evidence; accept the existing constructor's empty initial currentState and opaque canonical blockers; bind objective/constraints/DoD to the original Goal; reject array coercion into enums. Matching expired lease/claim, unknown successful commit, terminal/forged observation and history-chain rejection are covered.
- Additional read-race ruling: all fenced adapter reads now pass the existing claim to `GitHubCoordinatorStore.loadCheckpoint(claim?)`, which checks the lease from that same root GET with the existing CAS claim validator. The no-argument diagnostic API is unchanged. Six takeover-between-GET tests failed before this change and pass after it; existing coordinator/checkpoint/journal/read-fence plus authority tests pass 145/145.
- Runtime ruling: `executeGoal` requires a supplied runtime. An absent shared runtime must not select another provider/controller. Shared completion additionally requires the canonical verified WorkState projection; a runtime report alone cannot create completion.
- Broker ruling: the trusted binding covers accepted decisions and their execution scheduling. G2 intake/GoalResolver migration, external triggers and production activation are deliberately outside this patch. Explicit shared selection bypasses the local child callback entirely; it does not create another controller.
- Final-stop ruling: authority is checked again after the awaited runtime returns. A later rejected final commit returns the actual canonical stop rather than a stale completion report. The default Resident CLI no longer performs an earlier unguarded RUNNING write, and its existing error path preserves prior blockers/evidence.
- Full-scope review correction: shared exceptions never perform catch writeback. An initial CAS conflict, actual saved commit with lost receipt, and an authority transport exception typed as resource pressure all reproduced an unsafe second commit before the change. The runner now propagates each exception without a new observation/write; definitive Resident resource waits still persist through the normal host report path. This also leaves rejected unverified-completion reports at their last durably known RUNNING state instead of manufacturing a catch BLOCKED event.
- Full-scope review correction: selected persistence now uses a guarded view of the existing fenced stores. The guard validates the canonical control projection from the same expected checkpoint as the Job/Change Set/WorkRun CAS, preserving the generic owner interface. Independent real owner CAS tests reproduced post-pause Change Set, existing Job-transition and new-Job writes; all now refuse, and pause between validation and commit still loses CAS without retry. The complete final checkpoint must equal the paused owner's checkpoint.
- Integration regression corrections: default Compass runtime mismatch delegates to the existing non-Resident loop; explicitly shared mismatch still fails closed. The existing WorkRun archive test now verifies both authenticated-read rejection and a prior-observed old-owner write rejection after an independent owner epoch CAS, rather than assuming an old-owner read succeeds.
- Final delegation review correction: await the default Compass delegated loop inside the owning try/finally. A real OS-writer/gated-loop regression reproduced a second writer acquiring the lock before the delegated loop finished; both owned and supplied writer paths now remain held through completion.
- Validation before final scope review: the first complete focused run passed 269/269; after the six new same-root read tests, the affected store/journal subset passed 145/145. TypeScript strict no-emit passed, ESLint passed all 23 changed/new TypeScript files, traceability audit passed 626 surfaces/341 requirements, and `git diff --check` passed. The final combined focused rerun passed 275/275 (0 failed, 0 skipped) in 67.007 seconds. Root-owned full-suite and final scope review remain pending; no full suite, commit or remote mutation was performed by this implementer.
- Base was advanced by the parent from `33eb098df543fc7331414a02a717c28c98b37853` to protected main `cfb6a35427efdd7f71beec4d313dbda4c0bd470b`, preserving the uncommitted G3 changes. The parent separately owns the G1 source/tests/evidence and final repository state/handoff.
- Final review closure: catch/CAS/default-route corrections passed 241 tests in 18 related files; the final `return await` writer correction then passed 46 affected tests in 6 files. These sets overlap. The independent reviewer repeated both real-writer cases and found no unresolved findings in the reviewed G3/G1 scope. Parent Lint, Typecheck, Build and 626-surface/341-requirement audit passed. The frozen local full run was interrupted after a separate existing TCP-loss fixture timed out and did not finish; it is INCONCLUSIVE, not a full pass. Candidate and unchanged-parent bounded four-case reruns both passed. See the source evidence ledger for the complete limitation; published-HEAD CI remains mandatory.
