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
