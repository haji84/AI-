# Requirement reverse audit (#1205)

Base main: 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa. Second issue in this scheduled cycle; #1207 remains physical-held.

Plan: enumerate the declared JARVIS/GAI/UI/API/Android/iOS/scripts/architecture surfaces, record exact path/hash and canonical parent or explicit separate-track/historical exclusion; fail visible for missing or stale rows. Existing direct implementation_refs are evidence of parent mapping, not functional verification. Review additional parent mappings by component purpose; do not inflate requirement count or change status.

Add a repository-integrated accepted-owner-decision contract and checks: explicit acceptance/provenance, IDEA/PROPOSED distinction, exact canonical linkage, supersede history, protected change gates, spec/matrix equality, and no VERIFIED without required evidence. This slice does not claim NLP semantic extraction, live-chat ingestion or automatic production changes. Those runtime integration gaps remain explicit under #1205.

Use unit/adversarial fixture mutations plus the actual-tree CI-discovered test. Confirm the original 340 IDs/statuses/evidence classes remain unchanged. Produce a machine-readable audit and exact GitHub evidence. Risk LOW/MEDIUM: documentation/test validation only; no production Worker path or credentials changed.
