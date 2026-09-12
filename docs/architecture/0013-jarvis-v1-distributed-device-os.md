# ADR 0013: JARVIS v1 Distributed Device OS

Status: Accepted by owner on 2026-09-12

## Goal

JARVIS is the owner-facing control and execution layer above the existing AI Company, GAI research OS, Compass, resident bridges, workers, memory, verifier, recovery, and policy controls. It is not a replacement architecture.

The target is one logical JARVIS spanning up to 100 nodes while preferring zero incremental cost, local execution, graceful offline behavior, self-recovery, and minimal Human Gates.

## Non-negotiable principles

- Maximum registered fleet size: 100 nodes.
- ChatGPT Plus may be used as the existing baseline subscription, but additional pay-as-you-go AI/API spend is prohibited by default.
- Local/open-source/free routes are preferred before any paid route.
- LOW/MEDIUM safe work may continue automatically after verification. HIGH-risk work requires a Human Gate. CRITICAL work is prohibited.
- Production publication/deployment, secrets, permission changes, billing, destructive operations, governance weakening, and security weakening remain gated.
- Android is the primary unattended mobile worker platform. iPhone remains supported as a Mobile JARVIS/control surface but must respect stricter iOS background constraints.
- Dedicated Android workers should avoid storing centrally managed screen-lock PINs. For unattended nodes, Full Enrollment should provision a dedicated-device configuration designed not to stop at a personal lock screen.

## Connectivity modes

JARVIS automatically routes among:

1. FULL ONLINE: mobile and workstation online, full remote/cloud/local capability.
2. MOBILE OFFLINE / PC ONLINE: mobile continues local work, persists commands, then syncs on reconnect; same-LAN direct execution is used when available.
3. MOBILE ONLINE / PC OFFLINE: mobile/online-capable work continues; workstation-required jobs queue until recovery.
4. LAN ONLY: devices communicate directly on the local network without internet.
5. FULL OFFLINE: local speech, local models, local memory/data/maps/GPS/camera and local tasks remain available; remote/online tasks use store-and-forward.

Connection priority is Internet -> LAN/Wi-Fi direct -> supported nearby transport -> Local -> Queue. Optional satellite transport is not required and must not create unapproved cost.

## Required JARVIS v1 capabilities

The architecture retains the owner-approved 33 capability groups:

1. device registration and identity
2. device capability registry
3. heartbeat
4. job lease
5. idempotency/deduplication
6. priority engine
7. scheduler
8. event engine
9. dependency graph
10. checkpoint/resume
11. conflict resolution
12. offline data pack
13. local model manager
14. resource manager
15. power policy
16. network policy
17. secrets manager
18. RBAC/node policy
19. audit log
20. rollback
21. canary execution
22. fleet groups
23. health monitor
24. watchdog
25. backup/disaster recovery
26. observability
27. learning loop and Skill Library promotion
28. failure memory
29. simulation/dry-run mode
30. unified JARVIS Policy Engine
31. Remote Assist / Human Takeover
32. Device Wake / Lock / Dedicated Device Manager
33. Zero-Touch / One-Tap Enrollment

## Device enrollment

Three paths are required:

### Quick Enrollment

For already-used Android devices. No factory reset is required. Scan a short-lived enrollment QR/token, install/start JARVIS Worker, grant supported permissions, generate the device identity/key material locally, report capabilities, and register as a personal/worker node.

### Full Enrollment

For new or resettable Android devices. Provision during initial setup as a dedicated JARVIS worker using the strongest supported Android management mode. This is the preferred path for unattended fleets.

### Upgrade

A Quick Enrollment Android may later be backed up, reset, and re-provisioned as a Full Enrollment dedicated worker.

Fleet Enrollment tokens must support expiry, maximum device count, target group, automatic device naming, and token invalidation after capacity is consumed.

## Task execution and fleet behavior

JARVIS Core imports or receives tasks, assigns a Task ID and idempotency key, evaluates policy/cost/connectivity/capability requirements, selects a healthy node, issues a time-bounded lease, verifies completion, records the outcome, and advances to the next task.

Sequential execution is the default for workflows where order matters. Controlled batches are allowed. Failures may be retried within policy, offline nodes may be skipped/requeued, expired leases are reclaimed, and completed idempotency keys prevent duplicate work after reconnect.

For spreadsheet URL workflows, JARVIS Core should read the source list centrally and send the target URL directly to each worker. Workers do not need to open the spreadsheet UI. Any third-party automation must comply with that service's terms and anti-abuse requirements.

## Remote Assist / Human Takeover

Normal operation remains automated. When self-recovery cannot resolve an unexpected screen/state, the node transitions to needs-human/waiting-human and preserves failure context:

- node ID and task ID
- last JARVIS action
- current URL/application where available
- error and retry count
- screenshot/recording reference where permitted

The dashboard or Mobile JARVIS can then open a live view when the worker platform supports it, pause automation, allow the owner to take control, and resume from the checkpoint afterward. Human fixes should be captured as candidate procedural knowledge, verified, and promoted into the Skill Library only through the existing learning safeguards.

## Dedicated Android behavior

Dedicated Android workers should be configured for unattended operation rather than automated PIN entry. Target behavior is:

screen off -> wake -> resident worker available -> permitted app/URL action -> verify -> report.

Nodes should report lock state. Personal/locked devices use Human Takeover when authentication is required. Dedicated workers use least privilege, allowlisted applications/capabilities, watchdogs, restart recovery, and device-specific policies.

## Cost and safety routing

Execution routing evaluates, in order:

1. Is the action permitted and safe?
2. Is the node authorized and capable?
3. Can it run locally at zero incremental cost?
4. Can another available zero-cost node do it better?
5. Is a free allowed online route available?
6. If only a paid route remains, stop and require a Human Gate.

Paid execution is never silently substituted.

## Rollout and acceptance

Implementation is designed for 100 nodes from the start but validated progressively:

- Stage A: one Android/worker, full end-to-end task lifecycle
- Stage B: 5-node mixed connectivity and reconnect/deduplication
- Stage C: 10-node sequential/batched scheduling, recovery and takeover
- Stage D: capacity test to 100 registered nodes
- Stage E: real-device acceptance for wake, offline queue/sync, enrollment, remote assist and resume

Repository/CI tests may verify contracts and simulations but must not be reported as physical Android or network acceptance. Real-device evidence is required before those capabilities are marked operationally complete.
