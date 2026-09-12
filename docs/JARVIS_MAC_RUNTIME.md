# JARVIS Mac resident runtime

This runtime keeps the local JARVIS Broker and Remote Gateway alive on an owner-controlled Mac without exposing raw ADB or loopback ports to the Internet.

## One-time local setup

1. Pull `main` on the Mac.
2. Run `bash scripts/jarvis-mac-resident.sh` once. It creates `~/Library/Application Support/JARVIS/jarvis.env` with mode 600.
3. Fill `JARVIS_OWNER_TOKEN` and `JARVIS_REMOTE_GATEWAY_TOKEN` with long random values. Add authorized ADB serials to `JARVIS_REMOTE_ALLOWED_SERIALS` when a device is attached and approved.
4. Run `bash scripts/jarvis-mac-install-launchagent.sh` to install the launch agent.
5. Inspect `~/Library/Application Support/JARVIS/status.json` for local health.

## Hosted dashboard connection

The Vercel dashboard requires HTTPS endpoints that securely reach the Mac services. Do not expose ports 8787, 8790, or the ADB server directly to the public Internet.

Set these Vercel Production variables only after authenticated encrypted ingress exists:

- `JARVIS_BROKER_URL` = HTTPS Broker ingress
- `JARVIS_OWNER_TOKEN` = same value as the Mac
- `JARVIS_REMOTE_GATEWAY_URL` = HTTPS Remote Gateway ingress
- `JARVIS_REMOTE_GATEWAY_TOKEN` = same value as the Mac

The Broker should also receive `JARVIS_PUBLIC_BROKER_URL` so enrollment links point at the secure public Broker URL.

No paid service is required by this runtime itself. External tunnel/account setup remains an explicit owner action and must use an authenticated encrypted transport.
