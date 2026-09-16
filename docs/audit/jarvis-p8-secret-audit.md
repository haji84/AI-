# JARVIS P8 secret-leak audit

Parent: #681
Child: #841

## Scope

This audit is a fail-closed repository guard for SEC-011 and SEC-012. It checks repository text for a bounded set of high-confidence credential formats and checks source lines for direct `console.*` logging of sensitive credential-like identifiers.

The audit reports only file path, line number, and rule name. It intentionally does not echo matched secret values.

## Guarded classes

- PEM private-key headers
- GitHub token prefixes
- AWS access-key IDs
- Slack token prefixes
- OpenAI API-key prefixes
- direct `console.*` logging of sensitive identifiers such as owner secrets/tokens, passcodes, passwords, private keys, authorization values, and session tokens

## Fail-closed behavior

`scripts/jarvis-secret-audit.mjs` exits non-zero when a finding exists. `tests/jarvis-secret-audit.test.mjs` also scans the current repository, so normal CI fails when the bounded audit detects a finding.

## Evidence boundary

This is CODE/UNIT/INTEGRATION/SECURITY evidence for the bounded scanner only. It is not PHYSICAL evidence and does not prove that historical Git objects, third-party systems, runtime memory, operating-system logs, external observability systems, or credential stores are secret-free. Regex/static-source scanning can have false negatives outside the guarded classes. Those limits remain explicit rather than being converted into a broader security claim.

No owner authentication, Human Gate, worker signing, nonce/replay/clock protection, private ingress, capability authorization, credential value, billing behavior, or no-paid-default routing is changed by this audit.
