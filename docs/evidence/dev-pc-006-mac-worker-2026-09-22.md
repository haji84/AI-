# DEV-PC-006 Mac Worker software evidence

Date: 2026-09-22
Issue: #1175
Requirement: DEV-PC-006

## Scope proven in this change

- A bounded Mac Worker goal executor uses the existing `macos-tooling` capability through the existing MacBook worker adapter.
- The only supported goal kind is a fixed `quality-gate` plan: `lint -> test -> build`.
- The bridge is injected and must declare `platform: macos`; there is no Production/native bridge wiring in this change.
- Workspace and optional target are allowlisted; arbitrary command fields and unsupported goal kinds are rejected before bridge execution.
- Every step must return execution success, macOS/MacBook identity, `status=PASS`, `exitCode=0`, and at least one bounded evidence reference.
- Goal-level PASS is fail-closed: missing, duplicate, unexpected, failed, unverified, or non-Mac step evidence prevents completion.
- Execution stops on the first step that cannot be independently verified.
- The DEV-PC-006 regression test is included in `test:p8-security`.

## Evidence boundary

This is CODE/UNIT/INTEGRATION/SECURITY evidence only. It does not prove native Mac execution, owner physical acceptance, Production deployment, independent audit, or AGI behavior. DEV-PC-006 must remain PARTIAL until the required native/PHYSICAL evidence exists.

No device app version, device enrollment, secret, credential, permission, firewall, billing, or Human Gate setting is changed by this work.
