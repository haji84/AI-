# Project State

PROJECT: General Autonomous AI / Unified AI Creator Studio / GAI Research OS
AI_COMPANY_VERSION: 1.0
PROJECT_VERSION: 0.0.0
CURRENT_PHASE: GAI Phase 9 Planner Enhancement
STATUS: PLANNER_ENHANCEMENT_NEXT
LAST_UPDATED: 2026-09-15
CURRENT_EPIC: One-front-door general autonomous AI with durable offline-first device-neutral execution and verifier-driven completion
ACTIVE_ISSUES: #477, #320, #315, #316, #317, #318, #319, #321
OPEN_PRS: empirical research/device-control work may proceed independently when scopes do not conflict
BLOCKERS: none for Phase 9 planner enhancement; real iPhone transport/provisioning/device E2E remains a later device-integration step and must not be inferred from contract tests
PRIORITY_OVERRIDE: owner-approved General Autonomous AI implementation roadmap governs current architecture work; empirical GAI research remains active; deferred Phase 3 image smoke stays deferred until owner resumes product work
NORTH_STAR_GOAL: Human gives one goal; the system determines required work, dynamically recruits available capabilities, executes, verifies, repairs, records, and completes with the fewest necessary human returns, including continued local work during connectivity loss where capability permits
USER_MENTAL_MODEL: one autonomous AI front door; internally recruit only the roles actually needed, including bounded mid-task expansion when new needs are discovered
INTERNAL_ORCHESTRATION_MODEL: task-specific roles assembled from real registered capabilities; execution teams may dissolve but their verified organization patterns and experience remain reusable
AI_COMPANY_REUSE_POLICY: retain jobs, workers, providers, dashboard, contracts, cloud/local runtimes, and governance as internal capabilities and experimental infrastructure
DYNAMIC_TEAM_CONTRACT: planner requirements + goal + available capability catalog -> deterministic role/capability assignments; missing required capabilities fail visibly and never get fabricated
DYNAMIC_REPLANNING_POLICY: active-team capability shortage -> current risk/Human Gate first -> registered-capability check -> Goal/DoD necessity check -> bounded team expansion -> rerun under unchanged Risk/Approval/Verifier/Retry/Write-back governance
HUMAN_GATE_INVARIANT: payment/purchase, destructive deletion, permission/credential changes, production deployment/publication, security/governance weakening, and all existing approval-required actions remain human-gated; dynamic team expansion never grants permission
TEAM_MEMORY_POLICY: successful executable teams can become TeamBlueprints; similar future goals recall proven blueprints only after current capability revalidation; changed conditions create child blueprints without overwriting parent evidence
TEAM_LIFECYCLE_POLICY: experimental -> reusable -> standing_candidate after repeated verified success; repeated poor performance -> demoted and excluded from automatic recall; equally proven child generations are preferred over older parents
TEAM_RUNTIME_POLICY: persistent organizational memory -> recall eligible blueprint or assemble current team -> detect genuine mid-task capability need -> bounded expansion if registered and necessary -> bounded GoalDrivenLoop -> verifier/risk/Human Gate/write-back -> evidence-based team outcome -> atomic persistence for later reuse
ARCHITECTURE_REFERENCE: docs/architecture/general-autonomous-ai-dynamic-orchestration.md + docs/architecture/team-organizational-memory.md + docs/architecture/adaptive-team-runtime.md + docs/architecture/dynamic-capability-replanning.md + ROADMAP.md General Autonomous AI implementation roadmap
LAST_SUCCESSFUL_CI: GAI Phase 8 Self-Healing / Recovery PR #572 passed repository-guard, lint, full tests, build, and production health then merged as 014c4bd63368aedd824f36900352cae07f87d132 on 2026-09-15
COMPASS_MCP: v1 merged and real-machine interoperability verified PASS
COMPASS_HANDOFF: standard AI employee handoff protocol merged via PR #64
AI_EMPLOYEE_COMMAND_INGRESS: dashboard chat source=chat E2E PASS
AI_EMPLOYEE_BOUNDED_PLAN: inspect plan validation and bounded autonomy cycle E2E PASS
AI_EMPLOYEE_AUTONOMY_FOUNDATION: Issue #243 completed on 2026-09-08
GAI_MISSION: develop and research a measurable general autonomous intelligence architecture that can plan, act, remember, learn, verify, transfer experience, dynamically compose and expand capabilities, retain successful organization patterns, remain useful offline where local capabilities permit, and improve itself without claiming AGI prematurely
GAI_CORE_LOOP: Goal -> DoD -> Current State -> Context partition -> Plan -> Recall/assemble team -> Predict -> Act -> detect capability/connectivity gap -> necessity/risk/gate check -> bounded replan/recruit/defer -> Observe -> Verify -> Repair -> Deliver -> Write-back -> Record team outcome -> Persist organization memory -> Benchmark -> Learn -> Abstract -> Transfer -> Diagnose -> Hypothesize -> Experiment -> Held-out evaluate -> Accept/Reject -> Re-evaluate
GAI_MODEL_POLICY: replaceable multi-model router; Astra tier for frontier/research-critical tasks when plan-included, Sol tier for primary reasoning, local tier for routine/always-on/offline-capable work; pay-as-you-go AI API fallback prohibited by default
GAI_MODEL_EXECUTION_G5: merged via PR #311; governed execution adapters implemented for local / Sol / Astra tiers; frontier escalation requires explicit plan inclusion; unavailable frontier capacity degrades to lower zero-cost tiers; usage ledger enforces additional API cost = 0
GAI_MEMORY_MODEL: working + episodic + semantic + procedural + persistent organizational team memory
GAI_MEMORY_G1: merged via PR #300; file-backed versioned persistence, provenance, confidence, task-relevance retrieval, working-set replacement, and verified learning promotion implemented
GAI_WORLD_MODEL_G2: merged via PR #305; persistent prediction/observation events, confidence-sensitive prediction error, context retrieval, repeated-evidence calibration, and verified handoff into G1 memory implemented
GAI_PLANNER_G3: merged via PR #306; semantic/procedural memory, world-model evidence, and transferable skills inform next-action selection; weak skills are automatically demoted from repeated outcomes
GAI_CLOSED_LOOP_G4: merged via PR #309; verified per-task benchmark history, second-attempt measurement, world-model/memory/skill feedback, and held-out isolation implemented
GAI_RESEARCH_G6: merged via PR #314; recurring verified failures are clustered into bottlenecks and converted into measurable research hypotheses with persistent experiment history
GAI_SELF_IMPROVEMENT_G7: merged via PR #314; candidates are accepted only on sufficient held-out gain with zero incremental paid API cost and no safety/human-intervention regression
GAI_CONTINUAL_LEARNING_G8: merged via PR #314; regressions are rejected rather than promoted; train/held-out separation remains enforced
GAI_TELEMETRY_G9: merged via PR #314; research state exposes stable contracts consumable by the cross-device dashboard
GAI_EVALUATION_G10: merged via PR #314; long-horizon evaluation, external benchmark adapter contracts, and AGI-gap reporting implemented
GAI_MULTI_WORKER_R0: Windows/macOS worker architecture, health/capability preflight, capability-aware selection, cross-device reproduction metrics, and a hard boundary preventing unconfigured CI/workstations from claiming a real baseline
GAI_COMMON_WORKER_RUNTIME: COMPLETE via Issue #559 / PR #560; common runtime provides capability registration/dispatch, runtime state, checkpoint hooks, structured execution evidence, security/verifier metadata, and compatibility with MultiWorkerRuntime
GAI_INITIAL_WORKER_ADAPTERS: COMPLETE via Issue #561 / PR #562; ZBook and MacBook common-runtime factories plus OS-managed iPhone adapter and research-capability bridge are merged without Goal Loop device hard-coding
GAI_GOAL_LOOP_WORKER_INTEGRATION: COMPLETE via Issue #563 / PR #564; planner capability actions route through MultiWorkerRuntime, preserve worker evidence for Verifier, and ordinary worker failures enter existing recovery flow
GAI_DURABLE_TASK_RUNTIME: COMPLETE via Issue #565 / PR #566; persistent task state, dependencies, idempotency, leases, checkpoint references, retry/cancel, expired-lease reclaim, and orphan recovery are merged
GAI_OFFLINE_FIRST_RUNTIME: COMPLETE via Issue #567 / PR #568; online-required work waits durably, offline-capable work continues locally, connectivity transitions are explicit, reconnect resumes waiting work, and missing local capacity waits for resource instead of terminal failure
GAI_SYNC_CONFLICT_RESOLUTION: COMPLETE via Issue #569 / PR #570; versioned local/shared state uses causal clocks, verifier/task-ownership evidence, bidirectional convergence, and explicit unresolved critical conflicts instead of naive last-write-wins
GAI_SELF_HEALING_RECOVERY: COMPLETE via Issue #571 / PR #572; ordinary execution failures are classified into bounded repair/retry/fallback/wait/replan paths, compatible-worker fallback excludes failed workers, verifier PASS is required before healed completion, and standing Human Gates remain non-bypassable
GAI_WORKERS: initial real-device strategy is ZBook=Windows/GPU/local-model/long-running, MacBook=macOS/reproduction/local-model/long-running, iPhone=iOS OS-managed mobile/offline/sensor worker; Android is a later adapter proof and must not require Goal Loop core changes
GAI_OFFLINE_FIRST_POLICY: network is an optional capability enhancer, not a survival condition; offline-capable local work continues, online-required work waits durably, and recovery triggers sync/conflict resolution/resume/re-verification
GAI_EVAL_POLICY: verifier/eval is cross-cutting from the first foundation phase; every phase advances only after implementation, automated checks, strongest available real-device E2E, structured verification, repair, and PASS evidence
GAI_DEVICE_EVAL_POLICY: intelligence score and device/OS effects are measured separately; speed differences must never be interpreted as intelligence improvement
GAI_INITIAL_KPI: >=100 unknown-task cases; >=80% success; <10% human interventions/task; second-attempt improvement; positive held-out self-improvement; explicit transfer measurement; zero incremental pay-as-you-go AI API cost
GAI_SELF_IMPROVEMENT_POLICY: candidate changes must be sandboxed and accepted only on held-out measured improvement with no safety/cost/intervention regression
GAI_AGI_CLAIM_POLICY: project-defined target completion never automatically authorizes an AGI claim; independent external evaluation is required
GAI_CROSS_DEVICE_TARGET: initial ZBook + MacBook + iPhone; Android joins later through the same worker contract/eval path; ChatGPT Work/Codex remains a plan-included frontier boundary where available
GAI_PLATFORM_IMPLEMENTATION: COMPLETE
GAI_ADAPTIVE_TEAM_RUNTIME: COMPLETE; dynamic assembly, proven-team recall, team-scoped execution, verified outcome learning, and process-persistent organizational memory are integrated without bypassing existing safety gates
GAI_NEXT_PHASE: implement GAI Phase 9 Planner Enhancement so planning uses Goal, DoD, current state, gaps, available capabilities, connectivity, resources, risk, verifier evidence, and recovery evidence to choose and re-plan work
PHASE_2_TECHNICAL_ACCEPTANCE: PASS
PHASE_2_ACCEPTANCE_RECORD: docs/architecture/0009-phase-2-acceptance.md
PHASE_2_FORMAL_COMPLETION: COMPLETE
PHASE_2_HUMAN_GATE: APPROVED by owner on 2026-09-01
PHASE_3_CONTRACT: merged via PR #71
PHASE_3_APPLICATION_SERVICE: merged via PR #73
PHASE_3_ACCEPTANCE_PATH: defined in ADR 0010; criteria 1, 2, and 3 complete; criterion 4 pending real-machine smoke; criterion 5 pending final acceptance review
PHASE_3_RUNTIME_SELECTION: ComfyUI + Qwen-Image-Edit merged via PR #75
PHASE_3_RUNTIME_API_PATH: merged via PR #77; upload, workflow injection, prompt submission, history polling, and output download implemented
PHASE_3_REAL_MACHINE_SMOKE: deferred; Issue #78 remains open for later workstation execution
PHASE_3_PRIORITY: deferred by owner on 2026-09-08 until autonomy/GAI research foundation is sufficiently complete
NEXT_PRIORITY: implement GAI Phase 9 Planner Enhancement under verifier-driven phase gates; Human Gate categories remain non-negotiable and must not be auto-executed
HUMAN_APPROVAL_PENDING: none for ordinary LOW/MEDIUM Phase 9 implementation; production, secrets, permissions, billing, destructive, governance/security weakening, and external-publication gates remain in force
AUTO_FIX_ATTEMPTS_MAX: 3
MAX_ACTIVE_AGENTS: 3
MAX_PARALLEL_CODE_AGENTS: 2
MAX_ISSUES_PER_CYCLE: 2
