# #1192: corrected demonstrations and durable Skills

Parent #681 / #882. Baseline ec39943125c9ca47b55cb6dcb537170b8b84a700. Software revision 043db1d60f4afad003709c3e2cc75c0a7df0ff67. 2026-09-23 JST.

## Result and scope

JARVIS-routed demonstration -> explicit mistake marker -> actual original screen/profile recovery -> corrected steps -> independently verified replay -> durable candidate -> separate verified replay certification -> device/profile-bound guarded reuse is connected. The real Work-State Goal Loop factory also supplies certified generic Skill context and verified-result candidate write-back. Learned context is reference data, never permission.

**Keep this physical-facing PR unmerged until actual-device acceptance.** No production or existing fleet state was changed. Product completion remains false; 340 requirement statuses are unchanged. Camera/video-only interpretation, inference of arbitrary mistakes, full workflow/decision-rule induction, cross-platform native adapters, and autonomous Goal-to-Remote-Assist dispatch are not completed here. Compass's current development adapter has no device-replay capability; its default Skill environment does not invent one.

## Behavior and boundaries

- The owner selects “直前の操作をやり直す”. Ordinary Back, Delete or navigation is never guessed to be a mistake.
- Wrong action provenance remains in an additive journal. Navigation back to the original observed screen is excluded; the next correct action is recorded. Already-restored/no-op cases use the pre-input observation. A protected or different-profile screen cannot resume learning.
- Server-stored completed verify runs, not client success flags, govern Skill state. First verify makes a candidate; two distinct successful verifies certify. Exact device/profile references and procedure digest guard reuse; a failed run quarantines that Skill. Existing independently verified legacy teaching remains guarded and usable if optional Skill storage is unavailable, with a visible separate warning.
- Skill procedure stores a variant/device/profile/digest reference, not a copied action list or raw screen/input. Teaching archive still retains the original safe action representation, preserving audit provenance.
- Skills share a local file across cooperating processes. Bounded exclusive lock, reload under lock, atomic replace, rollback on failed persistence and fresh reads prevent lost updates or resurrected quarantine. Skill writes are not distributed/network-filesystem consensus. TeachingStore itself retains its existing single-writer design.
- A crash holding the lock can leave an orphan lock. Writes fail visibly after 5 seconds; no automatic lock stealing. Confirm all writers stopped before controlled lock recovery. Existing verified device operation is never replayed merely to retry optional learning persistence.
- Generic Goal proposals remain candidates. Identical repeated write-back does not demote a certified Skill; separate certification remains required. Optional extraction failure preserves the already verified Goal result and appends a redacted Work-State event.

## Verification

Windows Node24.19.0 / pnpm11.19.0, independent temporary stores and synthetic identities. No actual Android input, credential change, device registration or network exposure change.

| Check | Result |
|---|---|
| node --test | 1414 PASS, 0 failed/skipped |
| pnpm test:p8-security | 266 PASS |
| pnpm lint | PASS |
| pnpm build | PASS; pre-existing video-plan-store tracing warning remains |
| built /api/health | HTTP200, status ok |
| unauthenticated teaching GET and correction POST | HTTP401 |
| browser UI, 1200x900 and 390x844 | record/correct/finish/candidate/certified/reuse sequence PASS, no page errors or horizontal overflow |
| physical / production acceptance | NOT RUN / UNCHANGED |

Browser used the actual TeachingControls component with fixture API/device responses on a temporary isolated route. It verifies UI behavior, not physical execution. Backend integration tests separately call actual teachingCommand, beforeTeachingInput, replayTeaching and Goal Loop factory. The temporary route was removed before build. The screenshot's fixture remains DRAFT because the UI fixture does not model all server state transitions; server status transitions are covered by integration tests.

Machine summary and log hashes: [verification.json](1192/verification.json). Screens: [desktop correction](1192/desktop-correction.png), [mobile certified message](1192/mobile-certified.png).

TDD failures reproduced before correction: missing runtime Skill writes; concurrent temporary-file rename; failed certification left active memory; optional file corruption blocked verified replay; restored-screen correction lost the next action; separate instances lost candidates/undid quarantine. Regression tests now pass, including real separate Node writer processes and per-device certification. Independent review found no remaining blocker after fixes; reviewer opinion is AI_ASSERTED, test outputs are machine evidence.

## Physical acceptance before merge

On one already registered neutral test device: start session; record a harmless wrong navigation; mark correction; return to original screen; record intended action; finish; independently replay twice; confirm Skill recognition and guarded reuse. End/reopen session and restart isolated candidate host; confirm saved procedure/identity and no uncertain action auto-repeat. Verify protected/mismatching screens stop. Capture actual device/version, task/run IDs, commit and result; do not substitute fixture evidence.

## Rollback / next

Revert this code while retaining personal teaching/Skill files; old teaching JSON version1 and Skill version2 remain readable. Do not delete histories or reset registrations. No DB schema, Android version, credential, permissions, paid API, firewall or production deployment change.

Next independent software work: wire #1187 bounded research acquisition into actual claim-bearing workflows under trusted policy; then add the bounded native Windows Worker consumer identified by #1188. Broader #681/#882 requirements remain tracked individually.

## Current-main compatibility follow-up

PR #1194 merged API-only correction core at f974cc39dc25697e6cf999764e9d695ee753e14d during this work. The complete module and its P8 tests are retained in merge revision 74e450937bb5fa8fbe7ee8ecb329f38f2362e824. Combined Windows checks: 1418 full tests, 270 P8 tests, lint and build PASS. Existing library-only correction API remains compatible; #1195 owns the physical-facing runtime/UI path and remains unmerged. No main code was removed. This does not imply the two different correction ledgers are cross-migrated; only the runtime journal is wired to this UI.
