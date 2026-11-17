# Fixed private-owner metadata observation (Issue1219)

The false-default `zbook_owner_probe_only` selector in the existing PC private
network probe workflow loads hash-pinned public source in memory after the
existing owner/repository/current-main/four-successful-CI-job gates. Other
selectors must all be false. No checkout or source-file materialization occurs
on ZBook. `observe-private-owner.ps1` remains inert without `-Observe` or an
explicit function call. The standalone default loads its adjacent C# source;
the workflow passes those pinned bytes explicitly over redirected child stdin.

The C# source is byte-identical to the uploaded diagnostic
`goriq-owner-diagnostic-20261117.zip`, SHA256
`9788d6aa785f713b0f90fde62c3ae2d39c7214456e80bfb6afcb43bcff3ce5a0`.
Targets are fixed to the current identity/environment, the bounded profile
ancestor chain, profile and `.goriq-handoff`, and the **existing**
`1219-original-inspection-43843790970-1` layout/raw/work/context.
The sequence stops at the first refused or missing target. Metadata uses
READ_CONTROL/READ_ATTRIBUTES, OPEN_EXISTING and shared handles. It never calls
the capture constructor or Acquire, reads original DB/context contents,
enumerates directories, creates a missing target or changes ACLs/owners.

Only closed target/reason/owner/DACL enums and booleans leave the observer.
The supervisor reconstructs the JSON, verifies the ordered prefix, summary
agreement and complete-sequence claim, and rejects extra/raw/malformed output.
`owner=OTHER` means owner differs from the executing Windows user; it does not
identify who created the object. `OBSERVED_POLICY_MATCH` describes current
metadata, not a recovered original, historical proof or runtime acceptance.
Every result remains INCOMPLETE / NOT_AUTHORITATIVE / recovered=false / G1 HOLD.

Actual ZBook run44010426909 reached the signed supervisor but returned the
former generic NATIVE_BUILD_UNAVAILABLE before any owner observation. Fixed
bootstrap reasons now distinguish the three Microsoft module imports, signature
exceptions, source decoding, compilation and entry invocation. Compiler access
denial, missing process and standard reference/source errors use closed enums;
unknown compiler failures retain the generic reason. No exception text or
compiler diagnostics are emitted. Internet connectivity does not by itself
establish a working GitHub Actions listener; this run did establish that the
existing ZBook21 listener accepted the diagnostic at that time.

The existing signed WindowsPowerShell5 host starts a token-free child using
that same fixed executable. Compiler TEMP/TMP use only the pre-existing
GITHUB_WORKSPACE after bounded ancestor metadata/reparse/fixed-NTFS checks in
both parent and child. Compilation may create ordinary temporary files there.
Asynchronous source transfer and output draining share the 25-second child
budget; the C# reducer has a cooperative 20-second budget. Owned-child kill
confirmation permits up to two more seconds. Parent metadata/Process.Start
calls are outside the child wait, and terminating that child does not prove
compiler descendants stopped. The unchanged three-minute Actions job limit
is the outer execution limit. Metadata checks do not provide atomic immunity
to later path replacement or concurrent producers.

`test-owner-probe.ps1` compiles C#5, exercises pure policy/path/schema checks and
closed non-Windows refusal, and never runs the actual Windows observer. On
Windows it additionally exercises the real WindowsPS5 supervisor with inert
C# supplied in memory: successful compilation, invalid build, extra output
and owned-child timeout. Actual ZBook observation requires the gated workflow;
source tests alone do not establish that the device was inspected.

The historical run can only prove its generic refusal. A new observation
identifies a current target; do not rewrite the old run as if it contained
that detail. Do not redispatch the original acquisition unchanged, repair
permissions speculatively, or recreate the original Goal/state.
