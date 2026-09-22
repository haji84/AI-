# JARVIS DEV-PC-007 software evidence

Requirement: `DEV-PC-007` — Platform-specific capability manifest

Status for this implementation slice: SOFTWARE READY / PHYSICAL PENDING

## Implemented

- Explicit manifests exist for `windows`, `macos`, `ios`, `android`, and `linux`.
- Platform-bound tooling capabilities are fail-closed:
  - `windows-tooling` -> Windows only
  - `macos-tooling` -> macOS only
  - `ios-tooling` -> iOS only
  - `android-tooling` -> Android only
  - Linux does not claim a platform tooling capability that does not exist in the current capability type.
- Existing shared capabilities remain portable rather than inventing unsupported platform restrictions.
- Worker manifests are deterministic snapshots of platform, declared capabilities, execution modes, and network requirement.
- Duplicate capabilities, unknown capabilities, duplicate execution modes, and cross-platform tooling claims are rejected.
- `CommonWorkerRuntime` validates the descriptor before a capability handler can be registered or executed, so current ZBook, MacBook, iPhone, and Android adapters inherit the boundary without native/device changes.

## Verification contract

`tests/jarvis-devpc007-platform-capability-manifest.test.ts` covers:

1. complete five-platform manifest registry,
2. current ZBook/MacBook/iPhone/Android profile integration,
3. cross-platform tooling rejection before execution,
4. duplicate/unknown capability rejection,
5. portable shared capability behavior,
6. Linux rejection of foreign platform tooling,
7. duplicate execution-mode rejection.

Repository CI remains responsible for lint, full tests, P8 Security Regression Suite, build, and production health checks.

## Safety / evidence boundary

This change does not update device app versions, enroll/re-enroll devices, modify secrets or credentials, change permissions/firewall/billing, weaken Human Gates, or add Production/native device wiring.

No PHYSICAL, independent-audit, recovery-success, or AGI evidence is claimed. DEV-PC-007 remains `PARTIAL` until any canonical PHYSICAL evidence requirement is satisfied on real supported hardware.
