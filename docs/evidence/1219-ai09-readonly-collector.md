# AI-09 fixed read-only evidence collector

Status: implementation preparation only. No authenticated SSH, independent
Verifier, physical six-check or restart/next-Job acceptance is established here.

## Why this change is needed

The V18 diagnostic started only after the root monitor acknowledged readiness.
The owner then completed Ubuntu sudo authentication. However, the root monitor
did not acknowledge the correctly typed second command before its 180-second
lease expired during a context handoff. The worker stopped before pressing
Enter for that command. Increasing that lease would retain the dependency on
21 model/console acknowledgement exchanges.

The retained V18 run is `b7bcdb1e3e104ca5b16a4caa2b7deac9`. Its receipt records
one completed step, one Enter (`sudo -v`), exit 1 and released modifiers. The
worker receipt SHA-256 is
`506efe1e9ddce1f7d08e16baf6373040ced7cc5b41edb14b0b50ca0b3ecc986c`;
the controller receipt SHA-256 is
`032d6a6badb98e7bf2e4ee30a34d04f2c2fb8af20da03bee246f9da884137972`.
These are failure-containment records, not SSH success evidence. The pending
console line must be cleared before a later authorized console operation.

## Prepared replacement

`scripts/ai09-readonly-evidence-collect.py` groups the existing read-only
observations into one fixed collector. It checks fixed source and receipt
paths, safe ownership and file metadata, the pinned inspector bytes, original
enrollment identity, the current authorized-key file digest, and the owned
media's whole-device mount state. It reuses the existing inspector for guest
identity and public inventory. Its only runtime argument is a nonce.

Output is bounded structured diagnostic data. Missing, changed, unsafe, expired
or mounted inputs must produce BLOCKED. The output is an unsigned guest
observation; a nonce does not establish authenticated transport, independent
verification or permission to activate SSH. Tests with fixture providers are
software evidence only. Linux descriptor and symlink behavior must be tested
on Linux and must not be inferred from Windows fixture success.

## Execution remains gated

The existing V3 admission still requires its original V18 provenance. This
collector does not replace those checks, manufacture accepted records, update
the admission script, or authorize a new execution route.

The original enrolled-key and critical execution expiry was
2026-10-21T09:00:00Z. This change does not renew it. Guest delivery, a new trusted
result-return path, exact execution approval, any key-expiry update, media
operations and the narrowly scoped TCP22 activation must be concretized and
reviewed before execution. No new key, signer, account, network permission,
installation or production action is included in the source-only change.

Keep all V18 and earlier records immutable. Rollback for this unactivated
source change is to revert its new source/tests/documentation; it does not
require a VM, credential or network rollback.
