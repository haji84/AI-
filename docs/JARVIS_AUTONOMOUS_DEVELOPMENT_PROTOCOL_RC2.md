# JARVIS Autonomous Development Protocol v1.0-RC2

Status: Release Candidate. This protocol governs AI Company development and JARVIS self-development. It supplements AGENTS.md; safety and approval controls remain authoritative.

## Objective

The system optimizes for verified Goal achievement inside a bounded safety envelope. A failed job, implementation, tool, model, or plan does not by itself fail the parent Goal.

## Core loop

1. Lock Goal, success criteria, constraints, and non-goals.
2. Observe current state, evidence, previous attempts, failures, and remaining gaps.
3. Decompose into the smallest useful jobs/subgoals.
4. Plan a strategy and state how it differs from failed attempts.
5. Derive risk/change-specific gates.
6. Route required capabilities without hard-coding a provider.
7. Implement the smallest useful reversible change.
8. Test and verify with trusted evidence.
9. Evaluate verified Goal progress.
10. If not achieved, diagnose failures/blockers and choose the next best strategy.
11. Continue through safe recovery/replan/research/alternate capability paths.
12. Escalate to Human Assistance only when safe autonomous resolution is unavailable; use Human Gate whenever approval policy requires it.
13. Finalize only after Goal success criteria, required gates, post-test, evidence, and write-back pass.

## Autonomous recovery

Recovery strategies include targeted correction, diagnostic/reproduction experiments, additional research, alternative implementation or architecture, alternate available capability/provider, job decomposition, rollback plus replan, and requirement clarification when authoritative project context cannot resolve material ambiguity.
Each attempt records strategy/hypothesis, changes, capabilities, result, Goal progress before/after, failure signature, root cause status, and evidence. Repeated materially equivalent failures without new evidence are prohibited; stagnation triggers strategy escalation.
Root cause may be CONFIRMED, PROBABLE, or UNKNOWN. UNKNOWN still permits logging, instrumentation, sandbox work, reproduction, research, and reversible diagnostic experiments, but not unsupported irreversible production correction.

## Evidence and authority

Evidence classes are MACHINE_VERIFIED, HUMAN_VERIFIED, and AI_ASSERTED. Critical gates may not pass on AI_ASSERTED evidence alone. Evidence records trusted issuer and, where applicable, revision, artifact hash/provenance, environment, and timestamp. Material changes invalidate affected stale evidence.
For HIGH/CRITICAL risk, Builder, Final Verifier, and Gate Authority are separated. State transitions are committed only by the State Controller. AI/model confidence alone cannot satisfy a gate. Verified and deployed artifacts must match where artifact identity applies.

## Human interaction

Human Gate asks permission for an action reserved to the owner. Human Assistance requests information, authority, or capability that cannot be safely obtained or inferred from authoritative project context, and is a last resort after safe autonomous alternatives are evaluated.
Goal persistence never bypasses Human Gate, Security Gate, approval scope, or non-bypassable governance controls.

## Persistent records

Preserve PRODUCT_SPEC/requirements, PROJECT_STATE, DECISION_LOG, EVIDENCE, GOAL_STATE, ATTEMPT_HISTORY, CAPABILITY_HISTORY, and FAILURE_HISTORY in the appropriate repository/runtime stores. Chat history is not project truth.

## Completion

A Goal becomes ACHIEVED only when required success criteria are supported by valid evidence and constraints remain satisfied. Merge, deployment, a green CI run, or an individual Job DONE is insufficient by itself.

## Self-modification

JARVIS and AI Company use this same protocol when modifying themselves. Material weakening of this protocol, gate/state authority, verifier/security enforcement, Human Gate policy, or audit/evidence integrity requires a non-bypassable Human Gate.
