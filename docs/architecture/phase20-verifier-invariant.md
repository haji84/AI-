# Phase 20 verifier completion invariant

When a bounded command completes through an action, Phase 20 accepts completion only when the underlying Goal Loop supplies a passing verification result. A planner returning no next action can terminate the Goal Loop without an action-level verifier; that existing semantic is preserved and is not converted into fabricated evidence.

Any action-backed completion lacking verifier PASS is treated as blocked by the Phase 20 coordinator rather than reported as successful.
