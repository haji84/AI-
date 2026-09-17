# Project State

PROJECT: General Autonomous AI / Unified AI Creator Studio / GAI Research OS
AI_COMPANY_VERSION: 1.0
PROJECT_VERSION: 0.0.0
CURRENT_PHASE: JARVIS #681 / #863 M0 Home Coordinator compatibility audit; Mac home candidate; updater/Android8/wake drafts retained
STATUS: JARVIS_PRODUCT_COMPLETION_IN_PROGRESS
LAST_UPDATED: 2026-09-17
CURRENT_EPIC: One-front-door general autonomous AI with durable offline-first device-neutral execution and verifier-driven completion
ACTIVE_ISSUES: JARVIS Product Completion parent #681 and #694 P3 reconciliation; Research Ops #321 / R1-R20 separate; historical #401/#609/#612 acceptance retained
OPEN_PRS: #858/#860/#862 draft stack retained; #864 draft Mac readiness audit; no deployment or enrollment interruption
BLOCKERS: #786 MSIX AppData startup root cause repaired operationally with native owner-profile release90a111b; Limited Windows task and four services running in session0, existing two Workers READY. Tailscale Running and private URL HTTP200 after explicitly approved unattended mode; routine Tailscale recovery standing approval recorded. Physical Windows reboot/AC-loss and #734 video replay remain unverified. See docs/evidence/786-native-startup.md. Owner requires firewall unchanged.
PRIORITY_OVERRIDE: Owner 2026-09-16 instruction resumes expanded JARVIS product completion #681 with ZBook main-host priority; preserve Human Gates and separate research evidence
NORTH_STAR_GOAL: Human gives one goal; the system determines required work, dynamically recruits available capabilities, executes, verifies, repairs, records, and completes with the fewest necessary human returns, including continued local work during connectivity loss where capability permits
HUMAN_GATE_INVARIANT: payment/purchase, destructive deletion, permission/credential changes, production deployment/publication, security/governance weakening, and all existing approval-required actions remain human-gated; autonomy, skill reuse, learning, team expansion, recovery, and self-improvement never grant permission
GAI_MODEL_POLICY: replaceable multi-model router; local/zero-incremental-cost paths preferred; pay-as-you-go AI API fallback prohibited by default
GAI_OFFLINE_FIRST_POLICY: network is an optional capability enhancer, not a survival condition; offline-capable local work continues, online-required work waits durably, and recovery triggers sync/conflict resolution/resume/re-verification
GAI_EVAL_POLICY: verifier/eval is cross-cutting; code/CI evidence and physical-device evidence are separate evidence classes and must never be conflated
GAI_AGI_CLAIM_POLICY: project-defined implementation or product acceptance never authorizes an AGI claim; independent external evaluation is required
GAI_COMMON_WORKER_RUNTIME: COMPLETE via Issue #559 / PR #560
GAI_INITIAL_WORKER_ADAPTERS: COMPLETE via Issue #561 / PR #562
GAI_GOAL_LOOP_WORKER_INTEGRATION: COMPLETE via Issue #563 / PR #564
GAI_DURABLE_TASK_RUNTIME: COMPLETE via Issue #565 / PR #566
GAI_OFFLINE_FIRST_RUNTIME: COMPLETE via Issue #567 / PR #568
GAI_SYNC_CONFLICT_RESOLUTION: COMPLETE via Issue #569 / PR #570
GAI_SELF_HEALING_RECOVERY: COMPLETE via Issue #571 / PR #572
GAI_PLANNER_ENHANCEMENT: COMPLETE via Issue #574 / PR #575
GAI_WORLD_RESOURCE_MODEL: COMPLETE via Issue #576 / PR #577
GAI_MEMORY_INTEGRATION: COMPLETE via Issue #578 / PR #579
GAI_SKILL_SYSTEM: COMPLETE via Issue #581 / PR #582 and certified-skill execution PR #585
GAI_DEVICE_CAPABILITY_INTEGRATION: COMPLETE in code/CI via PR #587 with physical iPhone verification completed
GAI_ANDROID_ADAPTER_PROOF: COMPLETE in code/CI via PR #589
GAI_SELF_HEALING_UI: COMPLETE via Issue #590 / PR #591
GAI_LOCAL_DEVICE_MESH: COMPLETE via Issue #592 / PR #593
GAI_DYNAMIC_MULTI_AGENT_RUNTIME: COMPLETE via Issue #596 / PR #597
GAI_CONTINUAL_LEARNING_RUNTIME: COMPLETE via Issue #598 / PR #599
GAI_SELF_IMPROVEMENT_RUNTIME: COMPLETE in code/CI via Issue #600 / PR #601; promotion remains gated by sandbox/eval/device evidence/canary as implemented
GAI_PRODUCTION_AUTONOMY_RUNTIME: COMPLETE in code/CI via Issue #602 / PR #603; implementation completion remains distinct from external production-readiness claims
GAI_PHASE_0_20_IMPLEMENTATION: COMPLETE via audit PR #605 and subsequent device fixes
GAI_PHYSICAL_IPHONE_E2E: PASS on exact main 553b58a40c0ce2bcd341911c84f06d969e1a6380; real task path observed QUEUED -> DELIVERED -> VERIFIED RESULT with physical=true; Issue #609 closed completed
GAI_IPHONE_AUTO_ENROLL_RECONNECT: PASS; stable Device ID, Bonjour discovery, bounded bootstrap, per-device Keychain credential, dynamic-port reconnect, durable delivery and signed result verification demonstrated on physical iPhone; Issue #612 closed completed
JARVIS_V1_ACCEPTANCE: COMPLETE; Issue #401 stages 1-8 are backed by merged implementation, CI acceptance, and physical Android evidence. PR #671 adds explicit 5-node mixed-fleet and 10-node scheduling/Human-Takeover acceptance; merge SHA 05ed22bf48de9f20e1bbac07858e420b5c0090a8
JARVIS_100_NODE_CAPACITY: PASS in deterministic CI; node 101 is rejected
JARVIS_PHYSICAL_ANDROID_E2E: PASS for the acceptance scope through real Android 001 resident-Broker/Worker execution evidence from PR #526 and follow-up hardening. This does not imply unverified physical wake/Device Owner/live-screen/real-offline claims
GAI_RESEARCH_OPS: SEPARATE_EVIDENCE_PROGRAM; Issue #321 and R1-R20 remain open until their real scientific evidence gates pass
GAI_NEXT_PHASE: Complete #681 P0–P10 using docs/JARVIS_PRODUCT_SPEC.md and docs/jarvis-requirements.json; keep #321 research separate
NEXT_PRIORITY: Verify local-video inference and per-device replay on neutral physical task; retain PARTIAL until actual end-to-end passes.
HUMAN_APPROVAL_PENDING: none for ordinary code/CI/device validation; production, secrets, permissions, billing, destructive, governance/security weakening, and external-publication gates remain in force
AUTO_FIX_ATTEMPTS_MAX: 3
MAX_ACTIVE_AGENTS: 3
MAX_PARALLEL_CODE_AGENTS: 2
MAX_ISSUES_PER_CYCLE: 2

JARVIS_COORDINATOR_MIGRATION: #863 M0 audit; 38 Android registry entries observed, durable snapshot stale; Mac/iPhone live inventory and canaries unverified. MIG-001–030 recorded. Mac read-only runs35205390167/35205560188/35205781413 PASS: M1 Pro16GiB/AC; Tailscale NeedsLogin, independent Mac registry1/tasks141, no UI build, legacy public tunnels, no reboot proof. Current Windows38 heartbeats stale and Wi-Fi changed subnet. See docs/audit/jarvis-mac-home-readiness.md. Next: reviewed tailnet auth and isolated shadow/endpoint/state preservation plan; no production cutover.
