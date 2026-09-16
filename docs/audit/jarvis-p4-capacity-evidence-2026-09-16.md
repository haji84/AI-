# JARVIS P4 capacity evidence — 2026-09-16

Parent: #681  
Child: #725

## Scope

This record covers only the software evidence for:

- `FLEET-010` — 100-node capacity regression test
- `FLEET-011` — reject capacity overflow safely

It does not claim physical 100-device acceptance, device onboarding, reconnect, replacement, Device Owner provisioning, or any other PHYSICAL-gated P4 requirement.

## Code evidence

`src/jarvis/fleet-manager.ts` defines the JARVIS fleet capacity at 100 nodes and rejects a new registration after the capacity is reached.

`tests/jarvis-v1-foundation.test.ts` contains `fleet supports up to 100 nodes and selects a capable healthy Android`. The test:

1. registers nodes `android-001` through `android-100`,
2. asserts `fleet.list().length === 100`,
3. attempts to register `android-101`, and
4. asserts the registration throws `fleet limit exceeded`.

This directly exercises both the accepted boundary and the fail-closed overflow boundary.

## Exact CI evidence

PR #722 exact head: `e29353c3f1d2096f626e402bc3a181b3fc5f0fec`

CI run #1002 / workflow run `35049930596` completed successfully on that exact head. The project-checks job reported:

- lint: PASS
- Node test suite: 756 tests / 756 passed / 0 failed
- production build: PASS
- production health check: PASS

The passing suite includes `fleet supports up to 100 nodes and selects a capable healthy Android`, which contains the explicit 101st-node rejection assertion above.

PR #722 was merged to main as `d72b3b9bede549ad3f10c4c85d61df3a75330683`.

## Verdict

For the repository implementation represented by the merge above, the required software evidence classes for `FLEET-010` and `FLEET-011` are satisfied: CODE, UNIT, and INTEGRATION.

The machine Requirement Ledger remains the canonical completion source. Its current rows have not yet been rewritten by this evidence-only change, so this audit record alone does not change their machine-readable status and does not make P4 complete. A subsequent bounded reconciliation must update the canonical matrix and mirrored product spec without changing requirement text or weakening any PHYSICAL/RECOVERY evidence class.

## Explicitly unresolved

`FLEET-009` remains PARTIAL. The repository has worker identity persistence/revocation primitives, but the integrated owner-confirmed device-replacement flow has not been demonstrated. Any real worker-key revocation or credential transition remains an explicit privileged operation and must not be silently executed.

P4 as a phase is therefore not complete.
