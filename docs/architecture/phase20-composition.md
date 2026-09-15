# Phase 20 composition contract

Composition supplies a `GoalDrivenLoop` per durable run id. This lets the application bind the existing planner/context sources, capability/team executor, verifier, state store and approval policy to their existing durable stores. The Phase 20 runtime neither knows nor selects concrete device IDs; capability routing stays below the Goal Loop executor boundary.
