# Issue1219: fixed private-owner observation

Continue original Goal `goal-fcc81c97e09153f7` / Job `rotation-recovery-37`.
The owner requests identification of the target behind the observed
`PRIVATE_OWNER_UNVERIFIED`, rather than further speculative explanations.

## Scope and approach

Reuse the supplied `owner-probe` diagnostic and the existing
`goriq-pc-private-network-probe.yml` workflow. Add a false-default,
mutually exclusive owner-observation selector. The existing owner/repository,
main, exact successful four-job CI and source-hash gates remain mandatory.
There is no change to workflow permissions or token handling.

The alternatives considered were repeating the original acquisition (it does
not distinguish targets and can create private files) and a new remote shell
route (unnecessary authority). Neither meets this diagnostic request.
Selecting the existing gated observation route is the implementer's decision.

The C# metadata observer remains byte-identical to the uploaded source.
Its fixed targets are identity/environment, bounded profile ancestors,
profile, handoff, and the existing run43843790970/attempt1 layout/raw/work/context.
It stops at the first refusal and never reads original DB/context contents,
calls Capture/Acquire, repairs ownership/ACLs, or creates private targets.
Output is closed enums/booleans, with no paths, SIDs or raw exceptions.

Adapt the supervisor to accept the pinned C# source in memory via redirected
stdin, so the action-free workflow requires no checkout or source-file writes.
Keep its signed Windows PowerShell5 host and supervised child limits. Compiler
temporary activity stays in the pre-existing metadata-checked workspace.
The parent metadata calls and compiler descendants retain the documented
timeout/atomicity limitations; no stronger guarantee is claimed.

## Acceptance

Prove source pin/context/current-main/CI/output refusal with executable fixtures.
Run pure C#5 tests and actual WindowsPS5 supervisor fixtures using inert C#,
including a completed child, invalid output/build and supervised timeout.
Then use normal protected source integration, successful exact-main CI,
and one new owner-observation dispatch. Compare its actual job log with the
closed report. Record current observation separately from historical failure.
No original recovery, permission repair or product completion is implied.

The scope is already requested in the active diagnostic conversation; no new
credential, permission, billing, production or original-state grant is assumed.
