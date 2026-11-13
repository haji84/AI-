# Shared Change Set journal connection

Goal: retain failed/repaired candidate metadata in the SAME existing encrypted checkpoint and make it injectable into the existing ResidentDevelopmentGoalHost without adding a controller or authority. Issue #1219; PR #1910 parent1ba7fa6.

Selected approach: explicit imported ChangeSet baseline and append-only updates in existing checkpoint events. Reuse root CAS/lease and existing Goal/Job/work-item identities. Subclass the existing concrete ChangeSet store and override its complete public get/list/put surface; its constructor performs no IO. This preserves the actual host's nominal type contract and all existing local defaults without editing canonical domain source or traceability hashes.

Rejected alternatives: add another Goal/controller; create an empty replacement when original state is unread; use a local-only store on a hosted runner and call it shared authority; weaken verification or silently activate new credentials.

- [x] Read current GitHub main/PR/CI/AGENTS/project/roadmap/Issue/ADR and affected contracts.
- [x] Create failing tests before implementation: final design24FAIL/1baselinePASS.
- [x] Implement explicit shared journal, concrete adapter and typed existing-host persistence factory.
- [x] Run25 local tests, all PASS; preserve failure evidence and exact code hashes.
- [ ] Complete exact-new-HEAD full repository CI and typecheck before acceptance.
- [ ] Connect approved original state, runtime factory and actual distinct-Actions execution.

No production state/key/bootstrap API in this change. No mandatory independent code review or additional account. Actual tests/result integrity/Human Gates remain. The memory/file fixtures and two-process readback do not prove production distributed recovery. Full artifact bytes, authority import, canonical runtime selection and wakeup remain explicitly unfinished.

Rollback removes only unused new module/tests/docs. Existing local store/host and original data are unchanged.
