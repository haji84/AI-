# Home Coordinator and mobile ZBook: staged compatibility migration

Owner architecture instruction 2026-09-17; parent #681, audit #863. Current physical Coordinator remains ZBook. Target home host candidate is the owner's Mac. The logical role is `JARVIS-HOME-COORDINATOR`, independent of physical host, not a replacement worker ID or credential.

Home role owns durable Broker, registry, enrollment authority, queues, signed verification, reconnect, private ingress, Remote Gateway routing and evidence. ZBook becomes a mobile high-performance Worker with its existing identity. GPU/inference is not required on the Coordinator. Windows/Linux/NAS-compatible hosts remain possible future placements subject to validated runtime support.

| Stage | Exit evidence |
| --- | --- |
| M0 | Read actual device identity, endpoint, protocol, credential metadata and queue dependencies; record baseline and unresolved observations |
| M1 | Add logical role abstraction; default behavior and existing protocols unchanged |
| M2 | Preserve existing IP/TLS endpoint using home compatibility bridge; signed paths/headers unchanged; private only |
| M3 | Start Mac shadow isolated from dispatch/enrollment authority; no production side effects |
| M4 | Copy and validate consistent state, sidecars/evidence and protected credentials; no naive last-write-wins; single-writer fencing tested |
| M5 | One existing Android: same ID/key, signed task/result/verifier, pending jobs/history, reboot and network loss |
| M6 | One existing iPhone: same ID/Keychain, delivery/signature/verifier, pending jobs/history, reboot/network recovery |
| M7 | Expand gradually after both canaries pass; rollback remains available |
| M8 | Remove ZBook from home Wi-Fi; home jobs/access continue; reconnect ZBook externally with same ID; return prefers trusted LAN |
| M9 | New primary only after physical evidence; old path retained without a second active scheduler |
| M10 | Remove old dependencies only after sufficient physical/recovery evidence and approved change |

Keep vCurrent and vNext during migration. Do not force all Workers to update first. Worker updates must retain preferences/keys and match signing lineage; Android OS confirmation requirements cannot be bypassed.

Use authenticated discovery, trusted bootstrap and cached known-good logical service routes. Same trusted LAN prefers LAN, outside uses private tailnet, disconnection uses durable offline behavior. No route change grants identity, capabilities or permission. Existing ingress and iPhone discovery need work before this is operational.

Before switching: registry/state/queue/config snapshots, credential metadata and encrypted secret handling, validation, rollback reconciliation including work accepted since snapshot. Never restore an old snapshot over new enrollment or task results. Do not let shadow enqueue, lease or execute jobs. Replay protection and nonce continuity are mandatory during overlap.

P0 tracks MIG requirements and baselines; P1 logical ingress/routes; P2 reconnect/fencing/rollback; P4 protocol/identity/update compatibility; P9 real existing-device acceptance; P10 operator-free startup and release. P3/P5/P6/P7/P8 work continues and consumes the same security and evidence requirements. Historical ZBook HOST/NET requirements remain in the ledger; this target generalizes their placement, not their safety or recovery guarantees.
