# Roadmap

## Phase 0 - AI Company foundation
Repository governance, agents, issue/PR contracts, CI, kill switch, scheduled-task prompts, human gates, and a dry-run issue.

## Phase 1 - Creator Studio foundation
Application shell, project model, storage abstraction, job model, provider interfaces.

## Phase 2 - Image generation
## Phase 3 - Image editing
## Phase 4 - Sketch to image
## Phase 5 - Video generation
## Phase 6 - Video editing
## Phase 7 - Voice and subtitles
## Phase 8 - AI automatic editing
## Phase 9 - Provider/model management
## Phase 10 - Mobile optimization
## Phase 11 - PC/mobile synchronization
## Phase 12 - Integration testing
## Phase 13 - Release

No phase advances until its acceptance criteria and required human gates are satisfied.

---

# General Autonomous AI implementation roadmap

This roadmap is the current implementation order for the one-front-door General Autonomous AI. Detailed architecture remains evolvable; the contracts below are intended to preserve extensibility rather than freeze implementation choices prematurely.

## Cross-cutting requirements from the first phase

- **Verifier / Eval:** every implementation phase must run through unit/integration checks and the strongest available real-device E2E. Completion requires evidence, not executor self-report.
- **Security:** task-scoped delegated authority, credential isolation, Human Gates for irreversible/privileged work, prompt-injection defenses, auditability, anomaly detection, and circuit breakers remain in force.
- **Observability:** execution traces, structured failure reasons, task history, evidence, worker/runtime identity, and relevant resource/connectivity state are recorded.
- **Rollback:** material changes remain reversible and self-improvement candidates must preserve a known-good path.
- **Offline-First:** network availability is an optional capability enhancer, not a survival condition. Offline-capable work continues locally; online-required work waits and resumes after recovery.

## Initial real-device strategy

Initial devices:
1. **ZBook:** Windows/GPU/local-model/PC and filesystem work; resident/long-running execution.
2. **MacBook:** macOS/local-model/development/reproduction; resident/long-running execution.
3. **iPhone:** OS-managed mobile worker for sensors, GPS, camera, local state/inference/cache, foreground and supported background/deferred execution. It is not modeled as an unrestricted resident daemon.

Android is intentionally **not** part of the initial active-device set. A later phase must prove that Android can join by adding an adapter/capability manifest and passing the same contract/offline/recovery/device-E2E tests without changing Goal Loop core.

## Implementation order

### GAI Phase 0 - Common Architecture / Worker Contract
Define device-neutral Goal/Task/Worker/Capability/Execution/Result/Evidence/Checkpoint/Verification/Memory/Sync boundaries. Planner asks for capabilities; routing selects concrete workers.

### GAI Phase 1 - Advanced Verifier / Eval Foundation
Build structured Goal/DoD, planner, router, worker-contract, capability, device-E2E, offline, recovery, sync, security, and regression evaluation primitives. Expand them continuously rather than postponing verification to a late phase.

### GAI Phase 2 - Common Worker Runtime
Unify identity, capability registration, task reception/execution, local state, checkpoint hooks, health, result reporting, security context, and verifier hooks behind one runtime contract.

### GAI Phase 3 - Initial ZBook / MacBook / iPhone Workers
Promote existing ZBook/MacBook worker assets into the common runtime and implement the iPhone adapter according to iOS-managed execution constraints.

### GAI Phase 4 - Goal Loop to Worker Integration
Connect Goal/DoD -> Planner -> Capability requirement -> Router -> Worker -> Evidence -> Verifier without hard-coded device selection in the Goal Loop.

### GAI Phase 5 - Durable Task Runtime
Add persistent queue/state, dependency tracking, leases/idempotency, checkpoint/resume, retry/timeout, cancellation, crash recovery, and orphan-task recovery.

### GAI Phase 6 - Offline-First Runtime
Add connectivity state, local source of truth, persistent offline queue, local context/cache/model capability handling, and WAITING_FOR_CONNECTIVITY semantics while local-capable work continues.

### GAI Phase 7 - Sync / Conflict Resolution
Synchronize Goal/Task/Result/Memory/Skill/Evidence/log state after recovery. Critical task state must not rely on naive last-write-wins when causal/ownership/verifier evidence is available.

### GAI Phase 8 - Self-Healing / Recovery
Classify failures, repair or choose alternatives, retry within policy, re-verify, and escalate only genuine blockers/Human Gates.

### GAI Phase 9 - Planner Enhancement
Plan from Goal, DoD, Current State, Gap, constraints, capabilities, connectivity, resources, risk, and evidence. Replan work around temporary offline/resource limits.

### GAI Phase 10 - World / Resource Model
Track real worker availability, platform, resources, connectivity, power, installed capabilities, workload, execution constraints, and relevant environment state.

### GAI Phase 11 - Memory Integration
Integrate working, episodic, semantic, and procedural memory with local/shared persistence and offline synchronization.

### GAI Phase 12 - Skill System
Convert repeatedly verified execution patterns into reusable skills with explicit capability/platform/network/tool requirements and regression evaluation.

### GAI Phase 13 - PC / iPhone / Browser Capability Integration
Expose device control, browser, filesystem, Office/development and mobile capabilities through the same execution spine and verification model.

### GAI Phase 14 - Android Later-Adapter Proof
Add AndroidWorkerAdapter -> capability registration -> Worker Contract Eval -> Offline Eval -> Recovery Eval -> real-device E2E. Goal Loop core must remain unchanged.

### GAI Phase 15 - Self-Healing UI
Recover from UI changes through accessibility/semantic lookup/vision and bounded alternate interaction paths, with outcome verification.

### GAI Phase 16 - Local Device Mesh
Enable authenticated local-network peer coordination so devices can exchange bounded tasks/results without public Internet where platform constraints permit.

### GAI Phase 17 - Dynamic Multi-Agent Runtime
Dynamically compose only the internal roles needed for a goal while presenting one user-facing AI and retaining the same task/security/verifier boundaries.

### GAI Phase 18 - Continual Learning
Use verified outcomes to improve routing, planning, recovery, model/tool selection, and transfer while preserving held-out evaluation and regression rejection.

### GAI Phase 19 - Self-Improvement
Allow bounded changes to prompts/policies/planner/router/recovery/skills/code only through sandbox -> tests -> device E2E -> regression eval -> canary -> monitored promotion with rollback.

### GAI Phase 20 - Production Autonomy
Unify the complete loop: Goal -> DoD -> Plan -> Tasks -> Worker selection -> Execution -> Offline/Checkpoint as needed -> Failure diagnosis/repair/replan -> Resume -> Verify -> Learn -> Goal completion, with the fewest necessary human returns.

## Phase advancement rule

Each GAI phase advances through:

`Implement -> Unit/Integration -> available real-device E2E -> Verifier/Eval -> failure diagnosis -> repair -> PASS -> write-back -> next phase`

A green CI harness is evidence that the harness works; it must not be misreported as a real-device or real-model result unless that execution actually occurred.
