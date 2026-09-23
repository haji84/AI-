# Requirement reverse audit (#1205)

Base main: 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa. Second issue in this scheduled cycle; #1207 remains physical-held.

Plan: enumerate the declared JARVIS/GAI/UI/API/Android/iOS/scripts/architecture surfaces, record exact path/hash and canonical parent or explicit separate-track/historical exclusion; fail visible for missing or stale rows. Existing direct implementation_refs are evidence of parent mapping, not functional verification. Review additional parent mappings by component purpose; do not inflate requirement count or change status.

Add a repository-integrated accepted-owner-decision contract and checks: explicit acceptance/provenance, IDEA/PROPOSED distinction, exact canonical linkage, supersede history, protected change gates, spec/matrix equality, and no VERIFIED without required evidence. This slice does not claim NLP semantic extraction, live-chat ingestion or automatic production changes. Those runtime integration gaps remain explicit under #1205.

Use unit/adversarial fixture mutations plus the actual-tree CI-discovered test. Confirm the original 340 IDs/statuses/evidence classes remain unchanged. Produce a machine-readable audit and exact GitHub evidence. Risk LOW/MEDIUM: documentation/test validation only; no production Worker path or credentials changed.

## Continuation: authenticated intake and executable sync gate

Baseline 5dd7f2c; main9cbf6ac. Reuse #1205/#1213. Risk MEDIUM: owner work intake and completion reporting, isolated candidate only. Preserve existing auth and device state. No schema, permission, deployment or model-provider change.

1. Reproduce actual Broker double-body-read failure over authenticated HTTP.
2. Capture explicit owner decisions on the authenticated work ingress; distinguish examples/questions/proposals, bind immutable statement/hash/Goal/idempotency, retain supersede/withdrawal history in existing Compass state. No caller-supplied sourceContext grants authority.
3. Match existing canonical IDs exactly or rank candidates as suggestions; ambiguous/unmatched/contradictory changes remain review work. Generate a bounded reviewed specification handoff, never infer permission from a similarity score.
4. Add a durable completion gate independent of ordinary executor results; accepted unsynced requirements prevent Goal/WorkState completion across restart. Only local validated canonical reconciliation releases the gate; no HTTP specSynced flag.
5. Add repository proposal tooling which validates both ledgers, provenance and base hashes, preserves status/evidence and creates reviewable candidates. Integrate explicit bounded Work/Codex handoff; no blind main writes or auto-merge.
6. Expand explicit reverse audit ownership to modified orchestration/auth paths and test actual Broker/restart/adversarial/gate paths. Full tests, security, lint, build, independent review, exact CI and write-back. Keep candidate unmerged where production review is pending.

Rollback: revert candidate code together, preserve adopted decision history and canonical documents; never erase pending decisions merely to clear a completion block.
