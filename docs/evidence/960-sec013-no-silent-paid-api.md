# SEC-013 No Silent Paid API Evidence

Requirement: `SEC-013`
Issue: #960
Parent: #681
Implementation master: #882

## Verified software state

SEC-013 runtime/security coverage was merged by PR #961. The exact merged-main commit is `6221ad5f04167c9a3de3d2dc38991e04ea4f0a49`.

GitHub Actions main CI #1423, run `35560762889`, completed successfully on that exact commit. The verified check set included repository guard, lint, the full test suite, the P8 Security Regression Suite, production build, and production health.

The dedicated SEC-013 regression proves that:
- zero incremental cost is allowed only when `allowPaidServices` is explicitly `false` and the remaining node policy permits execution;
- any positive incremental cost requires the Human Gate;
- `allowPaidServices: true` fails closed;
- a missing `allowPaidServices` field also fails closed rather than silently enabling paid routing.

The P8 suite also retains the repository-wide no-paid-runtime checks and the free-planner guard against silent paid-model/provider switching.

## Preserved boundaries

No paid provider was added or called. No billing state, credential, token scope, permission, firewall, device enrollment, device app version, Human Gate rule, Worker signing, nonce/replay/clock protection, private-ingress rule, or Production recovery behavior was changed by the SEC-013 implementation.

This evidence does not claim `PHYSICAL`, `RECOVERY`, independent-audit, or AGI evidence.

## Evidence classes

- `SEC013-960-CODE`: PASS, implementation/policy path exists and the dedicated regression binds the requirement to the production policy surface.
- `SEC013-960-UNIT`: PASS, dedicated zero/nonzero-cost and explicit/missing/true policy cases pass.
- `SEC013-960-INTEGRATION`: PASS, full repository CI and P8 suite pass on the exact merged-main commit.
- `SEC013-960-SECURITY`: PASS, fail-closed no-paid-default behavior and no-paid runtime scan pass without weakening the Human Gate.

## Canonical reconciliation rule

Only SEC-013 may be changed by the bounded reconciliation script. All other requirement rows must remain byte-equivalent after JSON parse/serialize comparison, and the canonical mirror validator must pass before SEC-013 can be promoted to `VERIFIED`.
