# Issue #1205: bounded semantic audit of MISSING requirements

Source: exact main a7bfcbe52e8108aa567c0ef4c6b90b16c2156c00. Two AI employees reviewed GitHub source; root reconciled the results and checked critical caller reachability. Evidence kind: AI_ASSERTED_SOURCE_REVIEW; physical=false.

This batch assesses the 34 MISSING rows that already had reverse-traceability source leads. It does not audit all 341 requirements or the other 63 MISSING rows.

| Canonical status | Before | After |
| --- | ---: | ---: |
| VERIFIED | 3 | 3 |
| IMPLEMENTED_UNVERIFIED | 7 | 18 |
| PARTIAL | 234 | 256 |
| MISSING | 97 | 64 |

All 341 IDs and 338 incomplete requirements remain. No requirement becomes VERIFIED or PLATFORM_LIMITED. The remaining 64 MISSING comprise one assessed gap (MIG-023) and 63 unassessed rows.

## Interpretation and preservation

- No new VERIFIED or PLATFORM_LIMITED rows; no product-completion claim.
- Remaining 64 MISSING = 1 assessed gap plus 63 not assessed in this batch; they are not all proven genuine gaps.
- Source paths/line numbers refer to audited_commit, not a future runtime or deployment.
- The global ledger audited_commit and row delivery_audit retain their historical full-inventory scope; current conclusions live in this linked report.
- PR #1208 is staged/draft with physical acceptance pending and is excluded from audited main.
- This source audit makes no native recovery claim. Existing runner-loss run37607612844 completed at09:19Z and is tracked separately in Issue1745; Coordinator/network/OS recovery, Issue1662 ACL recurrence, Windows physical gates and17 Cognitive final verifications remain open. Nubia/Android38 deferred.

Descriptions, required evidence, prior evidence records, verification commits and historical delivery_audit are unchanged. Historical NO_CODE_MAPPED/STAGED_CODE_ONLY values describe the old snapshot; the linked JSON report contains this newer, bounded classification. UI-015 is conservatively PARTIAL because common presets are mounted but widget presets remain disconnected.

## Findings and next action

