# Phase 20 failure truth

The coordinator never converts `blocked`, `approval_required`, `paused`, bounded cycle exhaustion, or action-backed completion without verifier PASS into success. This is the final guard against a dashboard-level false-green result when lower layers have not actually completed the goal.
