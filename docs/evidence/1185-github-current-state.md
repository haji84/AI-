# JARVIS GitHub reconciliation — 2026-09-23 JST

Snapshot: main `278d17c28528476f12bc6f9b8d5221ea340686b9`.
GitHub CI run35752865450 SUCCESS; deployment workflow35753036434 SUCCESS. Workflow status is not physical acceptance or proof of current runtime health.

## Current state
- Main requirement matrix:244 rows,178 PARTIAL,3 VERIFIED,2 IMPLEMENTED_UNVERIFIED,61 MISSING.
- Prior staged PR905 chain contains340 rows. Do not replace main with old staged JSON: preserve both newer evidence and96 additional IDs.
- Main PROJECT_STATE LAST_UPDATED2026-09-17 and historical next-priority are stale relative to merged PR1184.
- Open PR inventory contains75 entries in this fetched snapshot (recount from GitHub when acting). Open does not mean absent from main: some earlier changes were superseded/reimplemented.
- Settings UI exists in src/app/jarvis/settings/page.tsx while UI-005 remains MISSING. This proves ledger drift, not full UI acceptance.
- Current main has orchestrator WorkDispatcher, production research, demonstration learning and owner-fleet capability selector. Earlier claims that all such code is missing must be re-audited. Presence of classes/selector functions does not prove production wiring.

## Reproduced blocker #1185
verifyFacts(required=true,status=INFERRED,sources=[]) returned ok:true. Probe used exact main source locally; no external network. Added regression RED before fix / GREEN after fix. Required claims now require CONFIRMED; optional inferred claims remain nonblocking. This is a narrow correction, not proof that existing CONFIRMED logic checks source authority/freshness fully.

## Next security remediation
src/orchestrator/production-research.ts checks only HTTPS before fetch, reads unbounded arrayBuffer and has no timeout. An injected fetch accepted https://127.0.0.1/private and synthetic evidence yielded verification.ok=true. No real loopback request or exploit was performed. Determine caller reachability and trusted source policy before changing contract; add bounded response/time/claim/source counts, private-address/DNS/redirect defenses and source provenance. HTTPS alone is not egress authorization.
Fact verifier also needs authority/freshness/numeric-shape audit; avoid declaring all confirmation trustworthy from this one fix.

## Priority queue
1. Fix required unsupported completion (#1185), full CI/security/build, retain no-deploy scope.
2. Audit source retrieval egress and trust; reuse existing security kernel instead of inventing competing authority.
3. Reconcile244/340 IDs and actual code/tests/evidence, preserving all requirements. Separate main, staged software, actual runtime and physical verification.
4. Inspect latest Windows Broker chain PR1166/1181/1182 before duplicate implementation. Verify actual run -> host result -> independent verifier -> durable state.
5. Reuse/compare merged demonstration/research/Work Run paths with staged PR884–905; do not blanket merge stale stacks.
6. Physical acceptance: existing-device identity/credential-preserving canary, screen-off wake, long Remote Assist, network/reboot/power recovery, cellular access and coordinator migration remain evidence gates.

No Production/device/enrollment/credential/network/permission changes. Recovery PR883 remains held. This audit changes no canonical requirement status.
