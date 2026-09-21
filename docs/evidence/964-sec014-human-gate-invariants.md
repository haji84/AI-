# SEC-014 Human Gate Invariants Evidence

Requirement: `SEC-014`
Issue: #964
Parent: #681
Implementation master: #882

## Verified software state

SEC-014 dedicated Human Gate regression coverage was merged by PR #965. The exact merged-main commit is `7caf98fa8e3aca564050e229f27e4e16a93e8bc4`.

GitHub Actions main CI #1428, run `35561752961`, completed successfully on that exact commit. The verified check set included repository guard, lint, the full test suite, the P8 Security Regression Suite, production build, and production health.

The dedicated SEC-014 regression proves that:
- credentials/secrets, permission, billing/contract, destructive schema/delete, security weakening, protected external publication, and high-risk merge signals remain HIGH and Human-Gated;
- task-completion delegation cannot authorize those non-delegable HIGH categories;
- Human Gate relaxation, protection/audit disable, and unrecoverable Production destruction remain CRITICAL execution blocks even with active delegation;
- irreversible or explicitly approval-required actions cannot ride task-completion delegation;
- Production authorization is exact-scope, active/expiry-bound, and requires explicit Production-deploy scope in the authorization.

## Preserved boundaries

Production policy behavior was not changed by PR #965. No device app/version, re-enrollment, secret/credential, token scope, permission, firewall, billing, Worker signing, nonce/replay/clock protection, private-ingress rule, no-paid-default routing, or Production recovery behavior was changed.

Recovery #881 / PR #883 remains intentionally unmerged pending physical acceptance.

This evidence does not claim `PHYSICAL`, `RECOVERY`, independent-audit, or AGI evidence.

## Evidence classes

- `SEC014-964-CODE`: PASS, the inspected risk, delegation, and task-authorization code paths preserve the required Human Gate boundaries.
- `SEC014-964-UNIT`: PASS, dedicated requirement-level tests enumerate protected HIGH/CRITICAL categories and delegation negatives.
- `SEC014-964-INTEGRATION`: PASS, full repository CI and P8 suite pass on the exact merged-main commit.
- `SEC014-964-SECURITY`: PASS, privileged and governance-sensitive categories remain fail-closed without relaxing Human Gates.

## Canonical reconciliation rule

Only SEC-014 may be changed by the bounded reconciliation script. All other requirement rows must remain equivalent after JSON parse/serialize comparison, and the canonical mirror validator must pass before SEC-014 can be promoted to `VERIFIED`.
