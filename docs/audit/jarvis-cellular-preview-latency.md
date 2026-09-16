# Cellular Remote Assist stale image / latency — #721

Parent #681. Actual path: iPhone 13 Pro on 4G → private Tailscale HTTPS → Windows ZBook → authenticated Remote Gateway → USB nubia S 5G A403ZT, Android 15, 1080×2400.

## Observed failure

The owner reported that a tap opened Settings on the physical Android while the browser still showed an older launcher frame and substantial lag. The supplied screenshot displayed capture time 11:48:06. The server audit separately recorded a tap at 02:48:20Z and successful screenshot at 02:48:21Z. A successful gateway response did not prove that the owner had received/displayed that frame.

Code inspection found session-start observation defaulted OFF, screenshot requests from input/manual/periodic paths could overlap without ordered publication, and full-resolution base64 PNG was transferred for every frame. Network delivery or overlapping responses can leave the visible image behind the physical device. The precise browser response ordering was not captured, so that part of the diagnosis remains a supported failure mode rather than a proven trace.

## Change

- Start periodic observation with the Remote Assist session.
- Coalesce overlapping screenshot requests into one active capture and at most one trailing capture.
- Discard results from ended/replaced sessions; reject older captured timestamps.
- Bound client remote requests to 20 seconds and display updating/automatic-update state.
- Explicit `preview: true` requests receive JPEG quality 55 at the original dimensions. Native touch coordinates are unchanged. Default screenshot and recorder paths retain lossless PNG.
- Bound preview input bytes/pixels. Authentication, capability, serial allowlist and audit remain enforced.

## Verification and limits

- Four new regression tests cover preview format/dimensions/invalid input, request coalescing, stale-context disposal and failure recovery; focused console tests also pass.
- Local full suite: 756/756 PASS. Lint and production build PASS before the final client timeout insertion; exact PR CI validates the final revision.
- Actual launcher PNG: 1,904,994 bytes → JPEG 145,409 bytes (92% smaller), encoding 47ms on this ZBook. This is a measured sample, not a universal reduction guarantee.
- Updated authenticated local API → physical Android preview: 67,807 bytes, 429ms for the Settings screen sample. Owner login 303, unauthenticated request 401, Home command 200, ended session 409.
- Owner cellular browser retest is pending. This remains periodic screenshots (2-second tick), not low-latency video streaming. Android backhaul is still USB; Wi-Fi-only operation is not proven.
- Physical screenshots and credentials are not committed. Temporary services retain the original approved expiry 2026-09-16T03:39:35Z; restart did not extend it.

Rollback: revert this issue's commits; no schema, credential storage or permission change is part of the product patch.
