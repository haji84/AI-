# Home Coordinator migration: M0 compatibility audit (#863)

Parent: #681. Owner selected a Mac that can stay at home (2026-09-17).
This is an audit, not a production cutover or migration PASS. Production registration remains protected.
Source baseline: 6de0087665ff5c5ecbdd6660d12383517a2e50b0; deployed Windows configuration: 14f0651a51ba79a53bff36f15175351d44f0f2fb.

## Observations and compatibility contracts

| Area | Existing implementation | Migration obligation |
| --- | --- | --- |
| Android identity | `android/jarvis-worker/app/src/main/java/ai/jarvis/worker/DeviceIdentity.kt`: persistent UUID in `jarvis_identity`; EC key in AndroidKeyStore | Preserve both; changing networks must not create a device |
| Android endpoint | `installation/zbook.properties` under Android Worker: `https://192.168.0.169:8792`; `BrokerClient.kt` uses saved `jarvis_config.broker_url`; bootstrap is not a universal endpoint migration mechanism | Retain legacy IP/TLS contract through an always-home compatibility endpoint; changing DNS alone cannot fix cached literal IP |
| TLS | APK embeds public certificate trust for bootstrap host; inspected installed ingress certificate SAN is only `192.168.0.169` | Preserve trusted certificate relationship; private key transfer requires protected transport/storage and explicit credential authorization; no plaintext archive |
| Signed Android requests | `src/jarvis/worker-auth.ts`, `BrokerClient.kt`: node, timestamp, nonce, method, path, body hash; host is outside signed canonical payload | Forward exact signed path/body/headers; preserve enrolled public keys, authorization and clock checks |
| Existing ingress | `src/jarvis/private-worker-ingress.ts`: RFC1918 IPv4 TLS bind, worker-only POST allowlist, loopback Broker forwarding | This is not yet a cross-host bridge; tailnet 100.64/10 is not an accepted private bind. Never widen it to arbitrary public addresses |
| Broker persistence | `scripts/jarvis-broker.ts`, `src/jarvis/sqlite-state-store.ts`, `control-plane.ts`: SQLite WAL snapshot plus worker identity table | Consistent transaction/backup of both, verify copy, single writer, rollback without losing new writes |
| Non-durable Broker state | Nonce registry, pending enrollments, pairing window, replacement challenges, remote mailbox are memory-resident; invitation store is a separate sidecar | No restart during active enrollment. Preserve replay window and grants or controlled drain. Never replay uncertain remote inputs |
| Tasks/history | Snapshot restores fleet, tasks, takeovers, bounded audit; completed idempotency reconstructed from tasks | Preserve leases, results, task payloads and external evidence; audit snapshot alone is not full history |
| iPhone | `apps/ios-worker/Sources/WorkerRuntime.swift`: persistent deviceId/bridgeURL, Keychain credential; separate `scripts/iphone-bridge-server.ts` | This is not the Android Broker protocol. Preserve existing bridge master key relationship and Keychain value |
| iPhone discovery | Bonjour `_jarvisiphone._tcp`, local scan, HTTP discovery metadata; discovery protocol v2 vs worker/task protocol v1 | Discovery is not cryptographically authenticated. Do not extend automatic bearer credential submission to new WAN endpoints |
| iPhone pending state | Bridge maps hold enrollment, queued jobs and results in memory; completed evidence files are separate | Add durable state and loss/duplicate tests before shadow/canary; reconnect is not proof of pending-job survival |
| Windows secrets | Production `config.dpapi` is Windows CurrentUser protected and exact-release bound | Cannot copy blob to Mac and expect it to work. Re-protect the same credentials; no key regeneration |
| PC/Mac worker | `src/gai/common-worker-runtime.ts`, `initial-worker-adapters.ts` provide runtime abstractions | Actual Mac service, persistent identity, endpoints and hardware readiness have not been inspected; do not infer them from generic adapters |
| Route selection | `src/jarvis/connection-router.ts` models connectivity/transport decisions | Not implemented authenticated multi-endpoint LAN/tailnet handover |

## CURRENT_CONNECTED_DEVICE_BASELINE

Read-only SQLite transaction at 2026-09-17T00:10:20.961Z: 38 Android registry entries, 38 corresponding credentials, 0 tasks in that snapshot, 124 audit records. Snapshot timestamp is 2026-09-16T23:06:04.843Z, so it is stale and is **not live connectivity evidence**.
Local metadata artifact: `tmp/physical-remote-tools/CURRENT_CONNECTED_DEVICE_BASELINE-863.json` (outside tracked worktree), SHA256 `8006443bd3e2338cb3c12fbd006f76bbb4afe01d19eb63913a4455e444f1f1a9`.
Contains IDs, platform, heartbeat, capability/protocol, enrollment, public-key fingerprint, task digests; no credential values or task payloads. Not a secret backup.

A subsequent authenticated read of the running Broker returned 38 entries with stored status `ready`: 36 at Worker 0.4.3, one 0.4.2, one 0.4.4. Stored `ready` alone is not a fresh heartbeat or physical verification. At 2026-09-17T00:17:52.652Z the live Broker also had 0 heartbeats within 90 seconds, newest heartbeat 2026-09-16T23:06:07.820Z and 0 tasks. Thus stored ready is stale in both live and durable views; current connectivity and its cause remain unverified. No service was restarted to investigate it.

The pure `migrationBaseline` / `compareMigrationBaseline` utility compares frozen copies of the **same** state cut. It does not export keys, run migrations, select hosts or roll back live work. In-memory enrollment/nonces, iPhone state, device-local offline queues and external evidence remain explicitly excluded. A passing comparison cannot certify full migration.

## Risk and minimum next action

Read-only audit and isolated tests are LOW risk. Production endpoint/IP transfer, credential transfer, schema migration and deployment are separate gated actions. Nothing in #863 authorizes wiping devices, replacing keys, restarting active registration, dual scheduling, or routing traffic to an unverified Mac.

Next: inspect Mac OS, storage, current iPhone bridge and credential **existence only**, Tailscale service and unattended startup; reconcile live/durable Windows snapshot freshness. Then implement M1 logical role configuration without changing active routes, and M2 bridge preserving the legacy endpoint. The old IP cannot remain solely on a ZBook that leaves home; duplicate assignment is prohibited.

M0 repository audit is recorded; full live topology audit is PARTIAL. Android/iPhone canaries, Mac startup, ZBook departure/return and rollback are UNVERIFIED. Existing Android8/updater/wake draft work (#858/#860/#862) remains pending independently. Revert this isolated audit branch to roll back its code/docs; production has no changes to revert.


## Verification

Local: 8/8 targeted baseline/ledger tests PASS; all 274 IDs exactly once and ledger/matrix equality PASS; TypeScript noEmit PASS; targeted ESLint PASS. These are software checks, not physical migration evidence.
