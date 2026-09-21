# SEC-012 No secrets in logs evidence

Requirement: `SEC-012`
Issue: #952
Implementation PR: #953
Verified implementation commit: `de95421055abd30e700c1da16c2ff82a53fff555`

## Scope

This record covers software-only `CODE`, `UNIT`, `INTEGRATION`, and `SECURITY` evidence for the JARVIS `No secrets in logs` requirement.

The implementation hardened `scripts/jarvis-secret-audit.mjs` so direct sensitive identifiers in multiline `console.*(...)` calls are detected, added dedicated SEC-012 regression coverage in `tests/jarvis-sec012-no-secrets-logs.test.mjs`, and kept the check explicit in the P8 security regression suite.

The dedicated tests cover all supported console levels, multiline structured logging, secret-value omission from findings/rendered output, safe status text, and a repository-wide committed-text scan. Test credential material is assembled only at runtime and is not owned credential material.

## Verification

GitHub Actions exact merged-main CI run #1399 (`35556813708`) ran on `de95421055abd30e700c1da16c2ff82a53fff555` and completed `success` at `2026-09-21T03:14:48Z`.

Verified check set:
- repository guard: PASS
- lint: PASS
- full tests: PASS
- P8 Security Regression Suite: PASS
- production build: PASS
- production health endpoint verification: PASS

The preceding PR CI #1398 (`35556731739`) was also reported PASS for the same required check set before merge.

## Evidence classes

- `SEC012-952-CODE`: PASS at `de95421055abd30e700c1da16c2ff82a53fff555`
- `SEC012-952-UNIT`: PASS at `de95421055abd30e700c1da16c2ff82a53fff555`
- `SEC012-952-INTEGRATION`: PASS at `de95421055abd30e700c1da16c2ff82a53fff555`
- `SEC012-952-SECURITY`: PASS at `de95421055abd30e700c1da16c2ff82a53fff555`

## Safety boundary

No device app version or enrollment was changed. No secret or credential was created, rotated, disclosed, or granted additional scope. No permission/token scope, firewall/router, billing, Human Gate, owner authentication, Worker signing, nonce/replay/clock protection, private-ingress policy, or no-paid-default routing was weakened.

This evidence does not claim `PHYSICAL`, `RECOVERY`, independent-audit, or AGI evidence. It does not substitute CI for any requirement that needs physical evidence. Recovery PR #883 remains a separate Production-coupled candidate and is not authorized for merge by this record.
