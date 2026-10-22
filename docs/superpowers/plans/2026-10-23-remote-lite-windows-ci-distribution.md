# Windows CI and distribution preparation for Issue1831

Spec: Issue1831/formal handoff6307863638, docs/architecture/goriq-remote-lite-manual.md.
Baseline543909fa. Owner explicitly deferred external physical acceptance and
requested autonomous Windows CI repair and remaining safe distribution work.

## Constraints

Reuse PR1832. No public ingress, new key/permission, billing, signing activation,
production deployment or physical device mutation. Keep all native video/input,
pixel/ACK/revocation and MSI ICE/lifecycle assertions. Local desktop-input VM
tests remain disabled; run those only on disposable hosted Windows. Preserve
enrollment/keys. Never label candidates distributable before remaining acceptance.

## Task1: explicit browser fixture and cold-start preflight

Evidence: passing run39806463888 used image20261007/Chrome155; failing
39826415989 used image20261021/Chrome156. Driver readiness failed twice, another
session timed out; setup later passed. Local156 matched pair cold browser took
14.279s, warm0.824s. This demonstrates a cold-start cost, not a proven root cause
for every hosted failure. Current scripts also ignore explicit Chrome selection.

- Reproduce that an explicitly missing Chrome binary is silently ignored by
  the current smoke script (negative selection case).
- Use explicit matching156.0.8078.47 Chrome/Driver in this Windows CI job only.
  Reuse setup-chrome already used in Android CI. Add one bounded preflight that
  verifies versions, isolated headless navigation/script execution and closure.
- Wire REMOTE_LITE_CHROME to all four Windows/smoke consumers, retain current
 20s requests and all acceptance assertions. Preflight is infrastructure startup,
 not a substitute for media/input acceptance and must fail on missing/mismatched
 binaries. Do not silently fall back or retry the entire test.
- Verify negative selection and real headless smoke/owner UI, syntax/lint,
 independent review, then push existing PR and inspect actual CI.

## Task2: finish MSI acceptance

Consume Task1 CI. Investigate first concrete MSI failure, minimally fix, keep
full ICE and install/rebuild/repair/upgrade/uninstall/identity-retention checks.
No installation onto the owner's PC. Build candidates only after actual gates.

## Task3: distribution handoff

Prepare source/artifact hash provenance, notices and Japanese install/restore
instructions with explicit unsigned/physical-pending labels. No secrets/debug
fixtures in candidate contents. Verify inventory and preserve exact source SHA.
Save evidence, unresolved gates, next action and rollback to Issue1831/PR1832.

Risk: MEDIUM reversible test-environment/package changes, no new privilege.
Rollback only these task commits; retain all user enrollment data and keys.

## Checkpoint

b715de08 CI39840077911: explicit156 pair preflight4149ms, native Windows real
frame/input/revocation9.11s and setup3.16s passed. Separate-browser scripts
failed on absent DOM canvas before probe installation. Added a bounded DOM
readiness requirement; wrong documents still fail and every downstream
pixel/input/ACK/revoke assertion remains. Missing-element regression failed
before correction and8/8 pixel tests passed afterward; RemoteLite115pass/1skip.
Independent review found no P1/P2. Exact-head full Windows/MSI CI still required.

Distribution preparation adds a clean-source-commit receipt, Japanese guide,
Go notice, checksums and six-file CI artifact allowlist after MSI lifecycle
success. Real dirty-worktree build was refused before output creation. Source
SHA in PR CI denotes the tested synthetic merge, not necessarily the PR head.
