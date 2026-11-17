# Owner observer bootstrap refusal attribution

Continue Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`.
The owner confirms ZBook has network connectivity. Actual run44010426909,
job133795858480 ran on ZBook21 at2026-11-17T03:28:16Z. Its closed report is
NONE / NATIVE_BUILD_UNAVAILABLE, with no observations. This establishes
current runner connectivity, not an owner mismatch or original recovery.

The child currently collapses module import, signature exceptions, source
decoding, compilation and entry invocation into the build refusal. Distinguish
those fixed phases with closed reason enums. Keep explicit invalid-signature
and workspace refusals, native metadata policy, source-byte pinning, main/CI
gates, output schema, child/job budgets and all security boundaries intact.
Do not expose exception text, compiler output, paths, identities or source.
If compilation is the failing phase, distinguish access denial, a missing
compiler process, standard missing-reference errors and other source errors
using fixed enums only. Unknown failures retain NATIVE_BUILD_UNAVAILABLE.

Alternatives: repeating the same invocation cannot distinguish phases;
printing raw exceptions could expose private paths; a fixed phase enum carries
the information needed for the next bounded experiment. The implementer selects
the latter within the existing requested diagnostic scope. No new privilege,
credential, permission, activation or original-state authority is implied.

Executable fixtures must run the actual embedded child bootstrap with controlled
external boundaries and inert entry only. They must prove exact phase refusal,
closed serialization, early stop and no raw exception leakage. A Windows-only
fixture additionally compiles the complete original C# with its entry renamed
and an inert replacement, through the real signed supervised child; it never
invokes the real observer. Pure compilation alone was insufficient coverage.

Normal protected integration, exact-main CI and a newly bounded native
observation follow source verification. Current and historical failures stay
distinct. Original Goal remains NOT_ACHIEVED / G1 HOLD.
