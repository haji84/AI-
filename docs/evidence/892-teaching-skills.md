# #892 — explicit correction memory and reusable teaching Skills

Parent #882/#681. Stacked on #890; keep unmerged. No device/app/identity/credential/Production mutation. No physical PASS.

Owner-authenticated teaching API and UI now record mistaken variant → corrected variant with source digests, same original device/profile/scope/goal, correction category and owner provenance. Original observations/runs stay byte-identical. Correction cycles, conflicting replacements, cross-device links and unfinished target recordings fail closed. Derived validation rules refer to the corrected variant and provenance; they do not invent semantic understanding.

Skill save requires three distinct complete original-device verification runs. Saved references retain source digest and exact run IDs; reuse revalidates the source, history, correction state, device/profile and existing Remote Assist authorization. The actual teachingCommand path uses the saved reference and all existing screen/profile/permission gates. Superseded steps are excluded. Per-input and pre-completion rechecks close the correction-during-observation race found by independent review (red input count1, fixed0).

Storage: additive bounded atomic sidecar next to teaching.json, or JARVIS_TEACHING_LESSONS_PATH. No DB migration. Lock file enforces one writer; corruption and capacity failures surface. If a process crashes holding the lock, reads and unrelated work remain available but lesson writes fail closed. Recovery requires stopping all writers, backing up/validating the JSON, removing only the orphan .lock, then restarting. Never remove a live writer lock. Automatic multi-host lock recovery is NOT implemented.

Explicit correction is supported; arbitrary video-only mistake detection and universal automatic skill synthesis are not proven. Skills are references to guarded teaching procedures, not new execution permissions or generic code. Required PHYSICAL evidence and full semantic-learning requirements remain PARTIAL.

Validation: focused lesson tests9 pass; full regression, P8, lint/build and CI tracked in issue/PR. Isolated real browserAPI:401 unauth,201 Skill save,201 correction save,200 read, mobile390x844/desktop1440x1000, no page errors, original store unchanged. These are virtual tests. Browser initially found Origin vs internal Next URL mismatch; Host-bound comparison now accepts private proxy paths while rejecting foreign Origin and untrusted X-Forwarded-Host.

Rollback code only; retain original teaching history and additive lesson sidecar. No data deletion is required.
