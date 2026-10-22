# Issue #725 fleet-capacity evidence

## Scope

This evidence certifies only the software-only requirements `FLEET-010` and `FLEET-011`. It does not certify `FLEET-009` or any PHYSICAL-gated fleet requirement.

## Audited baseline

- Main commit: `6a2be422b1a5de793a6b0e522b35e678aa5aba53`
- CI: GitHub Actions main CI #1292, run `35523573773`
- CI conclusion: PASS
- CI completed: `2026-09-20T16:43:53Z`

## CODE

`JarvisFleetManager.register` rejects a new identity once the fleet already contains `JARVIS_MAX_NODES` nodes. `JarvisFleetManager.restore` rejects persisted snapshots above the same boundary.

## UNIT / INTEGRATION

`tests/jarvis-v1-foundation.test.ts` registers exactly `JARVIS_MAX_NODES` nodes, asserts the resulting fleet size is 100, then asserts `android-101` is rejected with `fleet limit exceeded`. The exact audited main commit passed the repository CI suite in run `35523573773`.

## Boundary

No PHYSICAL evidence is claimed. This evidence does not change enrollment, credentials, permissions, firewall, billing, deployment, Human Gates, signing, private ingress, device app versions, or device configuration.
