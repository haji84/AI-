# Bounded native Windows verification Worker (#1207)

Candidate implementation. Do not deploy or merge the physical-facing PR before the existing-device acceptance gate.

## Supported path
Owner-authorized Windows verification dispatch -> durable Broker queue -> signed heartbeat/poll -> fixed local Node platform/version probe -> signed result -> Broker validation -> persisted task state.
Only smoke / platform is supported. Browser, Office, arbitrary commands and general Windows automation are not claimed by this consumer. Other task types stay queued for their existing workers.

## Launch contract
Use Node 24.19.x on Windows and an already enrolled Windows identity with windows-tooling capability. The CLI accepts no arguments except optional --once for one bounded diagnostic cycle:

    node scripts/jarvis-windows-worker-service.ts --once

Required environment variables:
- JARVIS_WINDOWS_WORKER_BROKER_URL: existing Broker origin; remote HTTPS or loopback HTTP only.
- JARVIS_WINDOWS_WORKER_NODE_ID: existing node ID.
- JARVIS_WINDOWS_WORKER_PRIVATE_KEY_PATH: existing private key file; never print or paste it.
- JARVIS_WINDOWS_WORKER_ALGORITHM: existing ed25519 or ecdsa-p256-sha256 scheme.
- JARVIS_WINDOWS_WORKER_JOURNAL_PATH: dedicated absolute persistent path for this consumer. Keep it across restarts.

This CLI does not enroll a device, create/rotate a key, install a service, change startup/ACL/firewall settings or start production automatically. New credentials or service configuration require the existing Human Gate. Do not run it concurrently with another consumer for this identity. OS-owned Windows pipe mutexes exclude duplicate instances by identity/origin and by journal path; they accept no commands and disappear on process exit.

## Recovery and result integrity
Before execution, atomically save started with the identity/endpoint binding and task digest. After execution, save the exact result before sending. Failed delivery retries the same result. Interrupted started state becomes execution UNKNOWN and is not automatically run again. A matching Broker acknowledgement advances to acknowledged.

An exact terminal 409 (lease expiry, terminal conflict, cancellation or missing retained result evidence) advances to rejected with the original report and rejection code. It is a visible failed verification; the next cycle may poll again. Other transport failures, malformed acknowledgements and unknown rejection codes retain the pending report. The journal retains the last receipt; task history remains in the existing Broker state/audit store.

Broker validation is selected by stored task type, not caller schema. Native result shape, target, operation and platform output hash must match. Existing terminal task outcomes cannot be flipped. The existing audit has a 1000-event retention boundary: when matching evidence is absent, return UNVERIFIABLE instead of claiming a verified duplicate. No SQLite schema change is introduced.

## Bounds
Probe: fixed current Node executable, no shell/caller args, no NODE_OPTIONS/NODE_PATH preloads; 5 seconds and 16 KiB per output stream. Transport: redirects refused, response 128 KiB, 10-second request/body timeout. Resident polling uses bounded backoff. Disabled, locked and needs-human owner states are preserved.

## Evidence / rollback
See ../evidence/1207-windows-native-worker.md. Local Windows software tests use temporary keys/state and ephemeral loopback listeners. They prove the native process/transport integration, not production identity reuse or a full PC reboot. Stop only the candidate process and keep its journal when reverting candidate code. Existing fleet enrollment and production paths remain unchanged.
