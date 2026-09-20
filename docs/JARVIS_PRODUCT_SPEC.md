<!-- #887 reconciliation: 2026-09-20, candidate e97903f; no production or physical claim. -->
# JARVIS Product Specification

## Authority and completion

Parent Goal / DoD: [Issue #681](https://github.com/haji84/AI-/issues/681). This file is the sole product Requirement Ledger; `docs/jarvis-requirements.json` is its machine-readable mirror. Every requirement below must occur exactly once in both. Historical JARVIS v1 acceptance is retained as historical scope, not proof of this expanded program. Owner resynchronization: 2026-09-17 JST; #865 audit baseline `14f0651a51ba79a53bff36f15175351d44f0f2fb`.

Completion requires every row to be VERIFIED with all required evidence classes, or PLATFORM_LIMITED with cited real platform restriction, implemented safe fallback, documentation and displayed UI capability. PARTIAL / MISSING / IMPLEMENTED_UNVERIFIED never count as complete. CODE or green CI cannot substitute for PHYSICAL or RECOVERY. Unavailable hardware, missing login, or unimplemented software is not a platform limitation. No AGI claim: #321 / R1–R20 remains a separate research track.

Statuses: VERIFIED, IMPLEMENTED_UNVERIFIED, PARTIAL, MISSING, PLATFORM_LIMITED. Evidence classes: CODE, UNIT, INTEGRATION, SECURITY, PHYSICAL, RECOVERY. Null last_verified_commit means the entire requirement has not been verified; source mappings do not imply execution. Prior Issue links are evidence leads pending direct review, not validated evidence records.

## Architecture and safety

Current host: ZBook / Windows. Target: hardware-independent Home Coordinator plus mobile ZBook high-performance Worker. Mac/DELL are candidates, not deployed Coordinators. Current travel workaround leaves ZBook home. Host relocation must preserve all device IDs, signing relationships, credentials, queues and evidence; MIG-001–030 retain M0–M10 gates. External smartphone → cellular Internet → private encrypted Tailscale tailnet → ZBook → JARVIS → Broker / Remote Gateway → home Wi-Fi Android fleet. Android devices need not each install Tailscale. Router public port forwarding, Funnel, public Broker and public Remote Gateway are prohibited.

One user-visible JARVIS dynamically composes Planner, Executor, Verifier, Researcher, Device/Browser/PC/Mobile Worker, Recovery, Memory, Skill, Security and Auditor roles as needed. Work/Codex supplies model reasoning; no additional paid AI API path. Credentials, permissions, billing, irreversible/destructive operations and security/governance changes retain Human Gates. Routine low/medium work continues within authorized execution; bounded retries (maximum 3 per issue), durable next action and fail-visible behavior remain required.

## Phase ownership (Issue #681 P0–P10)

- P0: ledger, all-ID audit, mapping and conservative gap classification.
- P1: private remote access and compatible logical Home Coordinator (ZBook remains temporary host).
- P2: power/network recovery.
- P3: device live view / remote assist.
- P4: 100-device fleet, enrollment, legacy endpoint compatibility and staged migration.
- P5: frozen JARVIS UI.
- P6: voice / context / gesture / phone remote.
- P7: autonomous completion, memory and offline-first loop.
- P8: security / privacy / resilience audit.
- P9: physical end-to-end acceptance.
- P10: release / owner-ready operations.

A phase assignment owns the remaining work; it does not mark the phase exit passed. Work independent of a physical gate may proceed, but the blocked exit stays open. Product release additionally requires no routine GitHub, terminal, manual startup, repeated enrollment or owner “continue” prompts.

## Resynchronization boundary

Original 244 IDs are retained. MIG-001–030 are imported from #863/PR #864 as requirements, not as merged implementation. CORE-001–034 cover owner sections 2–35. GOV-001–028 preserve the complete #784 addendum sections 103–130. The five canonical statuses above override the addendum’s proposed TARGET/DEPRECATED terminology; no requirement is retired. Original sections 1–102 are referenced by #783/#784 but their original full text was not available in the inspected repository sources: the latest 0–67 instructions and existing ledger are preserved, but this audit does not claim their exact historical equivalence. No production deployment or physical acceptance is implied. See [audit](JARVIS_COMPLETION_STATUS.md).

Prior confirmed Android additions are explicitly retained as DEV-AX-001–004: Android 8, Worker updates, screen wake, and enrollment-safe rollout.

## Requirements

Canonical rows, mirrored exactly in `docs/jarvis-requirements.json`.

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
    "scripts/inspect-jarvis-startup-windows.ps1",
    "scripts/install-jarvis-production-windows.ps1",
    "scripts/jarvis-windows-install-paths.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-windows-install-paths.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md",
    "docs/evidence/786-native-startup.md"
  ],
  "status": "PARTIAL",
  "blocker": "#786 native session-0 task, two READY Workers and private URL HTTP200 observed after explicitly approved Tailscale unattended setting. Physical reboot/AC-loss/crash recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Coordinate actual Windows reboot and remote/network/crash acceptance. Routine Tailscale recovery has standing owner approval; preserve credentials, enrollment and unchanged firewall.",
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
    "scripts/jarvis-managed-process.mjs",
    "scripts/install-jarvis-production-windows.ps1",
    "scripts/jarvis-windows-install-paths.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-windows-install-paths.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/evidence/786-native-startup.md"
  ],
  "status": "PARTIAL",
  "blocker": "#786 native session-0 task, two READY Workers and private URL HTTP200 observed after explicitly approved Tailscale unattended setting. Physical reboot/AC-loss/crash recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Coordinate actual Windows reboot and remote/network/crash acceptance. Routine Tailscale recovery has standing owner approval; preserve credentials, enrollment and unchanged firewall.",
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
  "description": "固定端末登録URL→server側fresh短時間token→Worker enrollment→完了。 過去に確定した短時間tokenは30分。既存identity再接続に再登録を要求せず、複数台登録の導線を維持する。",
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
    "src/app/jarvis/enroll/page.tsx",
    "scripts/jarvis-broker.ts",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/MainActivity.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/EnrollmentBootstrap.kt",
    "scripts/jarvis-private-worker-ingress.ts",
    "src/jarvis/private-worker-ingress.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts",
    "tests/jarvis-launch-enrollment.test.ts",
    "android/jarvis-worker/app/src/test/java/ai/jarvis/worker/EnrollmentBootstrapTest.kt",
    "tests/jarvis-private-worker-ingress.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-launch-enrollment.md",
    "docs/evidence/779-installation-rollout.md"
  ],
  "status": "PARTIAL",
  "blocker": "#779: approved installation TLS provisioned; configured APK build and exact merged commit main CI passed. Existing Mac signing job is queued; published APK remains 0.4.1. Android LAN connection times out with an explicit Windows Node TCP block. Separate scoped firewall approval and real enrollment/reopen verification remain required.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Restore existing Mac signer, verify configured signed APK, obtain separate LAN-only TCP 8792 firewall approval, then install without clearing data and verify actual Wi-Fi enrollment/signed heartbeat/reopen within valid authorization.",
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
    "src/app/jarvis/enroll/page.tsx",
    "scripts/jarvis-broker.ts",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/MainActivity.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/EnrollmentBootstrap.kt",
    "scripts/jarvis-private-worker-ingress.ts",
    "src/jarvis/private-worker-ingress.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts",
    "tests/jarvis-launch-enrollment.test.ts",
    "android/jarvis-worker/app/src/test/java/ai/jarvis/worker/EnrollmentBootstrapTest.kt",
    "tests/jarvis-private-worker-ingress.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-launch-enrollment.md",
    "docs/evidence/779-installation-rollout.md"
  ],
  "status": "PARTIAL",
  "blocker": "#779: approved installation TLS provisioned; configured APK build and exact merged commit main CI passed. Existing Mac signing job is queued; published APK remains 0.4.1. Android LAN connection times out with an explicit Windows Node TCP block. Separate scoped firewall approval and real enrollment/reopen verification remain required.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Restore existing Mac signer, verify configured signed APK, obtain separate LAN-only TCP 8792 firewall approval, then install without clearing data and verify actual Wi-Fi enrollment/signed heartbeat/reopen within valid authorization.",
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
    "src/app/jarvis/enroll/page.tsx",
    "scripts/jarvis-broker.ts",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/MainActivity.kt",
    "android/jarvis-worker/app/src/main/java/ai/jarvis/worker/EnrollmentBootstrap.kt",
    "scripts/jarvis-private-worker-ingress.ts",
    "src/jarvis/private-worker-ingress.ts"
  ],
  "test_refs": [
    "tests/jarvis-final-fleet-acceptance.test.ts",
    "tests/jarvis-enrollment-security.test.ts",
    "tests/jarvis-launch-enrollment.test.ts",
    "android/jarvis-worker/app/src/test/java/ai/jarvis/worker/EnrollmentBootstrapTest.kt",
    "tests/jarvis-private-worker-ingress.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-launch-enrollment.md",
    "docs/evidence/779-installation-rollout.md"
  ],
  "status": "PARTIAL",
  "blocker": "#779: approved installation TLS provisioned; configured APK build and exact merged commit main CI passed. Existing Mac signing job is queued; published APK remains 0.4.1. Android LAN connection times out with an explicit Windows Node TCP block. Separate scoped firewall approval and real enrollment/reopen verification remain required.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Restore existing Mac signer, verify configured signed APK, obtain separate LAN-only TCP 8792 firewall approval, then install without clearing data and verify actual Wi-Fi enrollment/signed heartbeat/reopen within valid authorization.",
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
    "tests/jarvis-remote-assist-session.test.ts",
    "tests/jarvis-fast-preview.test.ts",
    "tests/jarvis-video-packets.test.ts",
    "tests/jarvis-video-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md",
    "docs/audit/jarvis-fast-preview.md",
    "docs/audit/jarvis-video-trial.md"
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
    "src/jarvis/remote-assist.ts",
    "src/app/jarvis/RemoteScreenControl.tsx",
    "src/jarvis/remote-screen-input.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts",
    "tests/jarvis-remote-screen-input.test.ts",
    "tests/jarvis-fast-preview.test.ts",
    "tests/jarvis-video-packets.test.ts",
    "tests/jarvis-video-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md",
    "docs/audit/jarvis-remote-touch-input.md",
    "docs/audit/jarvis-fast-preview.md",
    "docs/audit/jarvis-video-trial.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android直接タップ/スワイプと取消境界の単体検証済み。PC transport、browser touchと実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "認証済みRemote Assistで実ブラウザのタッチ・取消・端末切替を検証し、cellularから実Android操作を実証する。",
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
    "src/jarvis/remote-assist.ts",
    "src/app/jarvis/RemoteScreenControl.tsx",
    "src/jarvis/remote-screen-input.ts"
  ],
  "test_refs": [
    "tests/jarvis-remote-assist-console.test.ts",
    "tests/jarvis-remote-assist-session.test.ts",
    "tests/jarvis-remote-screen-input.test.ts",
    "tests/jarvis-fast-preview.test.ts",
    "tests/jarvis-video-packets.test.ts",
    "tests/jarvis-video-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-p3-reconciliation.md",
    "docs/audit/jarvis-remote-touch-input.md",
    "docs/audit/jarvis-fast-preview.md",
    "docs/audit/jarvis-video-trial.md"
  ],
  "status": "PARTIAL",
  "blocker": "Android直接タップ/スワイプと取消境界の単体検証済み。PC transport、browser touchと実機操作Evidence未取得。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "認証済みRemote Assistで実ブラウザのタッチ・取消・端末切替を検証し、cellularから実Android操作を実証する。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/app/jarvis/ui-preferences.ts",
    "src/app/jarvis/settings/page.tsx"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。mainに20 theme・20 personaとVoice/Color/Layoutの独立設定がある。設定UIの機能存在と全presetのブラウザー・実機品質保証は別。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/screen-layout-profiles.ts"
  ],
  "test_refs": [
    "tests/jarvis-screen-layout-profiles.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "画面profileの実装あり。端末間・画面サイズ別の統合検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。画面profileの実装あり。端末間・画面サイズ別の統合検証が残る。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
  "implementation_refs": [
    "src/jarvis/home-widget-layout.ts",
    "src/jarvis/home-widget-history.ts",
    "src/app/jarvis/JarvisHomeLayoutEditor.tsx"
  ],
  "test_refs": [
    "tests/jarvis-home-widget-layout.test.ts",
    "tests/jarvis-home-widget-history.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。移動・resize・hide/show・preset・Undo/Redo/Resetのコードと単体テストが存在。全画面・入力機器の受入検証は未完了。",
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
    "src/app/jarvis/jarvis.css",
    "src/jarvis/command-search.ts",
    "src/app/jarvis/JarvisCommandSearch.tsx"
  ],
  "test_refs": [
    "tests/jarvis-command-search.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Command/Search UIは存在。あらゆる作業を理解・実行する汎用Goal Engineの完成を意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Command/Search UIは存在。あらゆる作業を理解・実行する汎用Goal Engineの完成を意味しない。",
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
  "implementation_refs": [
    "src/jarvis/command-search.ts",
    "src/app/jarvis/JarvisCommandSearch.tsx"
  ],
  "test_refs": [
    "tests/jarvis-command-search.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Command/Search UIは存在。あらゆる作業を理解・実行する汎用Goal Engineの完成を意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Command/Search UIは存在。あらゆる作業を理解・実行する汎用Goal Engineの完成を意味しない。",
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
  "implementation_refs": [
    "src/app/jarvis/notification-priority.ts"
  ],
  "test_refs": [
    "tests/jarvis-notification-priority.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "通知優先度のコード・テストあり。実運用の割込品質は未検証。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。通知優先度のコード・テストあり。実運用の割込品質は未検証。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
    "src/app/jarvis/jarvis.css",
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
    "src/app/jarvis/jarvis.css",
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts",
    "src/app/jarvis/JarvisDisplayModeControls.tsx"
  ],
  "test_refs": [
    "tests/jarvis-display-modes.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Focus/Distance/Mobile/Privacy等のUI設定は存在。3〜5m視認性、適応layout、機密情報の全経路遮蔽の実機・統合証拠は不足。",
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
  "implementation_refs": [
    "src/app/jarvis/operation-mode.ts",
    "src/app/jarvis/JarvisReadOnlyBoundary.tsx"
  ],
  "test_refs": [
    "tests/jarvis-operation-mode.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Read-only UI境界あり。全APIに対する権限制御をUIだけで保証しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Read-only UI境界あり。全APIに対する権限制御をUIだけで保証しない。",
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
    "src/app/jarvis/jarvis.css",
    "src/app/jarvis/accessibility-preferences.ts"
  ],
  "test_refs": [
    "tests/jarvis-accessibility-hardening.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "アクセシビリティ・keyboard補助あり。全フローの支援技術検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。アクセシビリティ・keyboard補助あり。全フローの支援技術検証は未完了。",
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
    "src/app/jarvis/jarvis.css",
    "src/app/jarvis/accessibility-preferences.ts"
  ],
  "test_refs": [
    "tests/jarvis-accessibility-hardening.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "アクセシビリティ・keyboard補助あり。全フローの支援技術検証は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。アクセシビリティ・keyboard補助あり。全フローの支援技術検証は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
    "src/app/jarvis/jarvis.css",
    "src/app/jarvis/connectivity-status.ts",
    "src/app/jarvis/JarvisConnectivityStatus.tsx"
  ],
  "test_refs": [
    "tests/jarvis-accessibility-connectivity.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
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
  "implementation_refs": [
    "src/app/jarvis/connectivity-status.ts",
    "src/app/jarvis/JarvisConnectivityStatus.tsx"
  ],
  "test_refs": [
    "tests/jarvis-accessibility-connectivity.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
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
  "implementation_refs": [
    "src/app/jarvis/connectivity-status.ts",
    "src/app/jarvis/JarvisConnectivityStatus.tsx"
  ],
  "test_refs": [
    "tests/jarvis-accessibility-connectivity.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。Offline/Reconnecting/Sync表示は存在。実際の全サービス状態との整合検証が残る。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
    "src/app/jarvis/JarvisConsole.tsx",
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice/MobileVoiceCommander.tsx",
    "src/app/jarvis/mobile/voice/speech-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-speech-persona-style.test.ts",
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。音声入力・発話制御・字幕関連の実装とテストあり。各OS/browserでのbarge-in・音声認識・queue・権限を含む実機受入は未完了。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/voice-command.ts",
    "src/app/jarvis/mobile/command-context.ts",
    "src/app/jarvis/mobile/context-reference.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-voice-input.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定した安全コマンドと共有履歴・参照解決を実装済み。一般的な画面理解・自由な自然言語操作は未完成。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx",
    "src/app/jarvis/mobile/gesture/gesture-motion.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-camera-gesture.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx",
    "src/app/jarvis/mobile/gesture/gesture-motion.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-camera-gesture.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx",
    "src/app/jarvis/mobile/gesture/gesture-motion.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-camera-gesture.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx",
    "src/app/jarvis/mobile/gesture/gesture-motion.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-camera-gesture.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/gesture/CameraGestureCommander.tsx",
    "src/app/jarvis/mobile/gesture/gesture-motion.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-camera-gesture.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。local画面差分による粗い動き検出と4リンク選択・明示確定がある。手指認識や任意アプリの自由操作ではない。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/pointer/ImuPointerCommander.tsx",
    "src/app/jarvis/mobile/pointer/imu-pointer.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-imu-pointer.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/pointer/ImuPointerCommander.tsx",
    "src/app/jarvis/mobile/pointer/imu-pointer.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-imu-pointer.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
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
  "implementation_refs": [
    "src/app/jarvis/mobile/pointer/ImuPointerCommander.tsx",
    "src/app/jarvis/mobile/pointer/imu-pointer.ts"
  ],
  "test_refs": [
    "tests/jarvis-p6-imu-pointer.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。IMU pointerの限定ナビゲーション実装あり。端末遠隔操作全体との統合と実機検証が残る。",
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
    "src/gai/memory-integration.ts",
    "src/jarvis/teaching-lessons.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/api/jarvis/teaching/route.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts",
    "tests/gai-memory-integration.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "現行コードの関連箇所は候補マッピング。要件全体を満たす統合・実機Evidenceを未確認。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
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
  "implementation_refs": [
    "scripts/jarvis-secret-audit.mjs"
  ],
  "test_refs": [
    "tests/jarvis-secret-audit.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定ルールのsecret scannerを実装済み。過去履歴・OS/外部ログ・全機密情報の検出を保証しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定ルールのsecret scannerを実装済み。過去履歴・OS/外部ログ・全機密情報の検出を保証しない。",
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
  "implementation_refs": [
    "scripts/jarvis-secret-audit.mjs"
  ],
  "test_refs": [
    "tests/jarvis-secret-audit.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "限定ルールのsecret scannerを実装済み。過去履歴・OS/外部ログ・全機密情報の検出を保証しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存実装を再利用し、記載した不足範囲の統合・対象環境検証を実施する。限定ルールのsecret scannerを実装済み。過去履歴・OS/外部ログ・全機密情報の検出を保証しない。",
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
  "implementation_refs": [
    "src/app/jarvis/display-modes.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
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
    "scripts/jarvis-power-recovery-lib.mjs",
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-power-recovery.test.mjs",
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md"
  ],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
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
    "scripts/jarvis-power-recovery-lib.mjs",
    "scripts/install-jarvis-production-windows.ps1",
    "scripts/jarvis-windows-install-paths.mjs"
  ],
  "test_refs": [
    "scripts/jarvis-power-recovery.test.mjs",
    "scripts/jarvis-managed-process.test.mjs",
    "scripts/jarvis-remote-access.test.mjs",
    "scripts/jarvis-windows-install-paths.test.mjs"
  ],
  "evidence_refs": [
    "docs/audit/jarvis-zbook-readiness.md",
    "docs/audit/jarvis-windows-unattended.md",
    "docs/evidence/786-native-startup.md"
  ],
  "status": "PARTIAL",
  "blocker": "#786 native session-0 task, two READY Workers and private URL HTTP200 observed after explicitly approved Tailscale unattended setting. Physical reboot/AC-loss/crash recovery remain unverified.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Coordinate actual Windows reboot and remote/network/crash acceptance. Routine Tailscale recovery has standing owner approval; preserve credentials, enrollment and unchanged firewall.",
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
  "implementation_refs": [
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
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
    "src/gai/self-improvement-runtime.ts",
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts",
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
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
    "src/jarvis/sqlite-state-store.ts",
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "tests/jarvis-persistence.test.ts",
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
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

### TEACH-001

```json
{
  "id": "TEACH-001",
  "title": "全端末共通の実演・手順記憶",
  "description": "全端末共通の実演・手順記憶。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "全platformの保存と共通契約あり。実機自動操作はAndroid経路のみ。他のnative adapterと実機教示検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "実機で実演→保存→別run再現を検証し、未接続platform adapterを実装する。",
  "last_verified_commit": null
}
```

### TEACH-002

```json
{
  "id": "TEACH-002",
  "title": "機種・OS・アプリ・端末別の手順選択",
  "description": "機種・OS・アプリ・端末別の手順選択。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx",
    "src/jarvis/teaching-learning.ts",
    "src/app/api/jarvis/teaching/route.ts",
    "src/jarvis/teaching-lessons.ts"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts",
    "tests/jarvis-teaching-learning.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "互換性照合実装済み。実機の複数機種・OS/app更新検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
  "last_verified_commit": null
}
```

### TEACH-003

```json
{
  "id": "TEACH-003",
  "title": "観測付き教示記録と完了条件",
  "description": "観測付き教示記録と完了条件。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx",
    "src/jarvis/local-video-reasoner.ts",
    "src/jarvis/video-action-plan.ts",
    "src/app/api/jarvis/teaching/video/route.ts",
    "src/jarvis/teaching-learning.ts",
    "src/app/api/jarvis/teaching/route.ts",
    "src/jarvis/teaching-lessons.ts"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts",
    "tests/jarvis-video-actions.test.ts",
    "tests/jarvis-teaching-learning.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md",
    "docs/architecture/jarvis-video-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "ローカル動画理解と実機照合を実装。実機での成功再現は未検証。Chromeページ操作対象が観測できず、ユーザー補助サービスも無効。未対応操作は停止。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
  "last_verified_commit": null
}
```

### TEACH-004

```json
{
  "id": "TEACH-004",
  "title": "別実行で検証した手順のみ自動再実行",
  "description": "別実行で検証した手順のみ自動再実行。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx",
    "src/jarvis/teaching-lessons.ts",
    "src/app/api/jarvis/teaching/route.ts"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "観測付き別run検証とURLパラメーター実装。実機replayとspreadsheet一括処理は未検証/未実装。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
  "last_verified_commit": null
}
```

### TEACH-005

```json
{
  "id": "TEACH-005",
  "title": "教示時の秘密情報保護とHuman Gate",
  "description": "教示時の秘密情報保護とHuman Gate。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "未知/保護操作は手動へ。各platform負例と実機privacy検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "実機で実演→保存→別run再現を検証し、未接続platform adapterを実装する。",
  "last_verified_commit": null
}
```

### TEACH-006

```json
{
  "id": "TEACH-006",
  "title": "手順・検証・途中状態の永続化と重複操作防止",
  "description": "手順・検証・途中状態の永続化と重複操作防止。Android・iPhone・Windows・Mac・Linuxの対応範囲を偽らず共通機能として扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/teaching.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/jarvis/TeachingControls.tsx",
    "src/app/jarvis/teach/page.tsx"
  ],
  "test_refs": [
    "tests/jarvis-teaching.test.ts",
    "tests/jarvis-teaching-runtime.test.ts"
  ],
  "evidence_refs": [
    "docs/architecture/jarvis-device-teaching.md"
  ],
  "status": "PARTIAL",
  "blocker": "atomic local store/checkpoint実装。単一ZBookプロセス前提。実機再起動検証が必要。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "実機で実演→保存→別run再現を検証し、未接続platform adapterを実装する。",
  "last_verified_commit": null
}
```

### MIG-001

```json
{
  "id": "MIG-001",
  "title": "Android再登録不要",
  "description": "既存AndroidのID・鍵・設定を保持し再Enrollmentなしで接続する",
  "phase": "P4",
  "migration_phase": "M5",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-002

```json
{
  "id": "MIG-002",
  "title": "iPhone identity維持",
  "description": "stable Device IDとKeychain credentialを保持する",
  "phase": "P4",
  "migration_phase": "M6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-003

```json
{
  "id": "MIG-003",
  "title": "署名関係維持",
  "description": "既存signed worker request/resultとnonce・clock保護を維持する",
  "phase": "P1",
  "migration_phase": "M2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-004

```json
{
  "id": "MIG-004",
  "title": "Pending Task保全",
  "description": "未完了タスク・lease・idempotencyを保持し二重実行を防ぐ",
  "phase": "P2",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-005

```json
{
  "id": "MIG-005",
  "title": "Offline Queue保全",
  "description": "端末とCoordinatorのoffline queueを消失させない",
  "phase": "P2",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-006

```json
{
  "id": "MIG-006",
  "title": "履歴Evidence保全",
  "description": "task/result履歴・検証履歴・外部Evidenceを保持する",
  "phase": "P10",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-007

```json
{
  "id": "MIG-007",
  "title": "100台個別再設定禁止",
  "description": "既存端末の一括削除・再登録・QR再読込を移行条件にしない",
  "phase": "P4",
  "migration_phase": "M7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-008

```json
{
  "id": "MIG-008",
  "title": "Coordinator役割分離",
  "description": "durable Broker・registry・enrollment・routingを物理PCと独立した論理roleにする",
  "phase": "P1",
  "migration_phase": "M1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-009

```json
{
  "id": "MIG-009",
  "title": "Mobile ZBook Worker",
  "description": "ZBookを持ち出せる高性能Workerとし家側稼働を維持する",
  "phase": "P1",
  "migration_phase": "M8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-010

```json
{
  "id": "MIG-010",
  "title": "Legacy endpoint互換",
  "description": "固定IP・hostname・cached endpoint・TLS信頼を実装監査し旧pathをbridgeで維持する",
  "phase": "P1",
  "migration_phase": "M2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-011

```json
{
  "id": "MIG-011",
  "title": "Logical Coordinator ID",
  "description": "物理host移動で変化しないservice identityを既存protocolを壊さず導入する",
  "phase": "P1",
  "migration_phase": "M1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-012

```json
{
  "id": "MIG-012",
  "title": "Protocol migration window",
  "description": "vCurrentを継続しvNextと共存、強制全台更新を移行条件にしない",
  "phase": "P4",
  "migration_phase": "M2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-013

```json
{
  "id": "MIG-013",
  "title": "M0–M10段階移行",
  "description": "inventoryからshadow/canary/段階展開/physical/cleanupまでexit gateを順に満たす",
  "phase": "P0",
  "migration_phase": "M0",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-014

```json
{
  "id": "MIG-014",
  "title": "Shadow副作用禁止",
  "description": "shadowはregistry・task・signature・queue・health・evidenceを比較しdispatchや登録変更しない",
  "phase": "P2",
  "migration_phase": "M3",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-015

```json
{
  "id": "MIG-015",
  "title": "State copy validation",
  "description": "consistent copy→validate→switchとしcritical stateのnaive last-write-winsは禁止",
  "phase": "P2",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-016

```json
{
  "id": "MIG-016",
  "title": "Android/iPhone canary",
  "description": "各1台でidentity/key・delivery・signed result・verifier・history・reboot/network recoveryを実証する",
  "phase": "P9",
  "migration_phase": "M6",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-017

```json
{
  "id": "MIG-017",
  "title": "Authenticated update migration",
  "description": "必要なWorker更新は署名検証し既存configを移行して再接続、手作業100台を要求しない",
  "phase": "P4",
  "migration_phase": "M7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-018

```json
{
  "id": "MIG-018",
  "title": "Protected backup",
  "description": "registry/state/queue/configとcredential metadataを保存、秘密鍵は平文backup/commitしない",
  "phase": "P10",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-019

```json
{
  "id": "MIG-019",
  "title": "Lossless rollback",
  "description": "旧Coordinator pathへ戻してもID/key/queue/history/evidenceと切替後の新規進捗を失わない",
  "phase": "P2",
  "migration_phase": "M9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-020

```json
{
  "id": "MIG-020",
  "title": "ZBook removal test",
  "description": "ZBookを家Wi-Fiから外してもhome fleet/job/private accessが継続し再登録不要",
  "phase": "P9",
  "migration_phase": "M8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-021

```json
{
  "id": "MIG-021",
  "title": "ZBook return test",
  "description": "外部networkと自宅帰還で同じWorker IDを保持しLAN優先へ戻る",
  "phase": "P9",
  "migration_phase": "M8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-022

```json
{
  "id": "MIG-022",
  "title": "Automatic route selection",
  "description": "trusted LAN fast path/private tailnet/durable offlineをidentity変更なしで選択する",
  "phase": "P1",
  "migration_phase": "M8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-023

```json
{
  "id": "MIG-023",
  "title": "Authenticated discovery",
  "description": "signed discovery/trusted bootstrap/cached known-goodを用い偽Coordinatorへcredentialを渡さない",
  "phase": "P1",
  "migration_phase": "M2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-024

```json
{
  "id": "MIG-024",
  "title": "Security invariants",
  "description": "owner auth・signing・nonce/replay/clock・allowlist・capability・Human Gate・private ingressを維持しFunnel/公開Broker禁止",
  "phase": "P1",
  "migration_phase": "M2",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-025

```json
{
  "id": "MIG-025",
  "title": "Connected baseline比較",
  "description": "変更前後にID/platform/protocol/capability/connectivity/heartbeat/enrollment/pending/credential存在/verificationを比較する",
  "phase": "P0",
  "migration_phase": "M0",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-026

```json
{
  "id": "MIG-026",
  "title": "Physical existing-device evidence",
  "description": "既存Android/iPhoneとZBook home/away/returnの実機証明をCIから分離する",
  "phase": "P9",
  "migration_phase": "M8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-027

```json
{
  "id": "MIG-027",
  "title": "切替操作不要UX",
  "description": "ZBookを持ち出す前後にユーザーのnetwork切替操作を求めない",
  "phase": "P10",
  "migration_phase": "M9",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-028

```json
{
  "id": "MIG-028",
  "title": "Hardware independence",
  "description": "Macを自宅candidateとしlogical roleをWindows/Linux等へ将来移設できる設計にする",
  "phase": "P1",
  "migration_phase": "M1",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### MIG-029

```json
{
  "id": "MIG-029",
  "title": "Single writer fencing",
  "description": "shadowとprimaryの二重lease/dispatchを防ぎreplay windowと進行中登録を保護する",
  "phase": "P2",
  "migration_phase": "M4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/coordinator-runtime.ts",
    "src/jarvis/coordinator-compatibility.ts",
    "src/jarvis/coordinator-replica-store.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### MIG-030

```json
{
  "id": "MIG-030",
  "title": "Evidence後の依存整理",
  "description": "fallbackを保持したprimary化と充分な実機evidence取得後のみlegacy依存を整理する",
  "phase": "P10",
  "migration_phase": "M10",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "mainには互換Coordinator移行の完成実装・実機証拠なし。#863/PR #864は監査準備として別管理。既存device/credential/queueを変更していない。",
  "platform_limit": null,
  "fallback": "現在のZBook Coordinator pathを保持する。",
  "next_action": "M0 baselineを現在時刻で再取得し、旧endpoint依存を確認してからM1/M2を追加。shadow/canaryの実機PASS前に切替しない。",
  "last_verified_commit": null
}
```

### CORE-001

```json
{
  "id": "CORE-001",
  "title": "汎用Goal Completion",
  "description": "Goal/Request/Material/Current Situationを理解し、調査・分析・計画・実行・検証・修正・改善・記録・学習まで行い、専門promptや逐次指示なしに使える完成状態にする。組織の一員として働く。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-002

```json
{
  "id": "CORE-002",
  "title": "Goal Completion Engine",
  "description": "Goal・Intent・Constraints・Context・Required Output・Deadline・Risk・DoD・Dependencies・Unknownsを解析し、状況理解から必要作業を発見し完了状態まで実行する。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-003

```json
{
  "id": "CORE-003",
  "title": "MUST / INTENT / BETTER",
  "description": "明示要求・本来目的・追加改善を分離する。BETTERでGoal/Constraintを壊さず依頼を勝手に別物にしない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/intent.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-004

```json
{
  "id": "CORE-004",
  "title": "Ask Last",
  "description": "ファイル→会話→Project State→Memory→過去成果物→接続ソース→組織データ→公式→Web→合理的推論の順で調査。重要事項が確定しない場合のみ質問し非依存作業を継続。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "この要求全体を満たすmain実装を本監査では特定できていない。MISSINGは検索・監査範囲内の判定。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-005

```json
{
  "id": "CORE-005",
  "title": "Input Recovery",
  "description": "欠落ファイル、dirty Excel、scan PDF、画像、OCR、encoding、typo、重複、矛盾、旧文書、壊れた構造、不完全コード、悪いfilename、参考/本件混在、複数versionを監査・修復・再構築・照合する。CONFIRMED/INFERRED/UNKNOWN/CONFLICTEDを区別。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/input-recovery.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-006

```json
{
  "id": "CORE-006",
  "title": "Dynamic Orchestration",
  "description": "Commander/Planner/Researcher/Analyst/Reader/Vision/Coder/Data Analyst/UX/Security/Judge/Critic/VerifierとJob専用Agentを必要時に構成し終了後解散。一つのJARVIS窓口。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-multi-agent-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-multi-worker-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-007

```json
{
  "id": "CORE-007",
  "title": "Model Router",
  "description": "Small/Large Local、Reasoning、Coding、Vision、Audio、Specialized、Optional Cloudを難度・Risk・Confidence・Cost・Deadline・Modality・実績・Data Classification・Hardwareで選択。特定LLMへ固定しない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/model-router.ts",
    "src/jarvis/model-router-v2.ts",
    "src/gai/model-execution.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts",
    "tests/gai-model-router-integration.test.ts"
  ],
  "evidence_refs": [
    "docs/evidence/893-model-router-integration.md"
  ],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire resource metadata into remaining concrete runtime callers; legacy and direct local-video model paths are not covered by resource-aware routing. Verify physical resource behavior separately.",
  "last_verified_commit": null
}
```

### CORE-008

```json
{
  "id": "CORE-008",
  "title": "Local-first / Cloud-optional",
  "description": "User/Organization device、自前GPU/server/local modelを利用しLOCAL_ONLY=true、CLOUD_BUDGET=0のCoreを成立させる。性能をBenchmarkで測定しCloud超えを無条件保証しない。追加有料APIは禁止を維持。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/model-router.ts",
    "src/gai/model-execution.ts",
    "src/jarvis/model-router-v2.ts"
  ],
  "test_refs": [
    "tests/gai-foundation.test.ts",
    "tests/gai-model-router-integration.test.ts"
  ],
  "evidence_refs": [
    "docs/evidence/893-model-router-integration.md"
  ],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire resource metadata into remaining concrete runtime callers; legacy and direct local-video model paths are not covered by resource-aware routing. Verify physical resource behavior separately.",
  "last_verified_commit": null
}
```

### CORE-009

```json
{
  "id": "CORE-009",
  "title": "Parallel / Adaptive / Multi-plan",
  "description": "独立Task並列化、Fast/Deep、High Riskの独立検証。重要案件は複数Planの成功確率・品質・時間・費用・Riskを比較し実測Verifierで評価。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-multi-agent-runtime.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-010

```json
{
  "id": "CORE-010",
  "title": "独立Verification",
  "description": "Execution/Fact/Security/Quality Verifierを分離。失敗時RCA→Re-plan→Repair→Re-execute→Re-verify。必要時Adversarial Critic。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/typed-benchmark-verifier.ts"
  ],
  "test_refs": [
    "tests/gai-foundation.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-011

```json
{
  "id": "CORE-011",
  "title": "World-state Verification",
  "description": "Action performedとGoal completedを分離。ファイルExists/Opens/Correct、URLとユーザーフロー、DB保存結果などDesired World Stateを実測してDONEにする。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-012

```json
{
  "id": "CORE-012",
  "title": "Fact Verification Engine",
  "description": "Claim抽出→Type→Risk/Freshness→深度→取得→Claim-specific Authority→Independent Origin→Temporal Validation→Citation Entailment→Cross Verification→Contradiction→Numerical Validation→Confidence Calibration→Evidence Graph→Final Fact Audit。VERIFIED/SUPPORTED/INFERRED/CONFLICTED/UNKNOWN/STALEを管理。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/fact-verification.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-013

```json
{
  "id": "CORE-013",
  "title": "Numerical Verification",
  "description": "数字はLLM再思考だけで検証せずCalculator/Python/SQL/Spreadsheet Engine/Deterministic Codeで独立再計算。全数値Claimへ検証結果を結合。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/fact-verification.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-014

```json
{
  "id": "CORE-014",
  "title": "Software Development Autopilot",
  "description": "Frontend/Backend/DB/API/Auth/Web/iOS/Android/Windows/macOS/AI/Infrastructure/Deployを要件発見→研究→設計→実装→統合→Unit/Integration/E2E/Security→必須Visual QA→Deploy→Production Verificationまで扱う。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [
    "tests/goal-loop.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-015

```json
{
  "id": "CORE-015",
  "title": "Software Lifecycle",
  "description": "Build→Operate→Monitor→Improve→Update→Repair。Product Spec/Architecture/Code/DB Schema/Tests/Deployment/Decisions/Change HistoryをLiving Specificationとして同期。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase20-production-autonomy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-016

```json
{
  "id": "CORE-016",
  "title": "Learning / Skills",
  "description": "成功TrajectoryをWorkflow/Template/Tool/Validation Rule/Skillへ昇格。失敗のWhat/Why/Where/Fix/成功代替/予防をFailure Memoryへ保存。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/skill-library.ts",
    "src/jarvis/teaching-lessons.ts",
    "src/jarvis/teaching-runtime.ts",
    "src/app/api/jarvis/teaching/route.ts"
  ],
  "test_refs": [
    "tests/gai-phase12-skill-system.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
  "last_verified_commit": null
}
```

### CORE-017

```json
{
  "id": "CORE-017",
  "title": "Preference Learning",
  "description": "Accepted/Correction/Rejected output、Design/Quality/Speed/Automation tolerance/Output formatを学習して修正不要な成果物を増やす。人格模倣を目的にしない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/continual-learning-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-continual-learning-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-018

```json
{
  "id": "CORE-018",
  "title": "Demonstration Learning",
  "description": "Screen/Click/Tap/Keyboard/Files/App State/Before-After/Error/Undo/Delete/Re-entry/CorrectionからWorkflow/Decision Rule/Template/Tool Usage/Exception/DoDを学習。誤操作を模倣せずOBSERVED/SUSPECTED_MISTAKE/CONFIRMED_MISTAKE/CORRECTED/VALIDATED/LEARNED_RULE/UNKNOWN/NEEDS_VALIDATIONを管理。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "docs/architecture/jarvis-video-teaching.md",
    "src/jarvis/demonstration-learning.ts",
    "src/jarvis/teaching-learning.ts",
    "src/app/api/jarvis/teaching/route.ts",
    "src/app/jarvis/teach/page.tsx",
    "src/jarvis/teaching-lessons.ts",
    "src/jarvis/teaching-runtime.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts",
    "tests/jarvis-teaching-learning.test.ts",
    "tests/jarvis-teaching-lessons.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Explicit owner-confirmed correction links and revalidated Skill references are wired. Verify real-device reuse; automatic inference of arbitrary mistakes and cross-platform native adapters remain incomplete. See docs/evidence/892-teaching-skills.md.",
  "last_verified_commit": null
}
```

### CORE-019

```json
{
  "id": "CORE-019",
  "title": "Long-Horizon",
  "description": "数時間〜数週間JobのCheckpoint/Stateを保持しReboot/Model change/Network loss/Process crashからResume。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/durable-task-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-durable-task-runtime.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-020

```json
{
  "id": "CORE-020",
  "title": "Risk / Capability Grant",
  "description": "Scope単位の自律範囲、Impact/Reversibility/Permission/Confidence/ScopeでRisk分類。Low実行、Medium snapshot/backup後実行、High/irreversible Human Gate。安全な継続を制御。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/orchestrator/risk-policy.ts"
  ],
  "test_refs": [
    "tests/risk-policy.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-021

```json
{
  "id": "CORE-021",
  "title": "Rollback First",
  "description": "File version/backup、Git、DB transaction/controlled migration、Previous Deploy、Settings Snapshot、JARVIS Stable/Candidateで可逆化。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-022

```json
{
  "id": "CORE-022",
  "title": "Self Modification",
  "description": "Stable→Candidate→Sandbox→Benchmark→Regression→Real-world Test→Canary→Promotion。Security Rootは自由変更させない。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/self-improvement-runtime.ts"
  ],
  "test_refs": [
    "tests/gai-phase19-self-improvement.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-023

```json
{
  "id": "CORE-023",
  "title": "Privacy / Data Security",
  "description": "Public/Internal/Personal/Confidential/Highly Confidential/Credentials/Secretを分類。Local First/Minimization/Redaction/Tokenization/Vault/External Transfer Control/Encryption/Audit/Data Sovereignty/Air-gapped。SecretをLLM Contextに直接入れない。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "scripts/jarvis-secret-audit.mjs"
  ],
  "test_refs": [
    "tests/jarvis-secret-audit.test.mjs"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-024

```json
{
  "id": "CORE-024",
  "title": "Security Kernel",
  "description": "LLM外部でAction Request→Policy→Identity→Authorization→Runtime→Executionを強制。LLMをSecurity Boundaryにしない。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts",
    "src/jarvis/security-kernel.ts",
    "src/jarvis/policy-as-code.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-025

```json
{
  "id": "CORE-025",
  "title": "Agentic Security",
  "description": "Prompt Injection/Goal Hijack/Tool Misuse/Excessive Agency/Identity・Privilege Abuse/Disclosure/Improper Output/Supply Chain/Unexpected Execution/Memory・Context・Model・Data Poisoning/Unbounded Resourceを防ぐ。Web/PDF/email/OCR/tool outputはdataでGoal/Gate/Owner/Policy/Permissionを書換不可。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-026

```json
{
  "id": "CORE-026",
  "title": "Scoped Ephemeral Authorization",
  "description": "Job/Target/Operation/Timeに限定し終了後失効。Worker間Permission貸借禁止。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/orchestrator/capability-policy.ts",
    "src/jarvis/security-kernel.ts",
    "src/jarvis/policy-as-code.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-027

```json
{
  "id": "CORE-027",
  "title": "Agent Communication",
  "description": "内部通信Identity/AuthN/AuthZ/Integrity/Schema/Replay/Audit。Shared Goal/DoD/Evidence/Findings/Decisions/Files/Unknowns/Tasks/ResultsとSensitive Context ACL。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/orchestrator/dynamic-multi-agent-runtime.ts",
    "src/jarvis/agent-communication.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-028

```json
{
  "id": "CORE-028",
  "title": "Network Default Deny",
  "description": "Job/Worker/Destination/Protocol/Duration単位の必要時許可を実行時強制。ネットワーク全体の原則拒否。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/egress-policy.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-029

```json
{
  "id": "CORE-029",
  "title": "Memory Trust",
  "description": "Source/Trust Level/Created By/At/Evidence/Expiry/Scope/Integrityを保持。外部文書のみで永続Memoryを更新不可。UNVERIFIED→VERIFIED→TRUSTED_FOR_ACTIONを強制。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts"
  ],
  "test_refs": [
    "tests/gai-memory.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-030

```json
{
  "id": "CORE-030",
  "title": "Runtime Control Plane",
  "description": "Identity/Capability/Policy/Runtime/Network/Secrets/Audit/Memory Trust/Agent Authentication/Emergency Shutdownを統合。",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-031

```json
{
  "id": "CORE-031",
  "title": "Evaluation / Benchmark",
  "description": "Completion/Accuracy/Requirement/Intent/First-pass Acceptance/Human Intervention/Speed/Cost/Critical Error/Rollback/Long Horizon/API Dependency/Fact Verification/Org Compliance/Repeat Error/Security Incidentを測定。外部比較のInput/Goal/Environment/Permissions/Time/Resources/Evalを揃える。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/gai/benchmark.ts"
  ],
  "test_refs": [
    "tests/gai-foundation.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### CORE-032

```json
{
  "id": "CORE-032",
  "title": "Organization Digital Twin",
  "description": "Rule/Template/Workflow/Authority/Exception/Effective Date/Version/Source/Evidence/Superseded Byを構造化。現行規程→公式manual→承認template→正式workflow→過去正式文書→慣習をClaim-specific Authorityで評価。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/organization-digital-twin.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-033

```json
{
  "id": "CORE-033",
  "title": "Knowledge Graph",
  "description": "Person/Organization/Project/File/Rule/Decision/Deadline/Task/Dependency/Evidence/System/Assetと変更影響をGraphで追跡。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/knowledge-graph.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### CORE-034

```json
{
  "id": "CORE-034",
  "title": "Advanced Production Controls",
  "description": "Instruction Trust/Goal Integrity/Policy-as-Code/Identity Device Trust/Model Tool Registry/Provenance/Reproducibility/Eval Governance/Held-out/Red Team/SLO/RTO/RPO/Backup Restore/Chaos/Time/Data Lifecycle/Retention/Deletion/Purpose/Tenant/Tamper Audit/Incident/Revocation/Resources/Override/Safe Stop/Preview/Impact Graph/Requirement Evidence/Degradation/Failure Transparencyを統合。",
  "phase": "P7",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連する基盤は存在するが、この拡張要求の全範囲・統合・必要Evidenceを満たしていない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-001

```json
{
  "id": "GOV-001",
  "title": "103. Instruction Trust Boundary",
  "description": "JARVIS must distinguish trusted control instructions from untrusted content.\r\n\r\nSources such as web pages, PDFs, email bodies, chat content, code comments, retrieved documents, screenshots, OCR text and external tool output are data by default, not authority.\r\n\r\nRequired controls:\r\n- instruction provenance\r\n- trust level\r\n- source identity\r\n- content/data vs control separation\r\n- explicit policy on which sources may issue executable instructions\r\n- prompt-injection detection and containment\r\n- no privilege escalation based solely on retrieved text\r\n\r\nState examples:\r\n- TRUSTED_CONTROL\r\n- USER_INTENT\r\n- SYSTEM_POLICY\r\n- UNTRUSTED_CONTENT\r\n- TOOL_OUTPUT\r\n- QUARANTINED",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-002

```json
{
  "id": "GOV-002",
  "title": "104. Agent Goal Integrity",
  "description": "The active Goal / DoD / constraints must be integrity-protected.\r\n\r\nUntrusted content must not silently rewrite:\r\n- the top-level goal\r\n- Human Gate policy\r\n- owner identity\r\n- authorization scope\r\n- security policy\r\n- completion criteria\r\n\r\nMaterial goal changes require explicit, attributable state transitions.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/orchestrator/goal-loop.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-003

```json
{
  "id": "GOV-003",
  "title": "105. Tool Misuse Defense",
  "description": "A tool being technically available does not imply the current Job may use it.\r\n\r\nEvery tool call must be checked against:\r\n- Job scope\r\n- target resource\r\n- action type\r\n- caller identity\r\n- capability grant\r\n- risk class\r\n- expiry\r\n- rate/resource limits\r\n\r\nTool parameters and tool output must be schema-validated.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-004

```json
{
  "id": "GOV-004",
  "title": "106. Unexpected Code Execution Containment",
  "description": "Generated or retrieved code must not automatically execute with host privileges.\r\n\r\nUse isolation appropriate to risk:\r\n- sandbox\r\n- container\r\n- restricted user\r\n- filesystem allowlist\r\n- process limits\r\n- network deny-by-default\r\n- timeout\r\n- output validation\r\n\r\nEscalation from sandbox to host execution is a separate policy decision.",
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
  "blocker": "この要求全体を満たすmain実装を本監査では特定できていない。MISSINGは検索・監査範囲内の判定。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-005

```json
{
  "id": "GOV-005",
  "title": "107. Policy-as-Code Enforcement",
  "description": "Security and execution policy must be machine-enforced outside the LLM.\r\n\r\nAt minimum, policy evaluation must cover:\r\n- Human Gates\r\n- action risk\r\n- network access\r\n- secret access\r\n- worker capabilities\r\n- data classification\r\n- model eligibility\r\n- tenant scope\r\n- destructive actions\r\n- production operations\r\n\r\nPolicy decisions should produce durable audit evidence.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/orchestrator/risk-policy.ts",
    "src/jarvis/security-kernel.ts",
    "src/jarvis/policy-as-code.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-006

```json
{
  "id": "GOV-006",
  "title": "108. Identity and Device Trust",
  "description": "Every user, service, agent, worker and managed device must have a stable identity.\r\n\r\nWhere platform support allows, use device-trust signals such as:\r\n- signed device identity\r\n- secure local key storage\r\n- certificate/key rotation\r\n- device enrollment state\r\n- OS/platform integrity state\r\n- revoked/lost-device state\r\n\r\nA device ID string alone is not sufficient proof of trust.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-007

```json
{
  "id": "GOV-007",
  "title": "109. Model and Tool Registry",
  "description": "Maintain a versioned registry for all models and tools.\r\n\r\nRecord at least:\r\n- identifier\r\n- version\r\n- provider/origin\r\n- capabilities\r\n- modalities\r\n- cost class\r\n- latency profile\r\n- hardware requirements\r\n- data-classification eligibility\r\n- network requirement\r\n- evaluation results\r\n- known limitations\r\n- security status\r\n- approval state\r\n- deprecation state\r\n\r\nRouting must use registry state instead of model-name assumptions.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/model-router.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-008

```json
{
  "id": "GOV-008",
  "title": "110. Provenance and Reproducibility",
  "description": "Material outputs must be traceable to their inputs and execution context.\r\n\r\nRecord, as appropriate:\r\n- Goal version\r\n- source versions\r\n- model/tool versions\r\n- code commit\r\n- prompt/policy version or stable hash\r\n- environment\r\n- time\r\n- retrieved evidence\r\n- deterministic calculation artifacts\r\n- verification result\r\n\r\nFor stochastic tasks, exact replay may be impossible; the system must preserve enough provenance to reproduce the evaluation conditions and investigate differences.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/production-autonomy-runtime.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-009

```json
{
  "id": "GOV-009",
  "title": "111. Evaluation Governance",
  "description": "Benchmarks must be separated into:\r\n- development\r\n- regression\r\n- held-out\r\n- red-team\r\n- real-world acceptance\r\n\r\nDo not continuously train/tune against the entire acceptance set and then claim unbiased performance.\r\n\r\nMetric definitions must be versioned.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/benchmark.ts",
    "src/gai/external-benchmark-evidence.ts",
    "src/jarvis/self-benchmark.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-010

```json
{
  "id": "GOV-010",
  "title": "112. SLO / Reliability Objectives",
  "description": "Define service-level objectives for operational JARVIS components.\r\n\r\nExamples:\r\n- availability\r\n- task queue latency\r\n- recovery time\r\n- verification latency\r\n- remote-control latency\r\n- worker reconnect time\r\n- failed-task rate\r\n\r\nTargets must be explicit per deployment rather than invented globally.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-011

```json
{
  "id": "GOV-011",
  "title": "113. RTO / RPO / Disaster Recovery",
  "description": "For each durable state class define:\r\n- Recovery Time Objective (RTO)\r\n- Recovery Point Objective (RPO)\r\n- backup location\r\n- restore owner\r\n- encryption\r\n- retention\r\n- restore verification\r\n\r\nBackups do not count as working recovery until a restore test passes.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/jarvis/release-ops.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-012

```json
{
  "id": "GOV-012",
  "title": "114. Chaos / Fault Injection Testing",
  "description": "Reliability claims must include controlled fault tests where safe.\r\n\r\nExamples:\r\n- process crash\r\n- worker disconnect\r\n- Wi-Fi loss\r\n- Internet loss\r\n- DNS failure\r\n- stale token\r\n- disk-full simulation\r\n- slow service\r\n- duplicate delivery\r\n- clock drift\r\n- corrupted cache\r\n\r\nNever perform destructive fault injection against production without an explicit gate.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [
    "src/gai/self-healing-runtime.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-013

```json
{
  "id": "GOV-013",
  "title": "115. Time Integrity",
  "description": "Distributed agent systems must treat time as a security and consistency dependency.\r\n\r\nMaintain controls for:\r\n- clock synchronization\r\n- timestamp provenance\r\n- token expiry\r\n- nonce windows\r\n- stale evidence\r\n- event ordering\r\n- deadline interpretation\r\n\r\nCritical ordering must not depend solely on a device's untrusted wall clock.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/worker-auth.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-014

```json
{
  "id": "GOV-014",
  "title": "116. Data Lifecycle Management",
  "description": "Data security must cover the full lifecycle, not only ingestion.\r\n\r\nFor each class of data define:\r\n- purpose\r\n- lawful/authorized use as applicable\r\n- collection scope\r\n- storage\r\n- replication\r\n- access\r\n- retention\r\n- archival\r\n- deletion\r\n- backup deletion behavior\r\n- export\r\n- provenance",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/data-lifecycle.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-015

```json
{
  "id": "GOV-015",
  "title": "117. Purpose Limitation",
  "description": "Data collected for one Job or purpose must not automatically become reusable global context.\r\n\r\nMemory promotion must check:\r\n- scope\r\n- user/organization policy\r\n- sensitivity\r\n- provenance\r\n- expiry\r\n- usefulness\r\n- conflict risk",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/memory-store.ts",
    "src/jarvis/data-lifecycle.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-016

```json
{
  "id": "GOV-016",
  "title": "118. Data Subject / Record Correction Propagation",
  "description": "When authoritative source data is corrected or deleted, derived memories, indexes, summaries and cached artifacts must be discoverable for revalidation, update or removal according to policy.",
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
  "blocker": "この要求全体を満たすmain実装を本監査では特定できていない。MISSINGは検索・監査範囲内の判定。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-017

```json
{
  "id": "GOV-017",
  "title": "119. Tenant Isolation",
  "description": "Multi-organization deployments must isolate:\r\n- identity\r\n- secrets\r\n- memory\r\n- files\r\n- vector/search indexes\r\n- logs\r\n- tools\r\n- device fleets\r\n- policy\r\n- audit\r\n\r\nCross-tenant retrieval or action requires explicit authorization and must not occur through semantic similarity alone.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/security-kernel.ts",
    "src/jarvis/policy-as-code.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-018

```json
{
  "id": "GOV-018",
  "title": "120. Audit Retention and Tamper Evidence",
  "description": "Important action and security logs must have:\r\n- actor identity\r\n- action\r\n- target\r\n- policy decision\r\n- time\r\n- outcome\r\n- evidence reference\r\n\r\nRetention must be configurable by organization/data class.\r\n\r\nFor high-assurance deployments, security-relevant audit records should be tamper-evident or append-only where practical.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/remote-assist-audit.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-019

```json
{
  "id": "GOV-019",
  "title": "121. Incident Response",
  "description": "JARVIS requires an incident lifecycle:\r\n\r\nDetect\r\n→ Contain\r\n→ Preserve Evidence\r\n→ Revoke/Isolate\r\n→ Recover\r\n→ Root Cause\r\n→ Corrective Action\r\n→ Post-incident Verification\r\n\r\nIncidents may include:\r\n- credential exposure\r\n- unauthorized action\r\n- prompt/goal hijack\r\n- malware/tool compromise\r\n- data leakage\r\n- fleet compromise\r\n- model/tool supply-chain issue",
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
  "blocker": "この要求全体を満たすmain実装を本監査では特定できていない。MISSINGは検索・監査範囲内の判定。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-020

```json
{
  "id": "GOV-020",
  "title": "122. Revocation and Kill Propagation",
  "description": "Revoking a user, token, device, worker, model or tool must propagate to active sessions and queued work within a defined bound.\r\n\r\nA disabled identity must not remain effective merely because a worker is offline.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/revocation-registry.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-021

```json
{
  "id": "GOV-021",
  "title": "123. Resource Governance",
  "description": "Prevent unbounded agent loops and resource exhaustion.\r\n\r\nControl:\r\n- maximum task runtime\r\n- token/model budget where applicable\r\n- CPU/GPU/RAM\r\n- disk\r\n- network\r\n- child-agent count\r\n- retry count\r\n- parallelism\r\n- recursive planning depth\r\n\r\nBudget exhaustion must produce a resumable, explicit state rather than silent truncation.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/durable-task-runtime.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-022

```json
{
  "id": "GOV-022",
  "title": "124. Human Override and Safe Stop",
  "description": "The owner/operator must have a dependable way to:\r\n- pause a Job\r\n- pause a Worker\r\n- pause the Fleet\r\n- revoke capabilities\r\n- stop remote control\r\n- force read-only mode\r\n- invoke emergency shutdown\r\n\r\nSafe stop must preserve sufficient state for later investigation/resume when possible.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/policy-engine.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-023

```json
{
  "id": "GOV-023",
  "title": "125. Action Preview for Material Changes",
  "description": "For material but reversible operations, JARVIS should be able to generate a machine-readable preview:\r\n- intended action\r\n- target\r\n- expected changes\r\n- risk\r\n- rollback path\r\n- verification plan\r\n\r\nThis supports Human Gates without turning every low-risk action into a confirmation dialog.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/simulation.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-024

```json
{
  "id": "GOV-024",
  "title": "126. Change Impact Graph",
  "description": "Before material changes, JARVIS should estimate impacted assets using links among:\r\n- requirement\r\n- code\r\n- database\r\n- API\r\n- workflow\r\n- device\r\n- deployment\r\n- organization rule\r\n- test\r\n- evidence\r\n\r\nThis extends Living Specification + Knowledge Graph into operational change control.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/knowledge-graph.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-025

```json
{
  "id": "GOV-025",
  "title": "127. Requirement-to-Evidence Traceability",
  "description": "Every production requirement must map to:\r\n- implementation\r\n- tests\r\n- required evidence class\r\n- observed evidence\r\n- limitations\r\n- last verified version/commit\r\n\r\nA requirement is not complete while the required evidence slot is empty.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "scripts/validate-jarvis-requirements.mjs"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-026

```json
{
  "id": "GOV-026",
  "title": "128. Capability Degradation Contract",
  "description": "When a preferred capability is unavailable, the system must explicitly choose among:\r\n- fallback model\r\n- fallback tool\r\n- lower-capability mode\r\n- offline continuation\r\n- waiting state\r\n- Human escalation\r\n\r\nSilent quality degradation is prohibited for material tasks.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/gai/offline-first-runtime.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### GOV-027

```json
{
  "id": "GOV-027",
  "title": "129. Compliance / Organization Governance Profile",
  "description": "Organizations need a deployable policy profile containing, as applicable:\r\n- approved models\r\n- approved tools\r\n- permitted data regions\r\n- retention\r\n- audit rules\r\n- Human Gate thresholds\r\n- network destinations\r\n- device policy\r\n- working hours/quiet hours\r\n- records rules\r\n- required citations/evidence\r\n- legal/regulatory controls supplied by that organization\r\n\r\nJARVIS must not invent legal compliance. It must map configured controls and evidence to the applicable requirement set.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/jarvis/organization-digital-twin.ts"
  ],
  "test_refs": [
    "tests/jarvis-completion-engines.test.ts",
    "tests/jarvis-completion-readiness.test.ts"
  ],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "Component software exists in unmerged #884; actual execution-path integration and requirement-wide evidence remain incomplete.",
  "platform_limit": null,
  "fallback": null,
  "next_action": "Wire the component into the applicable authenticated execution path, add integration/security acceptance, then obtain all required evidence classes. See docs/audit/887-completion-integration.md.",
  "last_verified_commit": null
}
```

### GOV-028

```json
{
  "id": "GOV-028",
  "title": "130. Accessibility and Failure Transparency",
  "description": "Autonomous operation must remain inspectable when things fail.\r\n\r\nUser-facing status should distinguish:\r\n- waiting\r\n- blocked\r\n- retrying\r\n- degraded\r\n- failed\r\n- Human Gate\r\n- platform limited\r\n- verified complete\r\n\r\nDo not collapse all non-success states into generic `error`.",
  "phase": "P8",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY"
  ],
  "implementation_refs": [
    "src/app/jarvis/connectivity-status.ts",
    "src/app/jarvis/accessibility-preferences.ts"
  ],
  "test_refs": [],
  "evidence_refs": [],
  "status": "PARTIAL",
  "blocker": "関連基盤のみ存在。この拡張要求の全条件を強制する統合機能とEvidenceは未完成。関連ファイルは要件全体の実装済みを意味しない。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "関連する既存基盤を再利用し、要求の各条件・DoDを細分化して不足実装と検証Evidenceを追加する。",
  "last_verified_commit": null
}
```

### DEV-AX-001

```json
{
  "id": "DEV-AX-001",
  "title": "Android 8対応",
  "description": "Android 8/8.1の既存Worker登録・credentialを保持し、対応する画面取得・tap等の遠隔操作を提供する。OSの画面共有許可を明示し、必要な許可を再起動後に偽って保持しない。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "PR #860にstaged実装があるが監査mainへ未統合。対象実機への配信・検証未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存登録を維持し署名系列を確認して1台canaryで検証。OS承認を回避せず、進行中の登録を妨げないタイミングで段階展開する。",
  "last_verified_commit": null
}
```

### DEV-AX-002

```json
{
  "id": "DEV-AX-002",
  "title": "Worker自動更新",
  "description": "OS自体ではなくJARVIS Workerを更新する。同じ署名系列の正当な新版を認証・検証し、既存identity/configを保持。各端末のinstalled/available version・更新状態・失敗原因を表示。管理端末以外のOS確認は迂回しない。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "PR #858にstaged実装があるが監査mainへ未統合。対象実機への配信・検証未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存登録を維持し署名系列を確認して1台canaryで検証。OS承認を回避せず、進行中の登録を妨げないタイミングで段階展開する。",
  "last_verified_commit": null
}
```

### DEV-AX-003

```json
{
  "id": "DEV-AX-003",
  "title": "画面OFFから自動復帰",
  "description": "遠隔処理前に消灯したunlocked端末をbounded deadlineで起こし、状態を再観測して続行。locked/OS拒否/期限切れは明示停止しlock解除を迂回しない。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "PR #862にstaged実装があるが監査mainへ未統合。対象実機への配信・検証未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存登録を維持し署名系列を確認して1台canaryで検証。OS承認を回避せず、進行中の登録を妨げないタイミングで段階展開する。",
  "last_verified_commit": null
}
```

### DEV-AX-004

```json
{
  "id": "DEV-AX-004",
  "title": "登録中の更新保護",
  "description": "複数Androidを登録している間、更新で登録・identity・pending enrollmentを壊さない。進行中タスク・画面共有・遠隔入力との競合も避け、認証/署名検証とcanary後の段階展開を行う。",
  "phase": "P4",
  "required_evidence": [
    "CODE",
    "UNIT",
    "INTEGRATION",
    "SECURITY",
    "PHYSICAL",
    "RECOVERY"
  ],
  "implementation_refs": [],
  "test_refs": [],
  "evidence_refs": [],
  "status": "MISSING",
  "blocker": "PR #860にstaged実装があるが監査mainへ未統合。対象実機への配信・検証未完了。",
  "platform_limit": null,
  "fallback": null,
  "next_action": "既存登録を維持し署名系列を確認して1台canaryで検証。OS承認を回避せず、進行中の登録を妨げないタイミングで段階展開する。",
  "last_verified_commit": null
}
```