| Requirement | Status after review | Implemented behavior | Remaining work |
| --- | --- | --- | --- |
| UI-008 | IMPLEMENTED_UNVERIFIED | Mounted theme and persona settings use separate persisted preference fields; shell reapplies them. | Independent setting/reload interaction and physical acceptance remain unverified; persona reasoning is outside this setting requirement. |
| UI-010 | IMPLEMENTED_UNVERIFIED | Mounted accent selector persists independently and applies the CSS accent variable consumed by controls. | Tests inspect source contracts; independent change/reload behavior and physical acceptance remain unobserved. |
| UI-012 | PARTIAL | Drag/drop and move helpers plus a widget editor exist. | Editor has no production caller in src; required deliberate edit-mode/long-press entry and normal-mode immobility are not established. |
| UI-013 | PARTIAL | Existing widget size helper/editor supports normal, wide and full with responsive CSS. | Editor is not mounted by production code, so reachable resizing and persistence are unproven. |
| UI-014 | PARTIAL | Hide/show normalization exists and preserves Human Takeover; primary shell navigation exists separately. | Disconnected editor prevents delivered hide/restore; expanded primary-navigation and Goal invariants need integration evidence. |
| UI-015 | PARTIAL | Mounted common layout presets persist and affect CSS; separate widget-position presets also exist. | Widget preset editor is disconnected. Generic layout preset behavior exists, but the audit conservatively retains PARTIAL until widget-layout scope and delivery are covered. |
| UI-016 | IMPLEMENTED_UNVERIFIED | Mounted per-design screen profiles persist seven screen settings and are reapplied by pathname/design. | Route/design switching, persistence interaction and physical acceptance remain unverified. |
| UI-017 | PARTIAL | Bounded 30-entry Undo history and editor controls exist. | Editor has no production caller; history is in-memory per editor mount, and screen-profile Settings has no Undo path. |
| UI-018 | PARTIAL | Redo and invalidation after a new change exist in the history helper/editor. | Disconnected editor prevents demonstrated user-reachable Redo. |
| UI-019 | PARTIAL | Mounted Settings resets selected-design screen profiles without Goal/API mutation. | Widget placement reset is in a disconnected editor with a global storage key; complete per-design reset and unrelated-data preservation are unproven. |
| UI-021 | PARTIAL | Mounted command search ranks bounded Japanese/English aliases and navigates seven fixed screens. | Actual tasks/projects/nodes/history and newer primary routes are not in that seven-item catalogue; broader Universal Search remains incomplete. |
| UI-022 | IMPLEMENTED_UNVERIFIED | Mounted owner-protected state polling ranks Human Gate, failed, running and queued statuses and displays fetch errors. | Actual UI state/error ordering and physical acceptance are unverified; OS push/configurable delivery are outside this bounded implementation. |
| UI-023 | IMPLEMENTED_UNVERIFIED | Mounted persisted Focus mode reduces inactive navigation and detail presentation without targeting safety surfaces. | Rendered screen behavior and physical safety-visibility acceptance remain unverified. |
| UI-024 | IMPLEMENTED_UNVERIFIED | Mounted persisted Distance mode enlarges root type, control targets and content presentation. | CSS existence does not establish usability at physical viewing distances or on all devices. |
| UI-028 | PARTIAL | Privacy mode masks remote screens, multiview and legacy enrollment code selectors. | Current invitation URL input and provisioning QR are outside the examined privacy selectors; rendered sensitive-panel coverage is incomplete. |
| UI-030 | PARTIAL | Mounted read-only boundary blocks child mutation interactions, and Kiosk retains local exit controls. | GlobalConversationLauncher is outside the boundary and enables CommandChat's POST /api/command path; full read-only UI behavior is incomplete. Backend authorization is separate. |
| INT-004 | PARTIAL | Shared conversation persists text/transcripts and AI replies; voice input selects local TTS for a new reply. | No response-modality override or seamless restored-session/mode continuity is established. |
| INT-005 | PARTIAL | Global conversation sends current pathname/mode as context; older selected-command resolver handles a bounded 'this' reference. | Path metadata and prompt wording do not establish retrieval over every GORIQ entity, unique-target actions or minimal clarification. |
| INT-006 | PARTIAL | Voice resolver reparses the newest sent, same-target, non-redacted safe command for the prior-command reference. | General screen/global-conversation reference semantics and the former text-command history path are not established. |
| INT-007 | PARTIAL | Bounded ordinal references select filtered safe command history and reject absent/out-of-range choices. | Command-history ordinals do not establish current-screen entity/list references across GORIQ. |
| INT-008 | PARTIAL | Authenticated local TTS path provides loopback Aivis/VOICEVOX discovery, voice selection, bounded synthesis, settings and playback. | Terms availability checks only a nonempty policy value; requested missing voice can select another candidate; synthesis-failure fallback, redirect confinement and actual engine/model acceptance remain unproven. |
| INT-009 | PARTIAL | Persisted standard/brief/formal speech policy changes fixed status phrases; persona and acoustic controls are stored separately. | Shared AI replies bypass the saved speech style; normalization/source tests do not prove full-reply style or reload behavior. |
| INT-017 | IMPLEMENTED_UNVERIFIED | Voice commands use the shared safe parser and explicit execute; unified conversation uses existing owner authentication and Human Gate handling. | Integrated voice-origin protected requests and ambiguous approvals still need security/physical acceptance evidence. |
| GEST-001 | PARTIAL | Opt-in local camera processing classifies dominant changed-pixel motion and changes safe UI selection. | Whole-frame motion detection explicitly does not understand hand shape; full hand gesture recognition and physical false positives remain open. |
| GEST-004 | IMPLEMENTED_UNVERIFIED | Motion safeguards bound samples, distance, dominant axis, duration, pixel change and cooldown; navigation still needs tap/Enter. | Physical lighting/motion false-positive acceptance remains pending. |
| GEST-006 | IMPLEMENTED_UNVERIFIED | Mounted smartphone pointer includes orientation permission, calibration, dead zone, smoothing, projection, stop and manual activation. | Implementation selects local navigation targets, not a remote desktop cursor; physical permission/calibration/stop behavior is unverified. |
| GEST-007 | IMPLEMENTED_UNVERIFIED | Mobile controls select fleet nodes and submit bounded device actions through owner API, Broker queue and signed worker handling. | Actual smartphone UI to selected device to observed result evidence remains required; local pointer navigation alone does not satisfy this path. |
| SEC-011 | PARTIAL | Repository scanner detects defined credential signatures and sensitive-variable console logging without returning secret values; production configuration uses host-local DPAPI. | Scanner covers selected extensions/directories/size bounds and excludes Git history; it cannot prove no secrets across all possible storage. |
| OPS-012 | IMPLEMENTED_UNVERIFIED | Mounted owner-gated readiness wizard groups host, connection and permission diagnostics and shows worst/missing states and actions. | This is read-only readiness guidance, not automatic installation; actual first-run acceptance is unverified. |
| ACC-009 | PARTIAL | ControlPlane supports concurrent tasks on distinct nodes; a helper checks expected completed tasks, explicit verifier booleans and multiple nodes. | Acceptance helper has no production caller in src/scripts and trusts caller-provided verifier evidence; actual same-Goal parallel completion is unverified. |
| MIG-006 | PARTIAL | SQLite snapshots/identities, persisted task/verification history and hashed database backup primitives exist. | Identity history reader has no production caller; database backup alone does not preserve external evidence artifacts or establish lossless migration. |
| MIG-016 | PARTIAL | Android Node Contract resource metadata and honest capability limits are wired into enrollment/heartbeat and Broker sanitization. | Contract declares offline queue, checkpoint resume and side-effect fencing unavailable; Nubia/iPhone/fleet physical sequence is not established. |
| MIG-022 | PARTIAL | Connectivity routing distinguishes online/LAN/offline and placement considers available node resources/load/data locality. | Normal Broker polling supplies fixed online connectivity; integrated trusted-LAN/private/offline transport choice and re-evaluation are unproven. |
| MIG-023 | MISSING | Bonjour/bootstrap/reconnect mechanics exist, but examined discovery accepts an HTTP endpoint by service name and protocol fields. | Coordinator identity authentication was not found in discovery-to-reconnect before sending the existing credential; source review is not a runtime exploit claim. |

Per-row implementation/test references, source lines and next actions are in [the machine-readable report](./1205-semantic-missing-audit-2026-10-08.json). Line references are pinned to the audited source commit.

## Verification

Related tests: 144 PASS / 0 FAIL / 0 SKIP across 33 files. Ledger/traceability/completion tests: 24 PASS / 0 FAIL / 0 SKIP. All three validators PASS (341 requirements, 571 reverse surfaces, 338 incomplete). A strict baseline comparison confirms 34 metadata-only row changes, 307 untouched rows, unchanged requirement/evidence floors and four allowed PROJECT_STATE fields. git diff --check PASS. Full commands and outcomes are in the JSON verification section. Source-contract/unit tests do not prove rendered UI behavior, actual Aivis/VOICEVOX models, physical device use, reboot or recovery.

## Rollback and continuation

Revert this audit commit to restore the prior ledger metadata; no runtime, policy, credential, permission, workflow, database or deployment is changed. Issue #1205 remains open for the remaining semantic audit. Reuse these existing implementations when filling gaps rather than creating duplicates. Preserve #1745/#1662/#1207 physical holds and Nubia deferral.
