# #1662 PC enrollment prerequisites

Parent Goal #1219; owner approval comment 5930240842. Scope starts 2026-10-01T11:18:17Z and expires 2026-10-02T11:18:17Z. Exact targets/roles are recorded in `docs/authorizations/1662-pc-enrollment.json`. Base main: cbd3d0d9e15d46370c25f644421e053dd1676c86.

## Off-production verification

Trusted issuer: Node 24.19.0 runner in Codex workspace, 2026-10-01 UTC. Reproduce with `node --test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`.

- Full suite: 2117 tests, 2113 PASS, 4 existing SKIP, 0 FAIL.
- lint, TypeScript and production build: PASS.
- Independent verifier: 20/20 enrollment/bootstrap/store/identity and existing enrollment/ECDSA tests PASS; no unresolved Critical/Important finding.
- Live fixture Broker: 38 Android records and identities preserved, proof enrollment, signed PC heartbeat/replay rejection, Broker restart/reconnect and escalation rejection PASS.
- Host file storage: one exclusive atomic publication, no overwrite, weak permissions and symlinks rejected PASS on Linux fixture. This does not verify macOS physical enforcement or Windows DPAPI.
- Important review fixes: trusted-main verifier checkout instead of input-selected code; forged PC authority rejected in both Android enrollment routes. Each reproduced failing before the fix and passing afterward.

## Physical activation boundary

Manual dispatch workflow checks public exact-main successful CI, then an initial two-host runtime barrier. Each local enrollment checks its own exact runtime and approval expiry again, saves a protected host-local baseline, proves possession and uses only its node key for worker heartbeat. Private keys and Owner credentials never become workflow artifacts or peer credentials. Existing Mac runtime entry, Windows task principal/credentials, TLS/listeners, DB schema and Android Node Contract remain unchanged.

These are prerequisites, not completion Evidence. Windows native runtime upgrade is still a deployment prerequisite to inspect; production sync currently refreshes Mac and Vercel only. Public peer enrollment exchange, production mesh/Goal composition, physical task assignment/result verification, offline, reconnect, failover and rebalance remain unverified. Nubia remains owner-deferred. Historical migration-key residue remains unverified and is not touched by this work. No Stage C or parent Goal completion is claimed.

Rollback: disable only new PC participation, retain keys/backups, select prior exact runtime/configuration; no DB import, stale-state restoration, key deletion or credential rotation.

## Workflow compiler recovery

Merged prerequisites main4136def473f139cd516a0df2090b38a55e61f7fb. GitHub workflow compilation failed before any jobs on runs36859206271 and36859571426; no host enrollment executed. `actionlint`1.7.7 reproduced `goriq-pc-enrollment.yml:63: matrix context is not allowed in step.shell`. Replaced that dynamic shell with two platform-conditioned steps using explicit bash/powershell. The same parser is GREEN after the minimal fix; existing source-trust regression2/2PASS. Source verification, manual trigger, approval expiry, scope and two-host preflight semantics are unchanged. Physical activation remains pending repaired-workflow integration and exact successful main.
