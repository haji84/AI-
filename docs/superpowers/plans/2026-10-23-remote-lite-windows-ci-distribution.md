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
Go notice and checksums. Real dirty-worktree build was refused before output
creation. Source SHA in PR CI denotes the tested synthetic merge, not necessarily
the PR head. Binary uploads were removed during independent review: this public
repository's Actions artifacts are externally downloadable. No candidate was
uploaded; preparation remains local/ephemeral until a publication decision.

813c1db0 CI39841059290: native JPEG absent, real coordinator document complete
but static screen/canvas absent; signed separate-peer passed12.10s. DOM waiting
did not fix the failure. 8890a206 CI39842008460 added HTTP/DOM diagnostics:
native root200/exact embeddedHTML and real input/revoke passed9.20s, coordinator
host root200 but viewer DOM absent, later signed-peer stayed on an initial blank
document (body0, no HTTP document or root request). This distinguishes browser
navigation failure from capture, input and server guards. It does not prove a
specific upstream Chrome implementation bug.

Next method uses one renderer location.replace navigation with destination and
document-complete checks, instead of repeating WebDriver /url. An actual local
Chrome156 fixture with injected no-op /url reproduces blank failure; ten fresh
sessions all reached the real loopback page with the alternate method and then
returned to about:blank. Existing media/input/revocation assertions remain.
MSI runs independently after browser failures so packaging evidence can advance;
any browser failure still fails the job. Android runtime remains unchanged.

909b5c33 CI39844240368: native and signed separate-peer passed; real coordinator
fixture still did not navigate from the initial document. Explicit tabs did not
resolve the hosted failure. Next method uses ChromeDriver's existing CDP
Page.navigate command and inspects its error/frame result before checking the
actual destination. No whole-test retry or assertion/time-budget relaxation.
The same ten local real-Chrome fixture/reopen checks pass; hosted proof pending.

All three MSI full ICE builds passed in that run, but install0 placed files in
Program Files, not LocalAppData. SetDirectory explicitly assigns the intended
user target with a non-executable Type51 in both sequences after CostInitialize
and before CostFinalize. The metadata gate permits exactly this one assignment;
the previous MSI fails it. Local candle -wx passes; full lifecycle proof remains
on the disposable hosted VM. No local policy workaround or installer mutation.
Android CI39844240382 succeeded, including normal-release identity/non-debug
checks and private ephemeral candidate preparation; no public artifact upload.

155b7912 CI39846020674: all three full ICE/metadata builds and the entire MSI
lifecycle passed, including repair, upgrade, uninstall and retained data.
CDP now identifies ERR_ABORTED for all three native fixture navigations before
any host root request; setup still passed. Change the environment dimension:
pin only this job to supported windows-2022, retaining exact Chrome156 and all
timeouts/media/input/security/MSI assertions. This isolates the moving2025 image
and does not claim2025 or physical acceptance. No whole-test retries/skips.
