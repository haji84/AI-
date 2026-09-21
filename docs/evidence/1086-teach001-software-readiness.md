# TEACH-001 software readiness evidence (#1086)

Requirement: `TEACH-001` — 全端末共通の実演・手順記憶.
Parents: #882 / #681. Related design issue: #734.

## Scope proven in software

- Android, iOS, Windows, macOS and Linux profiles use the same durable `TeachingStore` contract.
- A shared goal can retain device-specific manual procedures for all five platforms across process restart.
- Manual procedures remain `DRAFT`, retain Human-Gated steps, and do not inherit verification or automatic execution authority.
- Credential-like manual content is rejected before persistence.
- Corrupt persisted teaching evidence fails closed rather than silently resetting to an empty trusted state.

Dedicated regression: `tests/jarvis-teach001-common-memory.test.ts`.
Existing implementation: `src/jarvis/teaching.ts`, `src/jarvis/teaching-runtime.ts`, `src/app/jarvis/TeachingControls.tsx`, `src/app/jarvis/teach/page.tsx`.

## Boundary not claimed

This evidence does not prove PHYSICAL teaching/replay on any device. It does not add or claim native automatic-control adapters for iOS, Windows, macOS or Linux. Android's existing Remote Gateway path remains the only currently connected automatic observation/control route documented by #734. Cross-platform automatic replay remains separate adapter/TEACH-004 work and requires truthful platform-specific verification.

No device app version, enrollment, secret/credential, permission, firewall, billing, Human Gate, paid-provider or Production device behavior is changed by #1086. Simulated or repository tests are not PHYSICAL evidence.

## Verification gate

The software slice is acceptable only when the exact PR head passes repository guard, lint, full tests, P8 Security Regression Suite, production build and production health. Merge is safe only because #1086 changes tests/evidence and does not change runtime/device behavior.
