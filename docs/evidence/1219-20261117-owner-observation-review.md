# Private-owner observation source review

Same Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`, base main
`48d114f0b433d6dc05d3b342533fd8aee0c9f530`. Actual implementation author: Codex;
local model NOT_RUN. Native observation and original recovery are not claimed.

The active user asked to identify the error target rather than keep proposing
account hypotheses. Existing GitHub credentials authenticate as haji84 in this
environment. Issue1219 remains OPEN; actual authenticated job133218768499 logs
again report PRIVATE_OWNER_UNVERIFIED before acquisition. Source pin/main and
existing read-only execution gates were re-read. Listing runner administration
is unavailable (HTTP403); no credential/scope change was attempted. The current
source supports only acquisition and general locator modes, so a fixed owner
observation selector is added through the same workflow and protection path.

One fresh reviewer examined the source integration and supplied byte-identical
C# source, gated-source/mode boundaries and Windows supervision. Two material
findings were reproduced before fixing:

- Contradictory summary/final fact and a falsely complete target set passed the
  imported JSON reducer. The supervisor now validates the ordered prefix,
  required target set, metadata consistency and summary/final-fact equality.
- Timed process exit did not guarantee ReadToEndAsync completion. A bounded
  WhenAll wait now drains input/output/error tasks within the remaining child
  budget. Pending and never-completing task regressions exercise this boundary.

The closed CHILD_START_UNAVAILABLE/CHILD_STOP_UNCONFIRMED enum mismatch was
also reproduced and fixed in that pass: losing the uncertain-stop reason is a
material diagnostic limitation, so it was regraded from the reviewer's Minor.
Both reasons now round-trip without raw process data. This does not strengthen
the documented descendant termination guarantee.

Local RED records are preserved outside the repository in
`/workspace/scratch/1219-owner-evidence/`. They include missing mode, fixture
counter scope error, an introduced fixture brace typo, contradiction/sequence
RED, and closed-reason/output-wait RED. No test assertions/caps were weakened.
Initial baseline command named two nonexistent files, then the correct five
unchanged Bridge files passed122/122. The first lint command used pnpm11.25 and
failed the engine check; the existing pinned pnpm11.19 was used afterward.
The pre-review broad test run was stopped to apply material review fixes;
it is incomplete, not a full-suite PASS. Full/native/CI status belongs to the
subsequent exact-source result and must not be inferred from this authoring note.

No original/private target, ACL, owner, key, service, permission or production
state was modified by this local source work. Compass MCP is unavailable; this
source record and the existing Issue/PR are the governed handoff surfaces.
Rollback is normal protected revert of the diagnostic source and selector.

## Windows compatibility correction

PR1925 CI43976594339 / Windows job133682034280 rejected the new fixtures:
the workflow extractor assumed LF after the YAML block marker, and the pure
compiler fixture used Add-Type -CompilerOptions, absent in WindowsPS5. The
real supervised child had not yet been tested and no ZBook dispatch occurred.
Preserve that failure. The correction normalizes fixture workflow line endings,
keeps exact-byte public diagnostic sources LF through .gitattributes, and uses
the installed WindowsPS5/.NET Framework C#5 compiler path on Windows. The Linux
Roslyn C#5 language-floor check remains explicit. No source guard, original test
assertion, CI limit or actual observer/supervisor byte changes are involved.

The first full local run completed4373 cases /4345PASS/2FAIL/26existingSKIP.
Both failures reproduced on unchanged main48d. The process umask0077 made the
fixtures' deliberately requested0644/0755 objects become private0600/0700,
so their expected unsafe-mode refusals did not occur. Running the same two
unchanged baseline tests with per-test-process umask0022 passed2/2. This is a
fixture environment distinction, not a Windows ownership diagnosis or a test
relaxation. The frozen-source broad confirmation runs with that standard CI
fixture mask; its final outcome is recorded separately.

The second Windows run43977798568 / job133686164095 reached491PASS/1FAIL
of492. Only the new inert supervised-child test failed after26.352s; no real
private metadata was inspected. The one-record stdin channel was left open.
The next bounded hypothesis closes the writer only after its asynchronous
source write completes, with both transfer and exit using the remaining25s
budget. A real cross-platform child that reads to EOF now verifies byte-exact
transfer and termination. Windows acceptance of this hypothesis still requires
the next exact-head CI. If it fails, inert-only fixed progress markers expose
signature/workspace/input/compiler boundaries while preserving the assertion;
the real observer and public output remain uninstrumented.

Further actual Windows evidence: run43979311714 retained491PASS/1FAIL; the
inert supervisor returned OUTPUT_REJECTED. Run43980512538 isolated that fixture
first, and its retained trace showed child exit0 with stderr present,
CLIXML=true and MODULE_PROGRESS=true ("Preparing modules for first use"). The
initial cold invocation timed out while the traced invocation completed. The
next single-variable correction suppresses normal child progress output using
ProgressPreference=SilentlyContinue. Nonempty real stderr still refuses and the
25s budget remains. This fixes a proven progress-channel refusal; cold-start
timing remains subject to actual Windows validation, not assumed solved.

Run43981328464 / Windows job133698251970 then demonstrated the real supplied-
source child, native build rejection and extra-output rejection all PASS.
The outer55s fixture process expired during the fourth, deliberately slow
timeout case. The timeout case is now a separate fresh inert process with its
own unchanged55s outer bound; a unique test-owned temporary marker proves the
compiled inert entry reached its deliberate sleep before TIMEOUT. No absolute
30s bound is inferred for parent metadata. Production25s and existing
Windows5min/independent CI limits are unchanged. Both old failures and
the newly observed native successes are retained; none is original recovery.

Run43982142077 / Windows job133701013768 confirmed the separate timeout case
PASS at25.607s, including its compiled-entry marker. The first cold bootstrap
still timed out; immediate inert trace finished all signature/workspace/input/
build stages with child exit0 and empty stderr. Thus progress-stream rejection
is fixed, while cold initialization remains unresolved. The next bounded
hypothesis replaces unqualified bootstrap auto-discovery with explicit imports
of the three installed Microsoft standard module manifests under fixed PSHOME.
Auto-loading is disabled and PSModulePath is set using a .NET path operation
before the first cmdlet. The25s/native20s/Windows5min/CI gates remain unchanged;
no successful cold-start claim is made before new Windows evidence.
