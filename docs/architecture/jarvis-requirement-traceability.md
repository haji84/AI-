# Reverse requirement traceability (#1205)

Repository-only audit of JARVIS production-capable surfaces. The index binds each file's bytes to canonical requirement parents or a sourced exclusion. A parent link says what behavior owns the implementation, not that the behavior is complete, connected, secure or physically verified.

Coverage: src/jarvis, src/gai, src/app/jarvis, src/app/api/jarvis, scripts/jarvis*, Android main sources/config, iOS Worker, docs/architecture. Colocated tests are excluded. This is the explicit audit boundary, not a claim that every repository file or unmerged branch has been classified. Future expansion into all orchestration/providers/owner-auth routes is a remaining audit task.

Every new/changed/removed surface inside that boundary must reconcile its exact index entry. Run node scripts/jarvis-requirement-audit.mjs --check. The ordinary node --test suite invokes the same validator, so existing CI detects missing/stale mappings without workflow permission changes. There is intentionally no blind re-baseline command.

Accepted owner decisions have explicit source and history. IDEA/PROPOSED do not authorize implementation; ACCEPTED_REQUIREMENT without SPEC_SYNCED fails the repository gate. Synced decisions bind both canonical documents and their requirement definition fingerprints. Supersede links must be reciprocal and acyclic; old decisions remain. IMPLEMENTED/VERIFIED cannot exceed canonical status/evidence. Protected changes always leave this automatic contract for a separate Human Gate.

Trust boundary: these records are reviewed repository artifacts supplied by the owner/Codex workflow. A source URL/hash is provenance, not cryptographic proof of owner identity. Web/PDF/tool content cannot populate accepted records as authority. No network lookup, model-generated permission, automatic physical promotion, or production config edit occurs here.

The checker is wired into repository CI. Live conversation ingestion, authenticated runtime acceptance receipts, semantic matching/conflict resolution and automatic specification PR creation remain unimplemented under #1205; this contract must not be advertised as those runtime features.

Research Ops remains a separate #321 track. Earlier Creator Studio architecture documents are retained as historical/separate product records, not silently deleted. Legacy Commander/Mac scripts are mapped as compatibility surfaces; a mapping does not attest that they meet current security/operations acceptance.
