# GORIQ Goal / Job / attempt checkpoint: bounded atomic source step

Date: 2026-11-12 JST. Issue #1219, successor PR #1910.
Existing main: 8ead188ffc374c0204f20798ac8258af07272bdc.
Prior PR head: d753986226de25c874333f6ca1e152ae8ed54570.

## Goal and constraints
An owner-authenticated real Goal, its WorkRun, persisted Jobs (including each Job's transition history), and the complete captured attempt/event records must be retained with the current coordinator lease on ONE conditional Git blob update. No new controller, alternate authority, Goal recreation, implicit migration, runtime key, permanent Mac/ZBook requirement, mandatory code-review account, production deployment or scope change. Side-effect fencing and live owner authority remain separate acceptance gates.

## Approaches
1. Separate lease and Goal files: rejected because two independent PUT operations do not form an atomic transaction.
2. GitHub Actions artifacts only: rejected because artifacts are not an authoritative transactional store and may expire.
3. **Selected: extend the existing opt-in GitHubCoordinatorStore** to read a versioned encrypted bundle in its existing state/coordinator.enc.json; preserve legacy lease-only mode without an implicit upgrade.

## Implementation and tests
- [x] RED: new Goal-checkpoint tests initially failed with missing loadCheckpoint.
- [x] Add versioned encrypted checkpoint (Goal content/digest, WorkRun, durable Jobs including per-Job histories, attempts, events) alongside the existing coordinator lease.
- [x] Ensure lease CAS preserves checkpoint bytes and checkpoint CAS validates current lease/fencing claim, immutable Goal, no removed or rewritten attempt/event/Job history, one exact Git SHA, and independent ciphertext readback.
- [x] RED: same-epoch history replay test failed against the initial implementation. Add in-process high-water rollback guard and retest.
- [x] Local Node22.16.0 focused tests: 50 PASS / 0 FAIL / 0 SKIP, including the original 41 coordinator tests.
- [x] Local strict focused TypeScript5.8.3 check: exit 0 using exact coordinator source and locally reconstructed minimal type declarations. This is NOT full-repo/pinned-Node typecheck.
- [ ] Full exact-HEAD repository CI including six-check verifier.
- [ ] Authorized import of authenticated original Goal/Job, protected GitHub state branch and externally provisioned key/permission/freshness anchor.
- [ ] Complete unbounded event history archiving: current checkpoint is fail-closed at 6,500 UTF-8 bytes and does not prune; cannot yet support unlimited records.
- [ ] Existing runtime wiring, atomic external side effects, separate-run/host recovery, real model repair, next Job, artifact verification.

## Security and rollback
Legacy lease-only encrypted records return CHECKPOINT_MISSING and are not converted or used as source of Goal authority. Missing state, short/invalid digest, stale fencing token, expired claim, hash mismatch, old-history replay or GitHub SHA conflict cannot assert successful persistence. The injected store remains OFF until appropriately authorized and provisioned; no secrets, credentials, branch config or production state mutated. Source-only rollback reverts this commit, leaving previously recorded attempts and runtime state untouched.

Evidence (local source/fixture only):
- Source SHA256 73280474628710d0578148980e332d585407c20b221880efcc15c12520a6159f
- New tests SHA256 1a55ca35e653a9b0d39bbb3e677dfeb16ab09b8269b1a7a133d83f9c009ebf61
- Initial RED log SHA256 a26d9004bca565dd6792f7b8df6e11efe71d00b86de4b5715810e25516ce0bf9
- Replay RED log SHA256 0b7790a377958cfde6757386176e5406303e30cd517683dfbd1003af2044e6fe
- Final GREEN log SHA256 2d94b318b62b1b52334d45116833cc7fd8026ec8f533111964eee9254c97eaf7
