# GAI Research OS

## Mission
Evolve the existing AI Company into a measurable, self-improving general autonomous intelligence research platform while preserving the existing safety gates and zero-additional-AI-API policy.

## Non-claims
This project does not claim to have achieved AGI. Progress is accepted only when measured by reproducible benchmarks and held-out evaluations.

## Core loop
Goal -> Plan -> Predict -> Act -> Observe -> Verify -> Learn -> Abstract -> Transfer -> Improve -> Re-evaluate.

## Model strategy
- Astra tier: research-critical, frontier-reasoning, novel/unknown tasks when available inside the existing ChatGPT plan/runtime.
- Sol tier: primary high-quality reasoning and verification.
- Local tier: routine, repeatable, memory, classification, extraction, and always-on work.
- Pay-as-you-go external AI API fallback is prohibited by default.
- Model access must remain replaceable behind a common router contract.

## Cognitive architecture
1. Goal Manager
2. Planner
3. Working Memory
4. Episodic Memory
5. Semantic Memory
6. Procedural Memory
7. World Model
8. Tool Router / Executor
9. Verifier
10. Continual Learning
11. Self-Improvement
12. Benchmark Harness

## Memory rule
Raw history is not sufficient. Experiences should be transformed into reusable rules only when evidence and confidence thresholds are satisfied. Working, episodic, semantic, and procedural memories remain distinct.

## World-model rule
Every meaningful autonomous action should be representable as prediction + observation + prediction error + lesson. The platform should learn from mismatches instead of merely storing transcripts.

## Self-improvement rule
A proposed change is never promoted solely by self-critique. It must run in an isolated candidate path and improve held-out benchmark performance without violating safety, reliability, or cost constraints. Regressions are rejected.

## Human Gate
LOW: reversible local/repository work may execute autonomously.
MEDIUM: execute inside bounded/sandboxed paths with verification.
HIGH: stop for explicit human approval.
CRITICAL: do not execute autonomously.

Existing protections around production publication, secrets, credentials, permissions, billing, destructive actions, governance weakening, and security weakening remain Human Gate or blocked.

## Initial measurable target
The first research milestone requires at least 100 unknown-task cases and targets:
- >= 80% task success
- < 10% human interventions per task
- measurable second-attempt improvement from retained experience
- positive held-out score after accepted self-improvement
- explicit transfer-task measurement
- zero incremental pay-as-you-go AI API cost

## Platform targets
The control surface should remain usable from iPhone, Android, macOS, and Windows through the existing web/dashboard approach. Compute-heavy or local-only work can remain on the workstation, while mobile clients act as command, inspection, approval, and progress surfaces.

## Integration with AI Company
The existing orchestrator, risk policy, Compass state, dashboard command ingress, bounded runner, GitHub workflow, provider abstraction, and agent-role system are retained. GAI modules extend rather than replace them.

## Implementation sequence
Phase G0: contracts, routing, benchmark primitives, guarded learning and self-improvement.
Phase G1: four-layer persistent memory and retrieval.
Phase G2: prediction/observation world-model store.
Phase G3: planner integration and transferable skill library.
Phase G4: benchmark harness with unknown and transfer task sets.
Phase G5: model adapter/router integration for plan-included frontier models plus local inference.
Phase G6: bounded autonomous research loop.
Phase G7: candidate self-modification in sandbox with held-out acceptance.
Phase G8: continual-learning experiments and regression protection.
Phase G9: cross-device GAI dashboard and research telemetry.
Phase G10: long-horizon evaluation, external benchmark adapters, and AGI-gap report.
