# #888 — Teaching learning integration (candidate only)

Parent #882/#681; stacked on #887/#889 and #884. Not deployed; no physical PASS.

The real owner-authenticated `GET /api/jarvis/teaching` now derives learning candidates from existing durable TeachingStore observations using DemonstrationLearningEngine. The teaching library displays candidate status. Restart derives the same candidates without writing a new schema or touching device registration.

Candidates contain hashed targets, workflow steps, source digest and matching verification run IDs. Manual/gated/incomplete recordings need validation. Only three distinct completed verification runs on the original device/profile, a matching stored verification pointer, and no failed/uncertain relevant runs yield VALIDATED. This is historical navigation reproduction evidence, not a business-goal guarantee, physical certification, Skill promotion or execution permission.

The legacy observation format does not record explicit correction relationships: correctionState stays UNKNOWN. No raw manual notes are copied into inferred rules. Existing owner-authorized variant display is retained. Model confidence never grants authority. Candidate derivation does not run a device command, contact an external model or mutate stored history.

Regression/integration/security tests cover auth before store reads, errors without disclosure, durable restart, no store mutation, same-device/profile filtering, distinct run IDs, failed-run invalidation, incomplete/manual steps and actual route/UI binding.

Remaining: explicit mistake/correction provenance, validation-rule proposal acceptance and scoped Skill persistence/promotion. Full teaching requirements remain PARTIAL.

Rollback: revert code/UI additions; original teaching data format is unchanged.

Local verification: full 1027/1027; P8 52/52; full lint and build PASS. Independent review: no blocking findings. Browser QA: real isolated API returned401 without auth and200 with ephemeral test auth; candidate visible at390x844 and1440x1000; no page errors, store byte-identical. Mobile screenshot visually inspected. This is virtual evidence only. Remote CI pending.
