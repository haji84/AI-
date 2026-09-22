# #1200 bounded research integration

Goal: connect the existing unified plan -> autonomy.delegate research -> Goal Loop -> Compass path to #1187 acquisition.

1. Add optional factCheck with bounded required claims. No model/context-supplied network policy.
2. Read a host-only exact URL + JSON field authority policy, disabled when absent. Reuse pinned HTTPS, byte/time/DNS/redirect limits. No configuration, permission or credential mutation.
3. Keep acquired values private; emit status/hash/citations as untrusted evidence, never instructions. Bind verification to the exact in-process action/result, fail closed on substitution.
4. Wire existing cloud runtime delegation verifier and write-back, including failed research evidence. Context-only research remains compatible.
5. Test unified intake plan/Goal Loop/persist/reopen with source fixtures and deny/conflict/timeout/oversize/injection cases; full tests, P8, lint, build and independent review.

Risk: MEDIUM, additive execution integration behind default-deny policy. Rollback by reverting code; historical evidence remains data. No physical/device path touched, no whole-product PASS.
