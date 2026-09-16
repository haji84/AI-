# JARVIS P4 iPhone physical evidence audit

Status: historical exact-SHA physical evidence audit only. This document does not create a new device run and does not revalidate current `main`.

Parent: #681 P4
Evidence-audit issue: #761
Primary physical evidence: #609
Enrollment/reconnect completion audit: #612

## Exact evidence boundary

Issue #609 records a real iPhone validation run against exact merged main SHA:

`553b58a40c0ce2bcd341911c84f06d969e1a6380`

Observed task state transition:

`QUEUED task=iphone-physical-e2e-004 -> DELIVERED -> VERIFIED RESULT physical=true`

The same #609 evidence records the following observed PASS items for that exact run:

- physical iPhone build/sign/install
- Bonjour dynamic discovery without a hard-coded port
- secure bootstrap enrollment and persisted Keychain credential
- reconnect after Bridge restart/port change
- bounded task delivery to the physical iPhone
- durable delivery until a verified result
- on-device `ios-tooling` execution
- HMAC-signed result accepted by the Bridge
- server-generated physical-iPhone evidence bound to the exact main SHA
- duplicate/task/result nonce, expiry, tamper and replay boundaries retained by implementation/tests

Issue #612 separately records the implementation chain used for automatic enrollment/reconnect: PRs #664, #666, #667, #668 and #669. Its completion audit ties stable Device ID, bounded bootstrap, per-device credential, Keychain persistence, automatic reconnect and the physical run above together.

## Requirement mapping

| Requirement | Evidence supported by #609/#612 | Audit result |
| --- | --- | --- |
| `DEV-I-001` iPhone Worker | real iPhone enrolled, received a bounded task, executed `ios-tooling`, returned a verified result | exact-SHA physical evidence exists |
| `DEV-I-002` stable device identity | #612 records stable Device ID implementation and completion against the physical validation path | exact-SHA physical evidence exists |
| `DEV-I-003` supported task delivery | `QUEUED -> DELIVERED -> VERIFIED RESULT physical=true` for `iphone-physical-e2e-004` | exact-SHA physical evidence exists |
| `DEV-I-004` signed result | #609 records an HMAC-signed result accepted by the Bridge | exact-SHA physical evidence exists |
| `DEV-I-005` reconnect | #609 records reconnect after Bridge restart/port change; #612 records automatic reconnect implementation | exact-SHA physical evidence exists |
| `DEV-I-006` Keychain credential | #609 records persisted Keychain credential; #612 records Keychain persistence implementation | exact-SHA physical evidence exists |

## What this does not prove

This audit is deliberately narrower than a P9 current-product acceptance run.

- It does not claim a fresh physical run on the current repository head.
- It does not claim unrestricted resident/background execution on iOS. `DEV-I-007` remains subject to iOS lifecycle/background constraints and must retain a safe fallback.
- It does not claim Android-equivalent full remote control on iPhone. `DEV-I-008` and Remote Assist capability badges must remain conservative where iOS does not expose equivalent control.
- It does not turn simulator, CI, source-contract tests, or this document into new PHYSICAL evidence.
- It does not authorize credential, permission, billing, deployment, publication, or Human Gate changes.

Final P9 acceptance must still bind any required current-product physical revalidation to the exact commit actually tested. Historical exact-SHA evidence may be reused only for the capability facts it directly observed; later code changes must not be silently assumed equivalent.

## Provenance

- Issue #609: `GAI final validation: physical iPhone app, transport, and captured E2E`
- Issue #612: `iPhone Worker: automatic local enrollment and reconnect`
- Physical evidence SHA: `553b58a40c0ce2bcd341911c84f06d969e1a6380`
- Physical task marker: `iphone-physical-e2e-004`
- Implementation chain recorded by #612: PRs #664/#666/#667/#668/#669

No secret, private key, enrollment token, password, or credential value is copied into this audit.
