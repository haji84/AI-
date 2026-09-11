# Project State

PROJECT: Unified AI Creator Studio / GAI Research OS
AI_COMPANY_VERSION: 1.0
PROJECT_VERSION: 0.0.0
CURRENT_PHASE: Empirical research operation R0/R1 multi-worker baseline runtime
STATUS: RESEARCH_MULTI_WORKER_RUNTIME_IMPLEMENTATION
LAST_UPDATED: 2026-09-11
CURRENT_EPIC: General autonomous intelligence research OS
ACTIVE_ISSUES: #320, #315, #316, #317, #318, #319, #321
OPEN_PRS: multi-worker runtime pending validation
BLOCKERS: real empirical runs require configured workstation model/runtime capacity; GitHub CI validates the harness but must not be reported as a real model benchmark run
PRIORITY_OVERRIDE: GAI empirical research operation takes precedence over deferred Phase 3 image smoke until owner resumes product work
LAST_SUCCESSFUL_CI: G6-G10 finalization PR #314 CI run #379 succeeded and merged on 2026-09-10
COMPASS_MCP: v1 merged and real-machine interoperability verified PASS
COMPASS_HANDOFF: standard AI employee handoff protocol merged via PR #64
AI_EMPLOYEE_COMMAND_INGRESS: dashboard chat source=chat E2E PASS
AI_EMPLOYEE_BOUNDED_PLAN: inspect plan validation and bounded autonomy cycle E2E PASS
AI_EMPLOYEE_AUTONOMY_FOUNDATION: Issue #243 completed on 2026-09-08
GAI_MISSION: develop and research a measurable general autonomous intelligence architecture that can plan, act, remember, learn, verify, transfer experience, and improve itself without claiming AGI prematurely
GAI_CORE_LOOP: Goal -> Plan -> Predict -> Act -> Observe -> Verify -> Benchmark -> Learn -> Abstract -> Transfer -> Diagnose -> Hypothesize -> Experiment -> Held-out evaluate -> Accept/Reject -> Re-evaluate
GAI_MODEL_POLICY: replaceable multi-model router; Astra tier for frontier/research-critical tasks when plan-included, Sol tier for primary reasoning, local tier for routine/always-on work; pay-as-you-go AI API fallback prohibited by default
GAI_MODEL_EXECUTION_G5: merged via PR #311; governed execution adapters implemented for local / Sol / Astra tiers; frontier escalation requires explicit plan inclusion; unavailable frontier capacity degrades to lower zero-cost tiers; usage ledger enforces additional API cost = 0
GAI_MEMORY_MODEL: working + episodic + semantic + procedural
GAI_MEMORY_G1: merged via PR #300; file-backed versioned persistence, provenance, confidence, task-relevance retrieval, working-set replacement, and verified learning promotion implemented
GAI_WORLD_MODEL_G2: merged via PR #305; persistent prediction/observation events, confidence-sensitive prediction error, context retrieval, repeated-evidence calibration, and verified handoff into G1 memory implemented
GAI_PLANNER_G3: merged via PR #306; semantic/procedural memory, world-model evidence, and transferable skills inform next-action selection; weak skills are automatically demoted from repeated outcomes
GAI_CLOSED_LOOP_G4: merged via PR #309; verified per-task benchmark history, second-attempt measurement, world-model/memory/skill feedback, and held-out isolation implemented
GAI_RESEARCH_G6: merged via PR #314; recurring verified failures are clustered into bottlenecks and converted into measurable research hypotheses with persistent experiment history
GAI_SELF_IMPROVEMENT_G7: merged via PR #314; candidates are accepted only on sufficient held-out gain with zero incremental paid API cost and no safety/human-intervention regression
GAI_CONTINUAL_LEARNING_G8: merged via PR #314; regressions are rejected rather than promoted; train/held-out separation remains enforced
GAI_TELEMETRY_G9: merged via PR #314; research state exposes stable contracts consumable by the cross-device dashboard
GAI_EVALUATION_G10: merged via PR #314; long-horizon evaluation, external benchmark adapter contracts, and AGI-gap reporting implemented
GAI_MULTI_WORKER_R0: current branch adds Windows/macOS workers, health/capability preflight, capability-aware selection, cross-device reproduction metrics, and a hard boundary preventing unconfigured CI/workstations from claiming a real baseline
GAI_WORKERS: ZBook=Windows/GPU/local-model/long-running; MacBook=macOS/reproduction/local-model/long-running; both share the same GAI version and benchmark definitions
GAI_DEVICE_EVAL_POLICY: intelligence score and device/OS effects are measured separately; speed differences must never be interpreted as intelligence improvement
GAI_INITIAL_KPI: >=100 unknown-task cases; >=80% success; <10% human interventions/task; second-attempt improvement; positive held-out self-improvement; explicit transfer measurement; zero incremental pay-as-you-go AI API cost
GAI_SELF_IMPROVEMENT_POLICY: candidate changes must be sandboxed and accepted only on held-out measured improvement with no safety/cost/intervention regression
GAI_AGI_CLAIM_POLICY: project-defined target completion never automatically authorizes an AGI claim; independent external evaluation is required
GAI_CROSS_DEVICE_TARGET: iPhone + Android control surfaces; ZBook + MacBook execution workers; ChatGPT Work/Codex plan-included frontier boundary where available
GAI_PLATFORM_IMPLEMENTATION: COMPLETE
GAI_NEXT_PHASE: configure both workstation workers, freeze Benchmark Suite v1, then execute real Baseline Run #1 and cross-device reproduction subset
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
NEXT_PRIORITY: validate and merge #320 multi-worker runtime; then execute #315 real Benchmark Suite v1 / Baseline Run #1 on configured ZBook and MacBook workers
HUMAN_APPROVAL_PENDING: none for LOW/MEDIUM implementation; production, secrets, permissions, billing, destructive, governance-weakening, security-weakening, and external-publication gates remain in force
AUTO_FIX_ATTEMPTS_MAX: 3
MAX_ACTIVE_AGENTS: 3
MAX_PARALLEL_CODE_AGENTS: 2
MAX_ISSUES_PER_CYCLE: 2
