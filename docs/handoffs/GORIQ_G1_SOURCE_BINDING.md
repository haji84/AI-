# GORIQ G1 continuation: bind selected readback to actual source and store

Existing Issue #1219; execution order is the owner's saved plan at https://github.com/haji84/AI-/issues/1219#issuecomment-6857508059. Original Goal remains NOT_ACHIEVED. This document supplements, not replaces, the full current handoff and its retained failure history.

## Baseline and reason

Read main ae0e2fafc602103ed24cc9bf7d4d089994a2b119, tree f13048016c83a4d75c2a3bc7a0b9794cb77124c1. Main CI43373686076 has four successful jobs. No reason to re-fix the already merged lock and Change Set write-fence work.

G1 precedes activation of G3. The selected original Goal/Job request previously authenticated the owner but returned HTTP404. The current Broker route returns 404 before examining the canonical Goal if WorkRun is absent. Therefore 404 does not prove deletion or authorize a replacement Goal. Existing reference identifiers remain goal-fcc81c97e09153f7 / rotation-recovery-37; do not recreate them or substitute another current Goal.

## Bounded source change

The existing read-only probe CLI now invokes scripts/goriq-owner-store-observation.mjs ONLY after its authenticated, explicitly selected broker Goal request returned HTTP404. Its probe function, authentication, GET requests, request count, result/authority checks, and HOLD/exit2 behavior remain byte-identical. Success, generic probes, unauthenticated requests and other errors perform no native inspection.

The observer binds a single loopback8787 listener to the same owner UID, its cwd/source, and its open Compass file. It uses bounded fixed lsof/ps/git read commands, never a shell command from input. Source fingerprints compare on-disk bytes to the checked-out reference; loaded runtime bytes are explicitly NOT attested. Configuration-derived paths are not claimed to be the running process environment. Ambiguous/multiple/foreign/changed processes or unknown stores stay inconclusive.

SQLite is opened readOnly/query_only inside a read transaction; no migration, record write or Goal creation. The bounded projection distinguishes canonical Goal presence, selected-Goal match, selected WorkRun count/phase, stop status and selected Job count/phase. No Goal text, raw DB JSON, private path, token, environment, process argv or exception text is returned. No new credentials, permissions, key, state branch, server restart, deployment or workflow definition is created. Existing Mac-hosted recovery observation is a one-time existing-source inspection, NOT a permanent Mac prerequisite for hosted work.

## Executed local proof

Isolated PARTIAL Node22.16 workspace, not a full clone. New tests written before implementation: first stub run20 cases =>14 fail/6 pass; after implementation20 pass. Existing CLI wiring regression initially failed (20 pass/1 fail), then passed after actual CLI connection. Final npm test in this partial workspace:25 pass/0 fail/0 skipped. Node syntax checks pass. Real temporary SQLite/source/Job files and a real child Node CLI are used; native Mac command outputs and HTTP are fixtures. Real Mac/owner Goal acceptance is NOT claimed.

Exact tested Git blobs:
- scripts/goriq-owner-store-observation.mjs: a16ce2856c07c56dceea4044f1f1dbdcc261c9b2
- scripts/goriq-ai09-live-broker-builder-probe.mjs: 0228af45ccfe690aeedc559ec7b28eb5bf2e8f4e
- tests/owner-store-observation.test.mjs: a8eca7d3c80134d8850f23b735fe3ef0eadddfd5
Original probe blob beb88b910144d162c88854d90f5ac74c14b3f5bd. Everything before its CLI invocation is byte-identical.

## Next execution and remaining gates

Require this new SHA's full CI; do not use the baseline pass as its result. After eligible protected-main source integration, the existing selected owner-broker workflow job can execute the new checked-out probe with the user's already preserved input. Verify actual checked-out SHA in the log: reruns retain their original event SHA, while this workflow explicitly checks out/current-checks main. Do not request input again or rerun unchanged generic connection checks.

Read the native result before deciding whether the actual cause is source mismatch, different configured/open store, absent selected WorkRun, different canonical Goal, or missing selected Job. Any actual state import/credential provision remains subject to original authenticity and approval boundaries. G1 stays HOLD until real authenticated original state is recovered. G3 shared-store activation, G2/G4 hosted intake/wakeup and G5-G13 real execution/recovery/artifacts remain unproved.

Rollback: revert only this CLI hook, observer and its tests. No production data migration exists to reverse. Independent CODE review/AI09/another account are optional, not blockers. Preserve all existing tests and genuine Human Gates.
