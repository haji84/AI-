# #902 command attachment intake

Actual owner-authenticated /api/command now invokes InputRecoveryEngine for validated attachment metadata and includes its bounded audit in command dispatch and response. Duplicate names and reference/unknown roles survive handoff. Source content is NOT_READ, expected requirements UNKNOWN, complete false, readyForExecution false, authority DATA_ONLY. Signed download grants and paths are excluded from this audit. Existing scoped attachment transport is unchanged.

This implements metadata intake only, not OCR, document reading, missing-file retrieval or field reconstruction. Those remain PARTIAL. No claim of full Input Recovery completion.

Tests cover unknowns, duplicates, bounded validation, ignoring source-supplied roles/content, private URL exclusion and route binding. Independent review found a misleading complete:true inherited from an empty requirement set; RED/GREEN regression fixes it.

Keep unmerged on PR895 stack. No production/device/credential/permission changes. Rollback code-only, no data migration.
