# GORIQ immutable Goal history and checkpoint-store adapters

Date: 2026-11-13 JST | Issue #1219 | existing PR #1910 | parent HEAD 6f9a6797cfc771071f97e876381f0536d7233f27

## Fixed requirements
- No permanently available MacBook or ZBook for eligible GitHub-hosted Jobs.
- No required second GitHub account, external code reviewer or AI-09 reviewer.
- Preserve existing Goal Controller and authenticated source Goal. Never bootstrap, recreate, overwrite or resume an unverified original Goal.
- Maintain real test/Verifier, pause/approval/budget gates, credential isolation, and protected release rules.

## Design implemented in this source candidate
1. Keep the existing encrypted coordinator root at `state/coordinator.enc.json` as the sole CAS/fence publication point.
2. When a Goal checkpoint exceeds the former 6,500-byte application limit, stage AES-256-GCM encrypted snapshot parts at immutable `state/history/<sha256>.enc.json` paths on an explicitly authorized `goriq-state/...` branch.
3. Each part uses a cryptographic path digest, Git blob SHA readback, ordered index, preceding-part link and preceding-revision head, and repository/branch/cluster-bound encryption. The root stores a small encrypted `schema:3` pointer. Publish only after every part has been verified.
4. A failed chunk upload leaves the previous root unchanged; on root CAS conflict refuse publication, without destroying prior history. Never delete or truncate prior attempts or events.
5. Add optional adapters for existing WorkRunStore, DurableTaskStore, and DevelopmentJobStore to read/write via that same checkpoint/lease claim. No alternate Controller, scheduler, automatic migration or runtime activation.
6. Refuse blind save, absent authenticated DevelopmentJobSnapshot, stale WorkRun, old lease/epoch/fence, mutable historical entries, and unverified Goal/Job scope.

## Evidence and current limits
- Isolated Node 22.16.0 source tests: 66 PASS / 0 FAIL / 0 SKIP; RED first for missing history archiving and DevelopmentJob field. Focused strict TypeScript check: exit 0, using partial type fixtures. The full pinned Node 24 CI must be checked at the new exact HEAD.
- HTTP is mocked for the new tests. Crypto, serialization, existing coordinator runtime and checkpoint CAS are real; no actual GitHub state branch, owner key or live Goal was used.
- No application-level fixed number of history parts; actual GitHub rate/storage/runtime quotas and full-snapshot rewrite cost remain. This is NOT a mathematical promise of infinite storage or a measured production-scale archive.
- A full snapshot is staged each update rather than compact delta pages; optimize only with evidence after safe source acceptance. Root-pointer loss, branch rollback between fresh processes, and external side-effect fencing still need trusted cross-run proofs.
- The DevelopmentJobStore adapter does not import a missing live owner record or admit a new Job by itself. The production State Controller must supply valid admitted Job and authority.
- Not connected to the running Broker/GoalController/hosted wake scheduler. No original Goal/Job imported or completed, no live signing key created or changed, no production configuration/workflow/main mutation.

## Next gates
1. Inspect this commit's exact-HEAD CI and repair only actual failing checks.
2. Use already-authorized authority/credential scope for safe original Goal import and trusted cross-process epoch floor, or remain HOLD.
3. Connect the adapters at existing Broker/GoalController/Resident state boundaries without removing pause/Human Gates and without allowing stale-owner side effects.
4. Demonstrate real GitHub HTTP save, different Actions run readback and failover, genuine model failure and different repair, verified result, successor Job and usable artifact E2E before declaring the original Goal complete.

Rollback: revert only this unused source/test/doc change; retain every historical Goal, Job, attempted repair and prior CI evidence.
