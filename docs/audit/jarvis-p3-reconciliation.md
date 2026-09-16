# P3 software evidence reconciliation — #694

Audited tree: `8cf248497a61f811792453f5fbc72cb6d26c835e`, integrating main through #703. This audit updates the P0 inventory; it does not close P3 physical acceptance.

## Observed implementation

| Requirements | Implementation and tests | Remaining proof |
| --- | --- | --- |
| RA-001/002/007–012, UI-037 | Console session lifecycle, opt-in screenshot refresh, Android Gateway input; `jarvis-remote-assist-console.test.ts` checks source contracts | Browser/API integration and physical Android/PC operation. Source matching is not browser execution. |
| RA-003/004/005 | `RemoteAssistMultiView.tsx`, `remote-assist-view.ts`; planning/concurrency tests and UI source contracts | Physical split2/split4/windowed fleet, visibility and failure recovery |
| RA-006/022, DEV-I-008 | `remote-assist-node-capability.ts`, Devices page and node capability tests | Actual transport and per-platform proof; generic flags do not prove working control or FULL MANAGEMENT |
| RA-013, DEV-A-010 | Bounded PNG frame recorder, API start/status/stop and Console PNG controls; recorder tests | Capture cancellation/deadline hardening, audit admission, authenticated playback/export and physical recording |
| RA-014/015/017 | Serial-bound sessions, TTL, owner-authenticated route; session tests | Real auth/transport/session integration and physical expiry |
| RA-016 | Existing private ingress + loopback gateway | Cellular encrypted path and network inspection; unit predicates do not prove deployment |
| RA-018, SEC-016 | Durable retained JSONL audit, privacy filtering and audit tests | Audit failure admission and full API negative tests |
| RA-019/020, SEC-015 | Exact nodeId-to-serial takeover association and persistent takeover state | Re-observation, differing identities and physical fail → human → resume → verifier PASS |
| RA-021 | Pointer/gesture provenance policy in #700 and negative policy tests | End-to-end command routing to this policy, with protected intent preserved |

## Verification performed

- Integrated full Node suite: 726/726 PASS, zero skips (Windows, Node 24.19.0).
- Startup PR #698 CI #967 passed lint/tests/build/health before newer-main integration; do not project that result onto subsequent commits.
- P3 tests use simulated frames and devices. No PHYSICAL or RECOVERY evidence record is created by this audit.
- Canonical ledger and machine mirror remain exactly 238 unique IDs. Six obsolete MISSING rows become PARTIAL: RA-003/004/005/006/013 and DEV-A-010. All other evidence requirements remain intact.

## Concrete remaining software defects

1. `recording-start` currently starts capture before appending `recording.started`. If that append fails, the request reports failure but capture may continue. Admission must be audited before the first capture.
2. The recorder awaits capture without a deadline or cancellation signal; a stalled gateway can defeat duration and owner-stop bounds. It also writes a returned frame before checking whether a stop/deadline occurred in flight.
3. A session/capability check is required for every background capture, not only at initial admission. Never extend authorization merely to finish recording.
4. Recorded PNGs lack an owner-facing authenticated retrieval/playback path; local filenames are not terminal-free routine operation.

Next: reproduce and repair recording admission/cancellation with negative tests in a narrow child issue, then continue P4–P10 work. Keep account, firmware and real-device acceptance gates separate. No platform-impossibility finding is made here.

## Operations notes

The available GitHub workflow-run wrapper filters to pull-request events. Empty results for main commits do not establish that main CI did not execute. Main verification requires a suitable source; no deployment or release is authorized from presumed success. Vercel preview build-rate-limit is not resolved through an unapproved paid upgrade.

Rollback: revert this documentation/matrix reconciliation. No runtime, permissions, schema or device configuration changes.
