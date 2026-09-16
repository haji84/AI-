# JARVIS fixed Android enrollment pairing window

Parent: #681 P4  
Issue: #701

## Goal

Use one stable Android enrollment URL without turning that URL into a permanent credential. The stable URL only mints a fresh short-lived, single-device enrollment grant while an owner-authenticated in-memory pairing window is open.

## Flow

1. The authenticated owner opens a pairing window from `/jarvis/enroll`.
2. The Broker stores the window only in process memory with an expiry and issuance cap.
3. Devices repeatedly open the same fixed `/enroll` URL.
4. Each accepted open reserves one issuance slot before asynchronous work, creates a fresh `quick` enrollment token with `maxDevices=1`, converts it to the existing opaque grant, and renders the existing one-tap enrollment page.
5. Worker enrollment continues through the existing grant resolution, signed worker identity and fleet numbering path.
6. Closing, expiry, exhaustion or Broker restart makes the fixed route fail closed for new grants.

## Bounds

- pairing-window duration: 1 minute minimum, 1 hour maximum
- pairing-window issuance cap: 1 to 100
- per-open enrollment grant: at most 10 minutes
- per-open enrollment capacity: exactly one device
- the per-open grant TTL is additionally shortened to the remaining pairing-window lifetime
- portal rate limiting remains in front of the Broker when the optional portal process is used

A reserved issuance is intentionally not refunded if later token/page generation fails. This slightly reduces remaining capacity but prevents a failure/retry race from exceeding the owner-approved issuance cap.

## Restart behavior

Pairing-window state is deliberately not persisted. A new Broker process constructs a closed `JarvisEnrollmentPairingWindow`, so Broker restart closes registration even though durable fleet/task state is restored from SQLite. The fixed URL therefore does not become a restart-surviving bearer credential.

Already issued grants remain governed by their own short expiry and one-device enrollment token. Restart also clears the Broker's in-memory opaque grant map, so those grant URLs fail closed after Broker restart.

## Fixed portal

The supervised enrollment portal remains isolated on its dedicated default port 8791 and remains loopback-only unless LAN exposure is explicitly enabled. It no longer carries `JARVIS_ENROLLMENT_PORTAL_KEY`, the owner token, or any other permanent enrollment bearer in the URL. `/enroll` simply proxies the Broker's pairing-window-gated `/enroll` route. This keeps the stable URL stable while authorization lives in the Broker's bounded owner-open window.

## Owner API

The existing owner-authenticated dashboard proxy controls:

- status: `GET /api/jarvis/admin/enrollment-window`
- open: `POST /api/jarvis/admin/enrollment-window` with `action=open`
- close: `POST /api/jarvis/admin/enrollment-window` with `action=close`

The dashboard never places the owner token or raw enrollment token into the fixed URL.

## Evidence boundary

This change is CODE/UNIT/INTEGRATION evidence only. It does not claim that a real Android has completed enrollment through the fixed URL, that Device Owner QR provisioning works on a specific handset, or that 100 physical devices have been enrolled. Those remain P4/P9 physical evidence gates.
