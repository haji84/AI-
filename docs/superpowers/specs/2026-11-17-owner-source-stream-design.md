# Fixed owner observer source-stream compatibility

Same Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`, G1 HOLD.
Actual main4a84 run44015612283/job133812711463/ZBook21 returned
NONE/NATIVE_SOURCE_UNAVAILABLE at2026-11-17T04:13:07Z, observations[].
Module/signature/workspace preparation completed; owner observation did not.

.NET Framework reference source shows Process.StandardInput uses
Console.InputEncoding, while Console.In constructs a StreamReader with BOM
detection disabled. A BOM-bearing UTF8 frame reproduces base64 rejection.
The actual device's old bytes/encoding were not recorded; do not retrospectively
claim a particular BOM. Test this precise compatibility defect against the
embedded bootstrap, then use a BOM-aware stream reader with an explicit UTF8
fallback. Base64 transports only ASCII, so legacy ASCII-compatible console
encodings also work. Preserve strict decoding of the decoded C# UTF8 bytes.

Alternatives: changing the parent console codepage would affect external
console state; moving code into environment variables changes transport/size
constraints; explicit stream decoding fixes the demonstrated reader defect
without either change. This is the implementer's choice within the existing
diagnostic request. Add fixed empty/oversized/base64/UTF8 refusal subcodes for
the next bounded experiment, without publishing raw bytes or exceptions.

Keep the fixed C# byte-identical, the source65536-byte bound, ordered metadata
policy, signed PS5 child, token-free environment, EOF/deadline handling,
exact-main/four-job/source-hash gates and all existing safety controls. No
Capture/Acquire, original content reads, permission/owner/ACL/runtime changes.
Every result remains INCOMPLETE/recovered=false; original owner is unobserved.

Validate real embedded-bootstrap BOM rejection RED/GREEN, byte-exact public
source under standard Unicode preambles and ASCII-compatible encodings,
malformed/oversized rejection, real WindowsPS5 parent UTF8-BOM supervision with
an inert entry, source command-line limits, review and normal protected CI.
Only a subsequent authenticated native result can establish device progress.

References: microsoft/referencesource main,
System/services/monitoring/system/diagnosticts/Process.cs (standardInput),
mscorlib/system/console.cs (Console.In reader).
