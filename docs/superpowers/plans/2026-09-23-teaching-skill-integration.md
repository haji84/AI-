# Teaching correction -> durable Skill integration (#1192)

Parent #681/#882. Baseline ec39943125c9ca47b55cb6dcb537170b8b84a700.
Owner requests completing remaining implementation; ordinary work proceeds within existing scope.
Physical-facing changes remain in passing unmerged PR until physical acceptance.

## Design and sequence
1. Add optional learning journal to existing teaching variants. Preserve immutable observed-step archive, explicitly marked mistake and retry events. A normal navigation action is never automatically an error.
2. Owner marks last recorded operation for correction through the current authenticated Remote Assist route. Pause capture until the actual previous screen, device and application profile return; do not auto-undo or retry inputs.
3. Wire successful server-side replay to PersistentSkillLibrary. Store only bounded variant/device/profile/hash references, never raw input/screen content. First independent verify creates a candidate; a separate passing verify certifies. Failure quarantines affected Skill.
4. Reuse GaiSkillContextSource and VerifiedSkillWriteBackStore in the actual work-state Goal Loop factory/runtime adapter. Certified Skills remain data and never grant capabilities. Surface persistence failure separately from device execution result.
5. Verify correction provenance, restart, failed and spoofed verification, per-device eligibility, duplicate write-back, concurrent persistence, owner/session denial; run full unit/integration/P8/lint/build and browser UI check.
6. Update ledger/evidence without PHYSICAL promotion; independent review, PR/CI, parent write-back. Keep physical-facing PR unmerged.

No Worker re-enrollment, key/credential update, DB schema migration, permission/billing or production configuration change.
Rollback code, retaining additive teaching/Skill data; prior teaching records remain readable.
