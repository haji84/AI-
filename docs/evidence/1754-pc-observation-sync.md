# PC task observation synchronization (#1754)

Baseline: `ce6547f561c7e09bc34398263046b999b945826e` (PR #1752). Parent Goal #1219/#681. Implementation and isolated software verification pass; no physical acceptance is claimed by this record.

The bounded increment exchanges one PUBLIC digest task observation using existing PC identities and saves it outside the executable queue. The observing Node signs its report. This is source attestation, not a retained historical Worker signature or an independent result oracle. Coordinator ownership, executable queue import and conflict resolution remain separate work.

## Native prerequisite observation

A fresh read-only native `Win32_Process` probe on ZBook at `2026-10-08T21:51:48Z` confirmed the compatibility launcher resolves to native AppData, delegates to the USERPROFILE production launcher and has the same owner. The recurring additional read-only Allow entry remained explicit on `JARVIS` and inherited on production/config/launcher (numeric rights `1179817`, sanitized class `codex-or-sandbox`). The actor that restored it has not been identified. The probe was not elevated.

Local Broker health at `2026-10-08T21:50:31Z` was `ok=true`, revision `a49c458d69a28c0266be8fcad5b26253e5ed8d75`. Thus the Broker was still old despite Runner recovery. Neither ACL removal nor runtime apply nor a production fault was attempted. #1662's no-repeat-removal boundary remains in force. Its then-current ZBook refresh grant has an expiry of `2026-10-08T22:33:43Z`; this document grants no renewal.

Sanitized native receipts remain locally retained under `tmp/goriq-1662-readprobe-20261008T215030Z` in the original workspace. SHA-256:

| Receipt | SHA-256 |
| --- | --- |
| native-acl-recurrence.json | 03c648e1e3e1c6632e34356bc4faea80b9869b342ffa632217bf348a8f2ff79e |
| launcher-view-native.json | b5adf0ae26a306ecb719ea375fe43ba44bba68fa379830239617bdf02ff85153 |
| health.json | 606067cafd3a5bc2a30d1bcb3951d619e1bf3e45b60e3d41c6c16ffc2f12087c |

The result is recorded in [#1662](https://github.com/haji84/AI-/issues/1662#issuecomment-6069755526). Filesystem access in the development tool does not prove production ACL or native file-view readiness.

## Verification and remaining boundaries

The local expanded regression run passed 56 tests across the new observation adapter/integration, existing PC durable work, bootstrap, peer enrollment, private transport/native checks, four result-reconnect socket-loss cases and durable concurrency. After final test additions, the observation integration and 18 traceability/completion-audit tests passed together; the native signer suite passed 6 tests. `pnpm lint`, `pnpm exec tsc --noEmit` and `git diff --check` passed. Initial full lint exposed undeclared globals in retained untracked audit helper scripts; those helpers were corrected without changing lint rules. The new adapter was first run RED with its implementation absent.

The integration starts two actual Broker child processes with separate databases, signing identities and temporary home directories. An isolated Worker child executes the real public file capability, and its digest and byte count are checked against an independent Node crypto calculation over the literal fixture input. A socket proxy drops the peer acknowledgement after persistence. A new signed retry after Broker restart is a duplicate and leaves executable queue bytes unchanged. A clean pair of independently enqueued same-ID tasks with different targets produces persistent conflicts on both PCs through reciprocal client calls alone. Tests also reject wrong source/revision/key, changed signed bodies, replay and revoked identity, and verify local storage failure prevents transmission. The fixture relay signs real responses but maps Tailnet addresses to loopback; it does not establish native TLS or physical network behavior.

Adapter tests cover out-of-order delivery, normal progress, immutable input forks, terminal/epoch regression, independent-source ownership ambiguity, capacity limits, failed-save retry and separate-process writers. A native-signer check proves its role metadata is copied from registered authority; the observation relay refuses receivers missing Storage or Coordinator before backend access. Independent reviewer executed 22 focused tests and found no remaining blockers after the fixes. The root reviewed the final oracle/divergence assertions and reran the affected integration.

Reproduce the central suite with `node --test tests/jarvis-pc-task-observation.test.ts tests/jarvis-pc-observation-broker.test.ts tests/jarvis-private-pc-transport.test.ts tests/jarvis-private-pc-native.test.ts`. Final commit/hosted CI identities are recorded in the associated PR. Surface mapping updates only three existing fingerprints and adds the two internal observation files; canonical requirement statuses are unchanged. PROJECT_STATE changes only CURRENT_PHASE, OPEN_PRS and NEXT_PRIORITY, checked mechanically.

The exchange is an explicit client call, not a background replication scheduler. It has no conflict-resolution action, global ownership proof, execution-store import or Worker outbox. At 64 task bundles or 16 variants per task it refuses further new evidence rather than evicting old evidence. Physical PC runtime alignment, private transport, Coordinator handoff/loss, full partition, LAN-only continuation, reconnect/resync/rebalance, PINNED and SIDE_EFFECTING behavior remain unverified. Keep production fault injection blocked until those prerequisites are independently satisfied.

Rollback removes the observation source/routes while retaining evidence and existing task/identity stores. It does not authorize ACL changes, identity replacement, schema migration or saved database import.
