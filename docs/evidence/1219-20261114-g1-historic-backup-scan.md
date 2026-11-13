# GORIQ #1219 | G1 historical state source inventory (2026-11-14 JST)

Source baseline: protected main `2a229b58b31d5d423ce065650829f9cb73adac3a`. Original Goal `goal-fcc81c97e09153f7` and Job `rotation-recovery-37` have NOT been authenticated in an historical backup or imported to the production shared store. Issue #1219 was erroneously Closed while NOT_ACHIEVED and was reopened before this source work.

## Evidence and limited hypothesis
The authenticated current Mac Broker reports its active Compass has no current Goal row nor a WorkRun envelope; a prior selected GET returned HTTP404. This does **not** demonstrate deletion from other paths or retained backups. The current managed `LocalStateBackups` stores only Broker and Compass SQLite, not the separate `self-development/jobs.json`, `change-sets.json`, other attempt artifacts, or credentials. Thus, a matching Compass backup alone does not prove complete Goal recovery.

## Read-only G1 probe, no state migration
`scripts/goriq-g1-backup-inventory.mjs` uses only known owner-home locations and independently provisioned, literal owner-env database paths. It never evaluates an env file, executes shell input, creates a backup, edits files, restarts a service, accesses credentials, or emits raw records/pathnames. Only the exact selected historical Goal and Job are compared. Existing managed backup generations are inspected only after private ownership/no-symlink checks, catalog metadata+manifest size/SHA256 validation and readonly SQLite `PRAGMA quick_check`; count of matched Goal row and WorkRun is returned, never private text. The separate local Job and Change Set sidecars are inspected only at the existing derivation path, up to four megabytes, with matched identity and attempt counts only. No scanner output is an authority for import or execution.

The existing `.github/workflows/goriq-broker-db-inventory.yml` is extended *only* on its already deployed Mac inventory path, checkout restricted to protected current main with contents:read, and triggers on this script/workflow path on main push. It requires no permanent MacBook; if the existing self-hosted Mac runner is offline, the inventory cannot be represented as executed. No other runner paths, tokens, permissions or services change.

Fixture tests: `node --test tests/goriq-g1-backup-inventory.test.mjs` 9 PASS / 0 FAIL on Node22.16 (real temporary SQLite and private generation files, corrupted manifest, symlink, backup/active divergence, sidecar counts, env-file non-evaluation, public output privacy, exact workflow wiring). These are LOCAL tests only; production backup match and full pinned GitHub CI are not yet proven. The prior exact merged-main CI #43469691893 had independent restricted-container FAILURE; do not claim it passed or silently increase its limits.

## Acceptance decision after actual GitHub/mac inventory
- `matchingGoalBackups > 0`: a candidate exists. Treat G1 as HOLD until the actual archived Goal contract/DoD/identity, separate Job/attempt/Change Set/artifact files, timestamps and approval scope are verified together. Do not upload private backup bytes to public GitHub.
- `matchingGoalBackups == 0`: inspected roots had no match. This is NOT evidence of global loss; inspect additional trusted owner backup inventories only with the owner's existing authority, then report remaining unknowns.
- `PARTIAL_CATALOG`, `CATALOG_UNSAFE`, `UNAVAILABLE` or offline runner: inconclusive; never restore or replace the original Goal from GitHub issue prose.

Next: inspect the actual read-only Action output on exact protected main, correlate any candidate with sidecar/attempt provenance locally, then perform approved G3 shared-store import and distinct-Actions run recovery. No new Goal, account, key, token, permission, controller, deployment, paid service or code-review approval was created by this diagnostic.


## Addendum: correct default historical Compass candidates

The actual listener-bound Compass inspected on 2026-11-14 02:08 JST has the SHA256 fingerprint for the Mac persistent state path `~/.goriq/state/compass.db`. The first scanner version guessed only `~/.goriq/state/jarvis.db.compass.sqlite`, risking a false negative. The corrected scanner checks `compass.db` and the legacy variant for that Broker root; likewise the separate canonical repo root. It counts each managed backup generation at most once and does not claim historic Goal recovery based on an empty current database. Added fixture #10 validates path selection and no duplicate backup count. Corrected code/test blobs: 326e8c2bad921e6b4d8d524ff2d4c3d1deb8af62 / a73c9cb59eedd4bc26f75215a8c0ab1ec75c6dde. Local 10/10 PASS. New SHA CI and real Mac inventory remain pending.
