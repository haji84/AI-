# JARVIS Product Specification

## Authority and completion

Parent Goal / DoD: [Issue #681](https://github.com/haji84/AI-/issues/681). This file is the sole product Requirement Ledger; `docs/jarvis-requirements.json` is its machine-readable mirror. Every requirement below must occur exactly once in both. Historical JARVIS v1 acceptance is retained as historical scope, not proof of this expanded program. Owner instruction: 2026-09-16 JST. Audit baseline: `5c8702a` (full SHA recorded during verification).

Completion requires every row to be VERIFIED with all required evidence classes, or PLATFORM_LIMITED with cited real platform restriction, implemented safe fallback, documentation and displayed UI capability. PARTIAL / MISSING / IMPLEMENTED_UNVERIFIED never count as complete. CODE or green CI cannot substitute for PHYSICAL or RECOVERY. Unavailable hardware, missing login, or unimplemented software is not a platform limitation. No AGI claim: #321 / R1–R20 remains a separate research track.

Statuses: VERIFIED, IMPLEMENTED_UNVERIFIED, PARTIAL, MISSING, PLATFORM_LIMITED. Evidence classes: CODE, UNIT, INTEGRATION, SECURITY, PHYSICAL, RECOVERY. Null last_verified_commit means the entire requirement has not been verified; source mappings do not imply execution. Prior Issue links are evidence leads pending direct review, not validated evidence records.

## Architecture and safety

Main host: ZBook / Windows, always on. MacBook: auxiliary / development / potential failover. External smartphone → cellular Internet → private encrypted Tailscale tailnet → ZBook → JARVIS → Broker / Remote Gateway → home Wi-Fi Android fleet. Android devices need not each install Tailscale. Router public port forwarding, Funnel, public Broker and public Remote Gateway are prohibited.

One user-visible JARVIS dynamically composes Planner, Executor, Verifier, Researcher, Device/Browser/PC/Mobile Worker, Recovery, Memory, Skill, Security and Auditor roles as needed. Work/Codex supplies model reasoning; no additional paid AI API path. Credentials, permissions, billing, irreversible/destructive operations and security/governance changes retain Human Gates. Routine low/medium work continues within authorized execution; bounded retries (maximum 3 per issue), durable next action and fail-visible behavior remain required.

## Phase ownership (Issue #681 P0–P10)

- P0: ledger, all-ID audit, mapping and conservative gap classification.
- P1: private remote access, ZBook main host first.
- P2: power/network recovery.
- P3: device live view / remote assist.
- P4: 100-device fleet, platform workers and zero/one-touch enrollment.
- P5: frozen JARVIS UI.
- P6: voice / context / gesture / phone remote.
- P7: autonomous completion, memory and offline-first loop.
- P8: security / privacy / resilience audit.
- P9: physical end-to-end acceptance.
- P10: release / owner-ready operations.

A phase assignment owns the remaining work; it does not mark the phase exit passed. Work independent of a physical gate may proceed, but the blocked exit stays open. Product release additionally requires no routine GitHub, terminal, manual startup, repeated enrollment or owner “continue” prompts.

## Requirements

The JSON blocks are the authoritative rows. Validate exact mirror and evidence gates with `node scripts/validate-jarvis-requirements.mjs`.

### NET-001

```json
{
  "id": "NET-001",
  "title": "外出先スマホのWi-FiをOFFにし4G/5G→private encrypted network→ZBook→JARVIS→Broker/Remote Gateway→Home Wi-Fi Workersへ接続",
  "description": "外出先スマホのWi-FiをOFFにし4G/5G→private encrypted network→ZBook→JARVIS→Broker/Remote Gateway→Home Wi-Fi Workersへ接続。Router Port Forwarding禁止。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/jarvis-remote-preflight.mjs",
    "docs/architecture/jarvis-remote-access.md"
  ],
  "test_refs": [
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### NET-002

```json
{
  "id": "NET-002",
  "title": "Tailscale等のPrivate Overlayを利用しPublic Funnelを使用しない",
  "description": "Tailscale等のPrivate Overlayを利用しPublic Funnelを使用しない。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/jarvis-remote-preflight.mjs",
    "docs/architecture/jarvis-remote-access.md"
  ],
  "test_refs": [
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### NET-003

```json
{
  "id": "NET-003",
  "title": "100台のAndroid全台へTailscaleを入れずZBookがprivate ingressとLAN Worker群を橋渡しする",
  "description": "100台のAndroid全台へTailscaleを入れずZBookがprivate ingressとLAN Worker群を橋渡しする。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/jarvis-remote-preflight.mjs",
    "docs/architecture/jarvis-remote-access.md"
  ],
  "test_refs": [
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1: 100台のAndroid全台へTailscaleを入れずZBookがprivate ingressとLAN Worker群を橋渡しする。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### NET-004

```json
{
  "id": "NET-004",
  "title": "Internet/Wi-Fi切断から再登録なしで自動復帰",
  "description": "Internet/Wi-Fi切断から再登録なしで自動復帰。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/jarvis-remote-preflight.mjs",
    "docs/architecture/jarvis-remote-access.md"
  ],
  "test_refs": [
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1: Internet/Wi-Fi切断から再登録なしで自動復帰。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### NET-005

```json
{
  "id": "NET-005",
  "title": "Owner authenticationを維持",
  "description": "Owner authenticationを維持。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/app/owner-auth.ts",
    "src/app/api/jarvis/broker.ts"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1: Owner authenticationを維持。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### NET-006

```json
{
  "id": "NET-006",
  "title": "Signed worker request/resultを維持",
  "description": "Signed worker request/resultを維持。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1: Signed worker request/resultを維持。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### NET-007

```json
{
  "id": "NET-007",
  "title": "Nonce/replay/clock protectionを維持",
  "description": "Nonce/replay/clock protectionを維持。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1: Nonce/replay/clock protectionを維持。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### HOST-001

```json
{
  "id": "HOST-001",
  "title": "ZBook/Windowsを家側常時稼働Main Hostとする",
  "description": "ZBook/Windowsを家側常時稼働Main Hostとする。",
  "phase": "P1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/jarvis-managed-process.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### HOST-002

```json
{
  "id": "HOST-002",
  "title": "MacBookは補助Host/development/failover候補",
  "description": "MacBookは補助Host/development/failover候補。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "docs/architecture/jarvis-remote-access.md",
    "scripts/install-jarvis-remote-launchdaemon-macos.sh"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Mac補助ホストとしての実機failoverは未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P2: MacBookは補助Host/development/failover候補。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### HOST-003

```json
{
  "id": "HOST-003",
  "title": "Windows起動後にdashboard、Broker、Remote Gateway、supervisor、private network entry、health monitoringが手動起動なしで稼働",
  "description": "Windows起動後にdashboard、Broker、Remote Gateway、supervisor、private network entry、health monitoringが手動起動なしで稼働。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/jarvis-managed-process.mjs",
    "scripts/inspect-jarvis-startup-windows.ps1"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### HOST-004

```json
{
  "id": "HOST-004",
  "title": "プロセス異常終了時にbounded exponential backoffで自動再起動",
  "description": "プロセス異常終了時にbounded exponential backoffで自動再起動。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/jarvis-managed-process.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### HOST-005

```json
{
  "id": "HOST-005",
  "title": "Internet/Wi-Fi復帰後に自動再接続",
  "description": "Internet/Wi-Fi復帰後に自動再接続。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/jarvis-managed-process.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### HOST-006

```json
{
  "id": "HOST-006",
  "title": "短時間停電はZBook battery/UPSでの継続を考慮",
  "description": "短時間停電はZBook battery/UPSでの継続を考慮。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "docs/architecture/jarvis-power-recovery.md",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/inspect-jarvis-startup-windows.ps1"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### HOST-007

```json
{
  "id": "HOST-007",
  "title": "AC断→復電→BIOS/UEFI AC Restore→Windows Boot→Tailscale unattended→JARVIS automatic startup→Broker/Gateway→Android reconnect→Remote access recovery",
  "description": "AC断→復電→BIOS/UEFI AC Restore→Windows Boot→Tailscale unattended→JARVIS automatic startup→Broker/Gateway→Android reconnect→Remote access recovery。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/inspect-jarvis-startup-windows.ps1"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### HOST-008

```json
{
  "id": "HOST-008",
  "title": "BIOS設定が必要な場合はコードで可能と偽らず一度だけ必要なHuman Gateを明示",
  "description": "BIOS設定が必要な場合はコードで可能と偽らず一度だけ必要なHuman Gateを明示。",
  "phase": "P2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "docs/architecture/jarvis-power-recovery.md",
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/inspect-jarvis-startup-windows.ps1"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### FLEET-001

```json
{
  "id": "FLEET-001",
  "title": "最大100台を一元管理",
  "description": "最大100台を一元管理。 ADR 0013のfleet groupsで管理する。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 最大100台を一元管理。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-002

```json
{
  "id": "FLEET-002",
  "title": "100台分の手入力を不要にする",
  "description": "100台分の手入力を不要にする。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 100台分の手入力を不要にする。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-003

```json
{
  "id": "FLEET-003",
  "title": "固定端末登録URL→server側fresh短時間token→Worker enrollment→完了",
  "description": "固定端末登録URL→server側fresh短時間token→Worker enrollment→完了。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 固定端末登録URL→server側fresh短時間token→Worker enrollment→完了。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-004

```json
{
  "id": "FLEET-004",
  "title": "既存Androidを簡単登録",
  "description": "既存Androidを簡単登録。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 既存Androidを簡単登録。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-005

```json
{
  "id": "FLEET-005",
  "title": "新品/初期化済みAndroidはOSが許せばQR Zero-Touch/Device Owner provisioning",
  "description": "新品/初期化済みAndroidはOSが許せばQR Zero-Touch/Device Owner provisioning。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 新品/初期化済みAndroidはOSが許せばQR Zero-Touch/Device Owner provisioning。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-006

```json
{
  "id": "FLEET-006",
  "title": "既存使用中Androidにも可能な範囲でone-touch onboarding",
  "description": "既存使用中Androidにも可能な範囲でone-touch onboarding。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 既存使用中Androidにも可能な範囲でone-touch onboarding。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-007

```json
{
  "id": "FLEET-007",
  "title": "各Deviceにidentity/signing/capability/platform/connectivity/healthを保持",
  "description": "各Deviceにidentity/signing/capability/platform/connectivity/healthを保持。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 各Deviceにidentity/signing/capability/platform/connectivity/healthを保持。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-008

```json
{
  "id": "FLEET-008",
  "title": "再起動・切断後は再Enrollmentなしで復帰",
  "description": "再起動・切断後は再Enrollmentなしで復帰。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts",
    "src/jarvis/enrollment.ts",
    "src/app/jarvis/enroll/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 再起動・切断後は再Enrollmentなしで復帰。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-009

```json
{
  "id": "FLEET-009",
  "title": "端末交換フロー",
  "description": "端末交換フロー。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "失効identityの基礎はあるが交換UI・旧鍵失効・新端末移行の統合フロー未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 端末交換フロー。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-010

```json
{
  "id": "FLEET-010",
  "title": "100-node capacity regression test",
  "description": "100-node capacity regression test。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts"
  ],
  "test_refs": [
    "tests/jarvis-v1-foundation.test.ts",
    "tests/jarvis-final-fleet-acceptance.test.ts"
  ],
  "evidence_refs": [],
  "status": "IMPLEMENTED_UNVERIFIED",
  "blocker": "既存capacity regressionを現在の監査対象commitで再実行し証拠を紐付ける。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 100-node capacity regression test。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### FLEET-011

```json
{
  "id": "FLEET-011",
  "title": "101台目等のcapacity overflowを安全に拒否",
  "description": "101台目等のcapacity overflowを安全に拒否。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/fleet-manager.ts"
  ],
  "test_refs": [
    "tests/jarvis-v1-foundation.test.ts",
    "tests/jarvis-final-fleet-acceptance.test.ts"
  ],
  "evidence_refs": [],
  "status": "IMPLEMENTED_UNVERIFIED",
  "blocker": "既存capacity regressionを現在の監査対象commitで再実行し証拠を紐付ける。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: 101台目等のcapacity overflowを安全に拒否。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-001

```json
{
  "id": "DEV-A-001",
  "title": "Android Worker常駐",
  "description": "Android Worker常駐。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Android Worker常駐。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-002

```json
{
  "id": "DEV-A-002",
  "title": "Task受信",
  "description": "Task受信。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Task受信。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-003

```json
{
  "id": "DEV-A-003",
  "title": "UI操作",
  "description": "UI操作。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Accessibility実装がある。各操作の機種別permissionと実機結果を未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: UI操作。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-004

```json
{
  "id": "DEV-A-004",
  "title": "アプリ起動",
  "description": "アプリ起動。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: アプリ起動。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-005

```json
{
  "id": "DEV-A-005",
  "title": "tap",
  "description": "tap。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Accessibility実装がある。各操作の機種別permissionと実機結果を未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: tap。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-006

```json
{
  "id": "DEV-A-006",
  "title": "swipe",
  "description": "swipe。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Accessibility実装がある。各操作の機種別permissionと実機結果を未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: swipe。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-007

```json
{
  "id": "DEV-A-007",
  "title": "text input",
  "description": "text input。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Accessibility実装がある。各操作の機種別permissionと実機結果を未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: text input。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-008

```json
{
  "id": "DEV-A-008",
  "title": "Back/Home/app switch",
  "description": "Back/Home/app switch。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisAccessibilityService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Accessibility実装がある。各操作の機種別permissionと実機結果を未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Back/Home/app switch。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-009

```json
{
  "id": "DEV-A-009",
  "title": "Screenshot",
  "description": "Screenshot。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-gateway.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "ADBスクリーンショット経路あり。resident Workerとしての統合とpermission/実機証拠が未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Screenshot。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-010

```json
{
  "id": "DEV-A-010",
  "title": "Supported recording",
  "description": "Supported recording。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/remote-assist-recording.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/app/jarvis/JarvisConsole.tsx"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-recording.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "PNG frame sequenceとUI開始/停止あり。audit admission、capture timeout/stop、認証付き閲覧/export、実機Evidenceが不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### DEV-A-011

```json
{
  "id": "DEV-A-011",
  "title": "Reboot後自動復帰",
  "description": "Reboot後自動復帰。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BootReceiver.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisPollWorker.kt",
    "android/jarvis-worker/app/src/main/AndroidManifest.xml"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "BootReceiver/WorkManagerは存在。再起動後に自動復帰する実機Evidence未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Reboot後自動復帰。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-012

```json
{
  "id": "DEV-A-012",
  "title": "Wi-Fi再接続",
  "description": "Wi-Fi再接続。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Wi-Fi再接続。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-013

```json
{
  "id": "DEV-A-013",
  "title": "Offline queue",
  "description": "Offline queue。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Offline queue。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-014

```json
{
  "id": "DEV-A-014",
  "title": "Offline→reconnect→resume",
  "description": "Offline→reconnect→resume。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Offline→reconnect→resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-A-015

```json
{
  "id": "DEV-A-015",
  "title": "Device Owner機能が必要な能力をCapabilityとして明示",
  "description": "Device Owner機能が必要な能力をCapabilityとして明示。 ADR 0013のDevice Wake/Lock/Dedicated Device Managerを含み、personal lockはHuman TakeoverとしPINの中央保存・自動入力で回避しない。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/BrokerClient.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/JarvisCommandService.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/TaskExecutor.kt"
  ],
  "test_refs": [
    "tests/jarvis-worker-stable-contract.test.mjs",
    "tests/gai-android-worker-adapter.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Device Owner機能が必要な能力をCapabilityとして明示。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-001

```json
{
  "id": "DEV-I-001",
  "title": "iPhone Worker",
  "description": "iPhone Worker。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: iPhone Worker。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-002

```json
{
  "id": "DEV-I-002",
  "title": "Stable device identity",
  "description": "Stable device identity。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Stable device identity。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-003

```json
{
  "id": "DEV-I-003",
  "title": "Supported task delivery",
  "description": "Supported task delivery。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Supported task delivery。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-004

```json
{
  "id": "DEV-I-004",
  "title": "Signed result",
  "description": "Signed result。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Signed result。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-005

```json
{
  "id": "DEV-I-005",
  "title": "Reconnect",
  "description": "Reconnect。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Reconnect。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-006

```json
{
  "id": "DEV-I-006",
  "title": "Keychain credential",
  "description": "Keychain credential。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/gai/iphone-worker-bridge.ts"
  ],
  "test_refs": [
    "src/gai/iphone-worker-bridge.test.ts",
    "scripts/iphone-bridge-auto-enrollment.test.mjs"
  ],
  "evidence_refs": [
    "https://github.com/haji84/AI-/issues/609",
    "https://github.com/haji84/AI-/issues/612"
  ],
  "status": "PARTIAL",
  "blocker": "PROJECT_STATE.mdに過去の実機PASS記載。一次Evidence内容・対象commit・現行統合への適用を確認するまでVERIFIEDにしない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Keychain credential。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-007

```json
{
  "id": "DEV-I-007",
  "title": "iOS Background制約を無視しない",
  "description": "iOS Background制約を無視しない。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/device-capability-runtime.ts",
    "apps/ios-worker/Sources/WorkerRuntime.swift"
  ],
  "test_refs": [
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "iOS resident mode拒否は実装済み。公式OS制約の根拠・safe fallback・JARVIS capability badgeの全条件は未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: iOS Background制約を無視しない。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-I-008

```json
{
  "id": "DEV-I-008",
  "title": "Android同等の自由操作ができない場合view-only/limited-control等を明示",
  "description": "Android同等の自由操作ができない場合view-only/limited-control等を明示。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/device-capability-runtime.ts",
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/jarvis/remote-assist-node-capability.ts",
    "src/app/jarvis/devices/page.tsx"
  ],
  "test_refs": [
    "tests/gai-device-capability-runtime.test.ts",
    "tests/jarvis-remote-assist-node-capability.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "端末別badgeとiOSの保守的degradation実装済み。実動transport・fallback実機証明と公式platform制約根拠は未確認。FULL_MANAGEMENTは未証明。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### DEV-PC-001

```json
{
  "id": "DEV-PC-001",
  "title": "ZBook PC Worker",
  "description": "ZBook PC Worker。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: ZBook PC Worker。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-002

```json
{
  "id": "DEV-PC-002",
  "title": "Browser operation",
  "description": "Browser operation。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Browser operation。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-003

```json
{
  "id": "DEV-PC-003",
  "title": "Filesystem operation",
  "description": "Filesystem operation。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Filesystem operation。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-004

```json
{
  "id": "DEV-PC-004",
  "title": "Development operation",
  "description": "Development operation。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Development operation。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-005

```json
{
  "id": "DEV-PC-005",
  "title": "Office等のPC capability",
  "description": "Office等のPC capability。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Office等のPC capability。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-006

```json
{
  "id": "DEV-PC-006",
  "title": "Mac Worker",
  "description": "Mac Worker。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Mac Worker。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### DEV-PC-007

```json
{
  "id": "DEV-PC-007",
  "title": "Platform-specific capability manifest",
  "description": "Platform-specific capability manifest。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/initial-worker-adapters.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-initial-worker-adapters.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P4: Platform-specific capability manifest。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### RA-001

```json
{
  "id": "RA-001",
  "title": "Devices画面から端末画面を確認",
  "description": "Devices画面から端末画面を確認。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-002

```json
{
  "id": "RA-002",
  "title": "Single device view",
  "description": "Single device view。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-003

```json
{
  "id": "RA-003",
  "title": "2画面split",
  "description": "2画面split。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/RemoteAssistMultiView.tsx",
    "src/jarvis/remote-assist-view.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-view.test.ts",
    "tests/jarvis-remote-assist-multiview-ui.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "2/4分割と12台windowのfleet表示実装済み。実機同時表示・切断復帰未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-004

```json
{
  "id": "RA-004",
  "title": "4画面split",
  "description": "4画面split。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/RemoteAssistMultiView.tsx",
    "src/jarvis/remote-assist-view.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-view.test.ts",
    "tests/jarvis-remote-assist-multiview-ui.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "2/4分割と12台windowのfleet表示実装済み。実機同時表示・切断復帰未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-005

```json
{
  "id": "RA-005",
  "title": "Fleet thumbnail/grid",
  "description": "Fleet thumbnail/grid。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/RemoteAssistMultiView.tsx",
    "src/jarvis/remote-assist-view.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-view.test.ts",
    "tests/jarvis-remote-assist-multiview-ui.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "2/4分割と12台windowのfleet表示実装済み。実機同時表示・切断復帰未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-006

```json
{
  "id": "RA-006",
  "title": "Device capability badge: VIEW ONLY / CONTROLLABLE / FULL MANAGEMENT",
  "description": "Device capability badge: VIEW ONLY / CONTROLLABLE / FULL MANAGEMENT。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/remote-assist-node-capability.ts",
    "src/app/jarvis/devices/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-node-capability.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "端末別badgeとiOSの保守的degradation実装済み。実動transport・fallback実機証明と公式platform制約根拠は未確認。FULL_MANAGEMENTは未証明。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-007

```json
{
  "id": "RA-007",
  "title": "Android/PC remote tap/click",
  "description": "Android/PC remote tap/click。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-008

```json
{
  "id": "RA-008",
  "title": "Remote text",
  "description": "Remote text。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-009

```json
{
  "id": "RA-009",
  "title": "Remote scroll/swipe",
  "description": "Remote scroll/swipe。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-010

```json
{
  "id": "RA-010",
  "title": "Back/Home",
  "description": "Back/Home。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-011

```json
{
  "id": "RA-011",
  "title": "App switch",
  "description": "App switch。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-012

```json
{
  "id": "RA-012",
  "title": "Screenshot",
  "description": "Screenshot。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-gateway.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-013

```json
{
  "id": "RA-013",
  "title": "Recording",
  "description": "Recording。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/remote-assist-recording.ts",
    "src/app/api/jarvis/remote/route.ts",
    "src/app/jarvis/JarvisConsole.tsx"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-recording.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "PNG frame sequenceとUI開始/停止あり。audit admission、capture timeout/stop、認証付き閲覧/export、実機Evidenceが不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-014

```json
{
  "id": "RA-014",
  "title": "Remote Assist Session",
  "description": "Remote Assist Session。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/control-plane.ts",
    "src/app/jarvis/JarvisConsole.tsx",
    "src/jarvis/remote-assist.ts",
    "src/app/api/jarvis/remote/route.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "owner/serial/session/TTL実装と単体試験あり。実API認証・期限切れ統合と実機Evidence不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-015

```json
{
  "id": "RA-015",
  "title": "Session auth",
  "description": "Session auth。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/owner-auth.ts",
    "src/app/api/jarvis/remote/route.ts",
    "scripts/jarvis-remote-gateway.ts",
    "scripts/jarvis-remote-access-lib.mjs",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts",
    "scripts/jarvis-remote-access.test.mjs",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "owner/serial/session/TTL実装と単体試験あり。実API認証・期限切れ統合と実機Evidence不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-016

```json
{
  "id": "RA-016",
  "title": "Encryption",
  "description": "Encryption。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/owner-auth.ts",
    "src/app/api/jarvis/remote/route.ts",
    "scripts/jarvis-remote-gateway.ts",
    "scripts/jarvis-remote-access-lib.mjs"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P3: Encryption。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### RA-017

```json
{
  "id": "RA-017",
  "title": "Timeout",
  "description": "Timeout。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/control-plane.ts",
    "src/app/jarvis/JarvisConsole.tsx",
    "src/jarvis/remote-assist.ts",
    "src/app/api/jarvis/remote/route.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "owner/serial/session/TTL実装と単体試験あり。実API認証・期限切れ統合と実機Evidence不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-018

```json
{
  "id": "RA-018",
  "title": "Audit log",
  "description": "Audit log。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/control-plane.ts",
    "src/app/jarvis/JarvisConsole.tsx",
    "src/jarvis/remote-assist-audit.ts",
    "src/jarvis/remote-assist.ts",
    "src/app/api/jarvis/remote/route.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-audit.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "永続JSONL監査とprivacy filteringあり。録画開始監査の失敗時にcaptureが先行する問題、API negative coverageが残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-019

```json
{
  "id": "RA-019",
  "title": "AI作業→UI変化/失敗→OwnerへHuman Takeover提示→Live View→Owner操作→「続きやって」→画面再観測→自律処理再開",
  "description": "AI作業→UI変化/失敗→OwnerへHuman Takeover提示→Live View→Owner操作→「続きやって」→画面再観測→自律処理再開。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/control-plane.ts",
    "src/app/jarvis/JarvisConsole.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-console.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "nodeIdとserialの完全一致時だけUI連携。再観測・異なるidentityの正式mapping・実機failure/takeover/resume未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-020

```json
{
  "id": "RA-020",
  "title": "Human Takeover前後の状態を保存",
  "description": "Human Takeover前後の状態を保存。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/control-plane.ts",
    "src/app/jarvis/JarvisConsole.tsx"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-console.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "nodeIdとserialの完全一致時だけUI連携。再観測・異なるidentityの正式mapping・実機failure/takeover/resume未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-021

```json
{
  "id": "RA-021",
  "title": "Pointing/gestureだけではdestructive actionを許可しない",
  "description": "Pointing/gestureだけではdestructive actionを許可しない。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-pointer-policy.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "pointer/gesture provenanceによる保護操作のnegative policy testsあり。command routing全経路のpolicy適用を統合検証する。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### RA-022

```json
{
  "id": "RA-022",
  "title": "iPhoneはOS制約に応じてgraceful degradation",
  "description": "iPhoneはOS制約に応じてgraceful degradation。",
  "phase": "P3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/device-capability-runtime.ts",
    "apps/ios-worker/Sources/WorkerRuntime.swift",
    "src/jarvis/remote-assist-node-capability.ts",
    "src/app/jarvis/devices/page.tsx"
  ],
  "test_refs": [
    "tests/gai-device-capability-runtime.test.ts",
    "tests/jarvis-remote-assist-node-capability.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "端末別badgeとiOSの保守的degradation実装済み。実動transport・fallback実機証明と公式platform制約根拠は未確認。FULL_MANAGEMENTは未証明。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### UI-001

```json
{
  "id": "UI-001",
  "title": "Home: 24h clock/date/JARVIS status/connectivity/Current Goal/progress/NOW/NEXT/Human Gate/active workers/device health/activity/failures/suggestions",
  "description": "Home: 24h clock/date/JARVIS status/connectivity/Current Goal/progress/NOW/NEXT/Human Gate/active workers/device health/activity/failures/suggestions。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Home: 24h clock/date/JARVIS status/connectivity/Current Goal/progress/NOW/NEXT/Human Gate/active workers/device health/activity/failures/suggestions。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-002

```json
{
  "id": "UI-002",
  "title": "Devices",
  "description": "Devices。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Devices。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-003

```json
{
  "id": "UI-003",
  "title": "Tasks",
  "description": "Tasks。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Tasks。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-004

```json
{
  "id": "UI-004",
  "title": "Research",
  "description": "Research。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Research機能は別のAI会社画面。JARVISの一貫したResearch画面への統合未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Research。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-005

```json
{
  "id": "UI-005",
  "title": "Settings",
  "description": "Settings。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Settings。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-006

```json
{
  "id": "UI-006",
  "title": "未来的JARVIS表示と可読性の両立",
  "description": "未来的JARVIS表示と可読性の両立。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: 未来的JARVIS表示と可読性の両立。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-007

```json
{
  "id": "UI-007",
  "title": "20以上のtheme/persona preset",
  "description": "20以上のtheme/persona preset。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: 20以上のtheme/persona preset。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-008

```json
{
  "id": "UI-008",
  "title": "ThemeとPersonaは独立設定",
  "description": "ThemeとPersonaは独立設定。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: ThemeとPersonaは独立設定。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-009

```json
{
  "id": "UI-009",
  "title": "Voiceは独立設定",
  "description": "Voiceは独立設定。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Voiceは独立設定。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-010

```json
{
  "id": "UI-010",
  "title": "Accent Colorは独立設定",
  "description": "Accent Colorは独立設定。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Accent Colorは独立設定。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-011

```json
{
  "id": "UI-011",
  "title": "Layoutは独立設定",
  "description": "Layoutは独立設定。Theme/Persona/Voice/Color/Layoutを独立管理。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Layoutは独立設定。Theme/Persona/Voice/Color/Layoutを独立管理。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-012

```json
{
  "id": "UI-012",
  "title": "Widget drag/move",
  "description": "Widget drag/move。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Widget drag/move。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-013

```json
{
  "id": "UI-013",
  "title": "Widget resize",
  "description": "Widget resize。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Widget resize。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-014

```json
{
  "id": "UI-014",
  "title": "Widget hide/show",
  "description": "Widget hide/show。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Widget hide/show。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-015

```json
{
  "id": "UI-015",
  "title": "Layout preset",
  "description": "Layout preset。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Layout preset。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-016

```json
{
  "id": "UI-016",
  "title": "Screen別Layout profile",
  "description": "Screen別Layout profile。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Screen別Layout profile。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-017

```json
{
  "id": "UI-017",
  "title": "Undo",
  "description": "Undo。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Undo。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-018

```json
{
  "id": "UI-018",
  "title": "Redo",
  "description": "Redo。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Redo。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-019

```json
{
  "id": "UI-019",
  "title": "Reset",
  "description": "Reset。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Reset。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-020

```json
{
  "id": "UI-020",
  "title": "Universal Command Bar",
  "description": "Universal Command Bar。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Universal Command Bar。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-021

```json
{
  "id": "UI-021",
  "title": "Universal Search",
  "description": "Universal Search。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Universal Search。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-022

```json
{
  "id": "UI-022",
  "title": "Notification Priority",
  "description": "Notification Priority。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Notification Priority。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-023

```json
{
  "id": "UI-023",
  "title": "Focus Mode",
  "description": "Focus Mode。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Focus Mode。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-024

```json
{
  "id": "UI-024",
  "title": "Distance Mode",
  "description": "Distance Mode。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Distance Mode。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-025

```json
{
  "id": "UI-025",
  "title": "3〜5m離れて見える拡大UI",
  "description": "3〜5m離れて見える拡大UI。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: 3〜5m離れて見える拡大UI。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-026

```json
{
  "id": "UI-026",
  "title": "Mobile Mode",
  "description": "Mobile Mode。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Mobile Mode。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-027

```json
{
  "id": "UI-027",
  "title": "Adaptive Layout",
  "description": "Adaptive Layout。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Adaptive Layout。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-028

```json
{
  "id": "UI-028",
  "title": "Privacy Mode",
  "description": "Privacy Mode。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Privacy Mode。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-029

```json
{
  "id": "UI-029",
  "title": "Sensitive panel blackout",
  "description": "Sensitive panel blackout。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Sensitive panel blackout。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-030

```json
{
  "id": "UI-030",
  "title": "Kiosk/Read-only Mode",
  "description": "Kiosk/Read-only Mode。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Kiosk/Read-only Mode。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-031

```json
{
  "id": "UI-031",
  "title": "Accessibility",
  "description": "Accessibility。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Accessibility。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-032

```json
{
  "id": "UI-032",
  "title": "Keyboard navigation",
  "description": "Keyboard navigation。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Keyboard navigation。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-033

```json
{
  "id": "UI-033",
  "title": "Captions",
  "description": "Captions。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Captions。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-034

```json
{
  "id": "UI-034",
  "title": "Offline indicator",
  "description": "Offline indicator。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Offline indicator。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-035

```json
{
  "id": "UI-035",
  "title": "Reconnecting indicator",
  "description": "Reconnecting indicator。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Reconnecting indicator。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-036

```json
{
  "id": "UI-036",
  "title": "Syncing indicator",
  "description": "Syncing indicator。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現行JARVIS UIに当該製品機能を未発見。P5で実装と操作検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Syncing indicator。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### UI-037

```json
{
  "id": "UI-037",
  "title": "Device Live View統合",
  "description": "Device Live View統合。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css",
    "src/app/api/jarvis/remote/route.ts",
    "src/jarvis/remote-assist.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android screenshot/inputとsession UI実装済み。PC transport、browser/API統合と実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### UI-038

```json
{
  "id": "UI-038",
  "title": "Japanese-first UI",
  "description": "Japanese-first UI。",
  "phase": "P5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/jarvis.css"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P5: Japanese-first UI。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-001

```json
{
  "id": "INT-001",
  "title": "Voice command",
  "description": "Voice command。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Voice command。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-002

```json
{
  "id": "INT-002",
  "title": "Text command",
  "description": "Text command。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "URL task入力のみ。任意Goalを同一conversationで扱うtext commandの統合は未証明。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Text command。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-003

```json
{
  "id": "INT-003",
  "title": "Touch",
  "description": "Touch。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/mobile/MobileCommander.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Touch操作UIあり。全主要フローのモバイル実機検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Touch。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-004

```json
{
  "id": "INT-004",
  "title": "Voice/text同一conversation context",
  "description": "Voice/text同一conversation context。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Voice/text同一conversation context。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-005

```json
{
  "id": "INT-005",
  "title": "Screen-context reference「これ」",
  "description": "Screen-context reference「これ」。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Screen-context reference「これ」。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-006

```json
{
  "id": "INT-006",
  "title": "Screen-context reference「さっきのやつ」",
  "description": "Screen-context reference「さっきのやつ」。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Screen-context reference「さっきのやつ」。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-007

```json
{
  "id": "INT-007",
  "title": "Screen-context reference「2番目」",
  "description": "Screen-context reference「2番目」。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Screen-context reference「2番目」。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-008

```json
{
  "id": "INT-008",
  "title": "Voice Persona",
  "description": "Voice Persona。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Voice Persona。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-009

```json
{
  "id": "INT-009",
  "title": "Speech style",
  "description": "Speech style。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Speech style。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-010

```json
{
  "id": "INT-010",
  "title": "Barge-in",
  "description": "Barge-in。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Barge-in。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-011

```json
{
  "id": "INT-011",
  "title": "AI音声を途中で遮れる",
  "description": "AI音声を途中で遮れる。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: AI音声を途中で遮れる。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-012

```json
{
  "id": "INT-012",
  "title": "Push-to-talk",
  "description": "Push-to-talk。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Push-to-talk。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-013

```json
{
  "id": "INT-013",
  "title": "Mute",
  "description": "Mute。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Mute。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-014

```json
{
  "id": "INT-014",
  "title": "Caption",
  "description": "Caption。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Caption。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-015

```json
{
  "id": "INT-015",
  "title": "Quiet Hours",
  "description": "Quiet Hours。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Quiet Hours。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-016

```json
{
  "id": "INT-016",
  "title": "Priority speech queue",
  "description": "Priority speech queue。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Priority speech queue。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### INT-017

```json
{
  "id": "INT-017",
  "title": "Voice Human Gate",
  "description": "Voice Human Gate。音声でもHuman Gateを突破しない。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Voice Human Gate。音声でもHuman Gateを突破しない。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-001

```json
{
  "id": "GEST-001",
  "title": "Camera hand gesture",
  "description": "Camera hand gesture。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Camera hand gesture。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-002

```json
{
  "id": "GEST-002",
  "title": "Camera active indicator",
  "description": "Camera active indicator。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Camera active indicator。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-003

```json
{
  "id": "GEST-003",
  "title": "可能ならlocal processing",
  "description": "可能ならlocal processing。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: 可能ならlocal processing。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-004

```json
{
  "id": "GEST-004",
  "title": "False gesture protection",
  "description": "False gesture protection。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: False gesture protection。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-005

```json
{
  "id": "GEST-005",
  "title": "重要操作はgestureだけで確定しない",
  "description": "重要操作はgestureだけで確定しない。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: 重要操作はgestureだけで確定しない。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-006

```json
{
  "id": "GEST-006",
  "title": "Smartphone gyro/IMU pointer",
  "description": "Smartphone gyro/IMU pointer。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Smartphone gyro/IMU pointer。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-007

```json
{
  "id": "GEST-007",
  "title": "スマホをリモコン化",
  "description": "スマホをリモコン化。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: スマホをリモコン化。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### GEST-008

```json
{
  "id": "GEST-008",
  "title": "Distance Modeと連動",
  "description": "Distance Modeと連動。",
  "phase": "P6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P6: Distance Modeと連動。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-001

```json
{
  "id": "AUTO-001",
  "title": "One Front Door",
  "description": "One Front Door。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: One Front Door。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-002

```json
{
  "id": "AUTO-002",
  "title": "Goal persistence",
  "description": "Goal persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Goal persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-003

```json
{
  "id": "AUTO-003",
  "title": "DoD persistence",
  "description": "DoD persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: DoD persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-004

```json
{
  "id": "AUTO-004",
  "title": "Current State persistence",
  "description": "Current State persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Current State persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-005

```json
{
  "id": "AUTO-005",
  "title": "Decisions persistence",
  "description": "Decisions persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Decisions persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-006

```json
{
  "id": "AUTO-006",
  "title": "Deliverables persistence",
  "description": "Deliverables persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Deliverables persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-007

```json
{
  "id": "AUTO-007",
  "title": "Verification persistence",
  "description": "Verification persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Verification persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-008

```json
{
  "id": "AUTO-008",
  "title": "Next Action persistence",
  "description": "Next Action persistence。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/compass/store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/compass-store.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Next Action persistence。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-009

```json
{
  "id": "AUTO-009",
  "title": "Planner",
  "description": "Planner。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Planner。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-010

```json
{
  "id": "AUTO-010",
  "title": "Capability Router",
  "description": "Capability Router。 ADR 0013のpriority engine、scheduler、event engine、dependency graph、resource manager、power policy、network policyを用いて選択する。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/worker-runtime.ts",
    "src/gai/goal-loop-worker-executor.ts"
  ],
  "test_refs": [
    "tests/gai-goal-loop-worker-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Capability Router。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-011

```json
{
  "id": "AUTO-011",
  "title": "Dynamic worker selection",
  "description": "Dynamic worker selection。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/worker-runtime.ts",
    "src/gai/goal-loop-worker-executor.ts"
  ],
  "test_refs": [
    "tests/gai-goal-loop-worker-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Dynamic worker selection。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-012

```json
{
  "id": "AUTO-012",
  "title": "Dynamic role composition",
  "description": "Dynamic role composition。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-capability-team.ts",
    "src/orchestrator/team-composer.ts"
  ],
  "test_refs": [
    "tests/dynamic-multi-agent-runtime.test.ts",
    "tests/dynamic-capability-team.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Dynamic role composition。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-013

```json
{
  "id": "AUTO-013",
  "title": "Child Goal Gate",
  "description": "Child Goal Gate。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-capability-team.ts",
    "src/orchestrator/team-composer.ts"
  ],
  "test_refs": [
    "tests/dynamic-multi-agent-runtime.test.ts",
    "tests/dynamic-capability-team.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Child Goal Gate。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-014

```json
{
  "id": "AUTO-014",
  "title": "Context Partitioning",
  "description": "Context Partitioning。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-capability-team.ts",
    "src/orchestrator/team-composer.ts"
  ],
  "test_refs": [
    "tests/dynamic-multi-agent-runtime.test.ts",
    "tests/dynamic-capability-team.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Context Partitioning。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-015

```json
{
  "id": "AUTO-015",
  "title": "Executor",
  "description": "Executor。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Executor。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-016

```json
{
  "id": "AUTO-016",
  "title": "Verifier",
  "description": "Verifier。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Verifier。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-017

```json
{
  "id": "AUTO-017",
  "title": "Repair",
  "description": "Repair。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-healing-runtime.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/gai-self-healing-runtime.test.ts",
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Repair。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-018

```json
{
  "id": "AUTO-018",
  "title": "Replan",
  "description": "Replan。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-healing-runtime.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/gai-self-healing-runtime.test.ts",
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Replan。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-019

```json
{
  "id": "AUTO-019",
  "title": "Bounded retry",
  "description": "Bounded retry。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-healing-runtime.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/gai-self-healing-runtime.test.ts",
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Bounded retry。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-020

```json
{
  "id": "AUTO-020",
  "title": "Failure classification",
  "description": "Failure classification。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-healing-runtime.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/gai-self-healing-runtime.test.ts",
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Failure classification。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-021

```json
{
  "id": "AUTO-021",
  "title": "Ordinary LOW/MEDIUM auto-continue",
  "description": "Ordinary LOW/MEDIUM auto-continue。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Ordinary LOW/MEDIUM auto-continue。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-022

```json
{
  "id": "AUTO-022",
  "title": "Only genuine Human Gate interrupts",
  "description": "Only genuine Human Gate interrupts。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Only genuine Human Gate interrupts。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-023

```json
{
  "id": "AUTO-023",
  "title": "Restart resume",
  "description": "Restart resume。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Restart resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-024

```json
{
  "id": "AUTO-024",
  "title": "Offline resume",
  "description": "Offline resume。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Offline resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-025

```json
{
  "id": "AUTO-025",
  "title": "Reconnect resume",
  "description": "Reconnect resume。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Reconnect resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-026

```json
{
  "id": "AUTO-026",
  "title": "Verified completion only",
  "description": "Verified completion only。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Verified completion only。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-027

```json
{
  "id": "AUTO-027",
  "title": "Skill creation from verified evidence only",
  "description": "Skill creation from verified evidence only。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/skill-library.ts",
    "src/gai/governed-skill-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase12-skill-system.test.ts",
    "src/gai/governed-skill-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Skill creation from verified evidence only。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-028

```json
{
  "id": "AUTO-028",
  "title": "Self-improvement proposal",
  "description": "Self-improvement proposal。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Self-improvement proposal。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-029

```json
{
  "id": "AUTO-029",
  "title": "Sandbox before promotion",
  "description": "Sandbox before promotion。 ADR 0013のsimulation/dry-runおよびcanary executionを経て昇格する。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Sandbox before promotion。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-030

```json
{
  "id": "AUTO-030",
  "title": "Regression test",
  "description": "Regression test。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Regression test。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### AUTO-031

```json
{
  "id": "AUTO-031",
  "title": "Known-good rollback",
  "description": "Known-good rollback。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Known-good rollback。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-001

```json
{
  "id": "MEM-001",
  "title": "Working Memory",
  "description": "Working Memory。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Working Memory。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-002

```json
{
  "id": "MEM-002",
  "title": "Episodic Memory",
  "description": "Episodic Memory。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Episodic Memory。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-003

```json
{
  "id": "MEM-003",
  "title": "Semantic Memory",
  "description": "Semantic Memory。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Semantic Memory。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-004

```json
{
  "id": "MEM-004",
  "title": "Procedural Memory",
  "description": "Procedural Memory。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Procedural Memory。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-005

```json
{
  "id": "MEM-005",
  "title": "Memory provenance",
  "description": "Memory provenance。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Memory provenance。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-006

```json
{
  "id": "MEM-006",
  "title": "Offline/local memory availability",
  "description": "Offline/local memory availability。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Offline/local memory availability。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-007

```json
{
  "id": "MEM-007",
  "title": "Reconnect synchronization",
  "description": "Reconnect synchronization。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/gai/memory-integration.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Reconnect synchronization。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### MEM-008

```json
{
  "id": "MEM-008",
  "title": "Verified execution→reusable knowledge",
  "description": "Verified execution→reusable knowledge。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/skill-library.ts",
    "src/gai/governed-skill-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase12-skill-system.test.ts",
    "src/gai/governed-skill-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Verified execution→reusable knowledge。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-001

```json
{
  "id": "OFF-001",
  "title": "Networkを生存条件にしない",
  "description": "Networkを生存条件にしない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Networkを生存条件にしない。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-002

```json
{
  "id": "OFF-002",
  "title": "Local-capable workはOffline中も実行",
  "description": "Local-capable workはOffline中も実行。 ADR 0013のoffline data pack/local model managerを含み、モデル容量がない場合は実行可能と偽らない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Local-capable workはOffline中も実行。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-003

```json
{
  "id": "OFF-003",
  "title": "Online-required workはWAITING_FOR_CONNECTIVITY",
  "description": "Online-required workはWAITING_FOR_CONNECTIVITY。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Online-required workはWAITING_FOR_CONNECTIVITY。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-004

```json
{
  "id": "OFF-004",
  "title": "Persistent queue",
  "description": "Persistent queue。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Persistent queue。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-005

```json
{
  "id": "OFF-005",
  "title": "Checkpoint",
  "description": "Checkpoint。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Checkpoint。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-006

```json
{
  "id": "OFF-006",
  "title": "Resume",
  "description": "Resume。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-007

```json
{
  "id": "OFF-007",
  "title": "Idempotency",
  "description": "Idempotency。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Idempotency。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-008

```json
{
  "id": "OFF-008",
  "title": "Leases/duplicate prevention",
  "description": "Leases/duplicate prevention。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Leases/duplicate prevention。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-009

```json
{
  "id": "OFF-009",
  "title": "Sync",
  "description": "Sync。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Sync。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-010

```json
{
  "id": "OFF-010",
  "title": "Conflict resolution",
  "description": "Conflict resolution。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Conflict resolution。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-011

```json
{
  "id": "OFF-011",
  "title": "Critical stateでnaive last-write-wins禁止",
  "description": "Critical stateでnaive last-write-wins禁止。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Critical stateでnaive last-write-wins禁止。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OFF-012

```json
{
  "id": "OFF-012",
  "title": "Real physical offline test",
  "description": "Real physical offline test。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts",
    "src/gai/durable-task-runtime.ts",
    "src/gai/sync-engine.ts"
  ],
  "test_refs": [
    "tests/gai-offline-first-runtime.test.ts",
    "tests/gai-durable-task-runtime.test.ts",
    "tests/gai-sync-engine.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P7: Real physical offline test。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-001

```json
{
  "id": "SEC-001",
  "title": "Owner Authentication",
  "description": "Owner Authentication。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/app/owner-auth.ts",
    "src/app/api/jarvis/broker.ts"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Owner Authentication。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-002

```json
{
  "id": "SEC-002",
  "title": "Session Control",
  "description": "Session Control。 ADR 0013のsecrets managerとRBAC/node policyを維持する。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/app/owner-auth.ts",
    "src/app/api/jarvis/broker.ts"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Session Control。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-003

```json
{
  "id": "SEC-003",
  "title": "Signed Worker Request",
  "description": "Signed Worker Request。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Signed Worker Request。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-004

```json
{
  "id": "SEC-004",
  "title": "Signed Result",
  "description": "Signed Result。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Signed Result。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-005

```json
{
  "id": "SEC-005",
  "title": "Nonce protection",
  "description": "Nonce protection。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Nonce protection。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-006

```json
{
  "id": "SEC-006",
  "title": "Replay protection",
  "description": "Replay protection。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Replay protection。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-007

```json
{
  "id": "SEC-007",
  "title": "Clock/stale request protection",
  "description": "Clock/stale request protection。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-enrollment-security.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Clock/stale request protection。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-008

```json
{
  "id": "SEC-008",
  "title": "Device Allowlist",
  "description": "Device Allowlist。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-gateway.ts",
    "src/jarvis/policy-engine.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-enrollment-security.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Device Allowlist。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-009

```json
{
  "id": "SEC-009",
  "title": "Capability authorization",
  "description": "Capability authorization。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-gateway.ts",
    "src/jarvis/policy-engine.ts",
    "src/gai/device-capability-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-enrollment-security.test.ts",
    "tests/gai-device-capability-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Capability authorization。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-010

```json
{
  "id": "SEC-010",
  "title": "Private ingress only",
  "description": "Private ingress only。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/jarvis-remote-gateway.ts",
    "scripts/jarvis-broker.ts"
  ],
  "test_refs": [
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md"
  ],
  "status": "PARTIAL",
  "blocker": "子Issue #683でWindows spawn/backoffとprivate-ingress判定を修正。Tailscale/OS startup・cellular/実機復旧Evidenceは未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P1/P2: Windows非対話起動・battery policy診断を完成し、OS/account gate準備と実機接続・復旧Evidenceを取得する。独立するP3以降のソフトウェア作業を継続。",
  "last_verified_commit": null
}
```

### SEC-011

```json
{
  "id": "SEC-011",
  "title": "No secrets in repo",
  "description": "No secrets in repo。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現在のscope全体に対する秘密情報・ログ漏洩監査証拠が未収集。秘密の値を出力せず検査する。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: No secrets in repo。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-012

```json
{
  "id": "SEC-012",
  "title": "No secrets in logs",
  "description": "No secrets in logs。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "現在のscope全体に対する秘密情報・ログ漏洩監査証拠が未収集。秘密の値を出力せず検査する。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: No secrets in logs。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-013

```json
{
  "id": "SEC-013",
  "title": "No silent paid API",
  "description": "No silent paid API。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/goal-loop-delegated-approval.test.ts",
    "tests/jarvis-v1-foundation.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: No silent paid API。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-014

```json
{
  "id": "SEC-014",
  "title": "Human Gate: payment/purchase/billing/contract/permission changes/credentials/tokens/security weakening/destructive deletion/irreversible action/governance changes/protected external publication/protected production action",
  "description": "Human Gate: payment/purchase/billing/contract/permission changes/credentials/tokens/security weakening/destructive deletion/irreversible action/governance changes/protected external publication/protected production action。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts",
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/goal-loop-delegated-approval.test.ts",
    "tests/jarvis-v1-foundation.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Human Gate: payment/purchase/billing/contract/permission changes/credentials/tokens/security weakening/destructive deletion/irreversible action/governance changes/protected external publication/protected production action。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-015

```json
{
  "id": "SEC-015",
  "title": "Human Takeover audit",
  "description": "Human Takeover audit。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/app/jarvis/JarvisConsole.tsx",
    "src/jarvis/control-plane.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-console.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "nodeIdとserialの完全一致時だけUI連携。再観測・異なるidentityの正式mapping・実機failure/takeover/resume未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### SEC-016

```json
{
  "id": "SEC-016",
  "title": "Remote Assist audit",
  "description": "Remote Assist audit。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/human-takeover.ts",
    "src/jarvis/remote-assist-audit.ts",
    "src/jarvis/remote-assist.ts",
    "src/app/api/jarvis/remote/route.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-remote-assist-audit.test.ts",
    "tests/jarvis-remote-assist-session.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md"
  ],
  "status": "PARTIAL",
  "blocker": "永続JSONL監査とprivacy filteringあり。録画開始監査の失敗時にcaptureが先行する問題、API negative coverageが残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "録画の監査・停止/期限境界を修正し、残るplatform/統合/実機Evidenceを取得。詳細: docs/audit/jarvis-p3-reconciliation.md",
  "last_verified_commit": null
}
```

### SEC-017

```json
{
  "id": "SEC-017",
  "title": "Privacy Blackout",
  "description": "Privacy Blackout。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "JARVIS sensitive panel blackout未実装。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Privacy Blackout。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-018

```json
{
  "id": "SEC-018",
  "title": "Threat Model",
  "description": "Threat Model。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "docs/architecture/phase20-security-invariant.md"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "既存security invariantに加えprivate ingress/fleet/assistの具体的threat modelが必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Threat Model。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### SEC-019

```json
{
  "id": "SEC-019",
  "title": "Negative Security Tests",
  "description": "Negative Security Tests。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts",
    "src/jarvis/worker-auth.ts",
    "src/app/owner-auth.ts"
  ],
  "test_refs": [
    "tests/owner-auth.test.ts",
    "tests/jarvis-enrollment-security.test.ts",
    "tests/jarvis-worker-auth-ecdsa.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P8: Negative Security Tests。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-001

```json
{
  "id": "OPS-001",
  "title": "Task history",
  "description": "Task history。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Task history。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-002

```json
{
  "id": "OPS-002",
  "title": "Worker history",
  "description": "Worker history。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Worker history。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-003

```json
{
  "id": "OPS-003",
  "title": "Verification history",
  "description": "Verification history。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Verification history。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-004

```json
{
  "id": "OPS-004",
  "title": "Failure history",
  "description": "Failure history。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Failure history。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-005

```json
{
  "id": "OPS-005",
  "title": "Recovery history",
  "description": "Recovery history。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts",
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Recovery history。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-006

```json
{
  "id": "OPS-006",
  "title": "Connectivity status",
  "description": "Connectivity status。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-preflight.mjs",
    "scripts/jarvis-power-recovery-check.mjs"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Connectivity status。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-007

```json
{
  "id": "OPS-007",
  "title": "Power status where available",
  "description": "Power status where available。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/gai/world-resource-collector.ts",
    "src/gai/world-resource-model.ts"
  ],
  "test_refs": [
    "tests/gai-world-resource-model.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Power status where available。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-008

```json
{
  "id": "OPS-008",
  "title": "Self Diagnostics: Tailscale disconnected/build missing/worker missing/host down/Broker down/Gateway down/auth missing/Device permission missing/firmware gate/Human Gate pendingを具体表示",
  "description": "Self Diagnostics: Tailscale disconnected/build missing/worker missing/host down/Broker down/Gateway down/auth missing/Device permission missing/firmware gate/Human Gate pendingを具体表示。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-preflight.mjs",
    "scripts/jarvis-power-recovery-check.mjs",
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/inspect-jarvis-startup-windows.ps1",
    "scripts/jarvis-power-recovery-lib.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-power-recovery.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### OPS-009

```json
{
  "id": "OPS-009",
  "title": "Recovery Dashboard",
  "description": "Recovery Dashboard。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-preflight.mjs",
    "scripts/jarvis-power-recovery-check.mjs"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Recovery Dashboard。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-010

```json
{
  "id": "OPS-010",
  "title": "Automatic startup",
  "description": "Automatic startup。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "scripts/install-jarvis-remote-autostart-windows.ps1",
    "scripts/jarvis-remote-host.mjs",
    "scripts/jarvis-remote-access-lib.mjs",
    "scripts/inspect-jarvis-startup-windows.ps1",
    "scripts/jarvis-power-recovery-lib.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-remote-access.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "#685 adds strict read-only owner/task/action/battery readiness. Current machine is not ready; physical reboot, credential validity and AC recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Prepare the one-time owner Task Scheduler gate; continue independent P3 software work, then collect actual reboot/network/power evidence.",
  "last_verified_commit": null
}
```

### OPS-011

```json
{
  "id": "OPS-011",
  "title": "Stable owner access URL",
  "description": "Stable owner access URL。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-preflight.mjs",
    "scripts/jarvis-power-recovery-check.mjs"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Stable owner access URL。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-012

```json
{
  "id": "OPS-012",
  "title": "First-run setup wizard",
  "description": "First-run setup wizard。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "既存端末enrollページとは別に、ホスト/接続/権限を扱う統合first-run wizardが必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: First-run setup wizard。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-013

```json
{
  "id": "OPS-013",
  "title": "Update",
  "description": "Update。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/UpdateManager.kt",
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "端末更新/研究rollbackの土台あり。製品stack全体のupdate/rollback・互換性・失敗復旧は未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Update。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-014

```json
{
  "id": "OPS-014",
  "title": "Rollback",
  "description": "Rollback。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/UpdateManager.kt",
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "端末更新/研究rollbackの土台あり。製品stack全体のupdate/rollback・互換性・失敗復旧は未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Rollback。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-015

```json
{
  "id": "OPS-015",
  "title": "Backup",
  "description": "Backup。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "永続ストレージはbackup/restore成功の証拠ではない。整合性・鍵・世代・復元実行の検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Backup。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-016

```json
{
  "id": "OPS-016",
  "title": "Restore",
  "description": "Restore。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/sqlite-state-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "永続ストレージはbackup/restore成功の証拠ではない。整合性・鍵・世代・復元実行の検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Restore。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-017

```json
{
  "id": "OPS-017",
  "title": "Operator Guide",
  "description": "Operator Guide。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "docs/architecture/jarvis-remote-access.md",
    "docs/architecture/jarvis-power-recovery.md"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "開発者向けcommand手順は存在。terminal不要の日常操作ガイド未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Operator Guide。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### OPS-018

```json
{
  "id": "OPS-018",
  "title": "Terminal-free routine use",
  "description": "Terminal-free routine use。",
  "phase": "P10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/app/jarvis/JarvisConsole.tsx",
    "scripts/jarvis-remote-preflight.mjs",
    "scripts/jarvis-power-recovery-check.mjs"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P10: Terminal-free routine use。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-001

```json
{
  "id": "ACC-001",
  "title": "外出先スマホWi-Fi OFF、4G/5Gのみでprivate JARVISへ接続",
  "description": "外出先スマホWi-Fi OFF、4G/5Gのみでprivate JARVISへ接続。Authenticated JARVIS UIが開くこと。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "外出先phoneのcellular-only/Tailscale認証と家Androidまでの現行commit実機Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: 外出先スマホWi-Fi OFF、4G/5Gのみでprivate JARVISへ接続。Authenticated JARVIS UIが開くこと。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-002

```json
{
  "id": "ACC-002",
  "title": "外出先スマホ→JARVIS→家Android→task→execution→signed result→verifier PASS",
  "description": "外出先スマホ→JARVIS→家Android→task→execution→signed result→verifier PASS。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "外出先phoneのcellular-only/Tailscale認証と家Androidまでの現行commit実機Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: 外出先スマホ→JARVIS→家Android→task→execution→signed result→verifier PASS。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-003

```json
{
  "id": "ACC-003",
  "title": "Internet/Wi-Fi interruption→restore→reconnect→no re-enrollment→resume",
  "description": "Internet/Wi-Fi interruption→restore→reconnect→no re-enrollment→resume。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: Internet/Wi-Fi interruption→restore→reconnect→no re-enrollment→resume。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-004

```json
{
  "id": "ACC-004",
  "title": "ZBook reboot→Windows→Tailscale→JARVIS→Broker→Gateway→remote reconnectが人操作なしで戻る",
  "description": "ZBook reboot→Windows→Tailscale→JARVIS→Broker→Gateway→remote reconnectが人操作なしで戻る。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: ZBook reboot→Windows→Tailscale→JARVIS→Broker→Gateway→remote reconnectが人操作なしで戻る。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-005

```json
{
  "id": "ACC-005",
  "title": "可能ならAC power off→restore→BIOS boot→Windows→JARVIS→remote recoveryを実機確認",
  "description": "可能ならAC power off→restore→BIOS boot→Windows→JARVIS→remote recoveryを実機確認。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: 可能ならAC power off→restore→BIOS boot→Windows→JARVIS→remote recoveryを実機確認。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-006

```json
{
  "id": "ACC-006",
  "title": "Android reboot→worker returns automatically",
  "description": "Android reboot→worker returns automatically。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: Android reboot→worker returns automatically。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-007

```json
{
  "id": "ACC-007",
  "title": "AIに意図的UI failure→AI停止→Live View→Human操作→「続きやって」→AI再開→Goal complete",
  "description": "AIに意図的UI failure→AI停止→Live View→Human操作→「続きやって」→AI再開→Goal complete。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: AIに意図的UI failure→AI停止→Live View→Human操作→「続きやって」→AI再開→Goal complete。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-008

```json
{
  "id": "ACC-008",
  "title": "Offline→local work or waiting→reconnect→sync→resume→verify",
  "description": "Offline→local work or waiting→reconnect→sync→resume→verify。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: Offline→local work or waiting→reconnect→sync→resume→verify。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```

### ACC-009

```json
{
  "id": "ACC-009",
  "title": "複数deviceを並列使用し1つのGoalを完了",
  "description": "複数deviceを並列使用し1つのGoalを完了。",
  "phase": "P9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "当該製品機能の実装・テスト・Evidenceを未発見。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "P9: 複数deviceを並列使用し1つのGoalを完了。 について実装の不足を埋め、required_evidenceを取得する。",
  "last_verified_commit": null
}
```
