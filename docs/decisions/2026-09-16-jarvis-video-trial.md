# ADR: bounded authenticated Android H264 preview

Date: 2026-09-16. Issue #732, parent #681.

## Decision

Owner physical acceptance rejected screenshot polling after #729: perceived delay remains about3seconds despite localhost capture improvement. Add an optional60second H264 video trial using pinned scrcpy3.3.3 and browser WebCodecs. Existing screenshot mode is retained as an explicit fallback.

The server binary is obtained from the official Genymobile release and must match SHA256 `7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0`. The host configures `JARVIS_SCRCPY_SERVER_PATH`; the product does not silently download or trust arbitrary binaries. No binary is committed. scrcpy is Apache2.0: [upstream license](https://github.com/Genymobile/scrcpy/blob/v3.3.3/LICENSE).

## Trust and resource boundaries

Owner-authenticated POST includes a serial-bound Remote Assist session. The session is checked before connecting, every250ms and before forwarding each chunk. Existing gateway bearer authentication and device allowlist remain mandatory. Gateway opens only an ADB local forward to its device abstract socket; private HTTPS is the browser ingress. No Funnel/router forwarding/STUN/TURN/public video service is added.

Audio, clipboard and scrcpy control are disabled. Input continues through existing audited/manual session APIs. A video connection lasts at most60seconds, one per serial and four globally. Slow gateway readers exceeding256KiB queued bytes terminate. Browser packet parsing is bounded to4MiB and decoder queue over3 terminates rather than accumulating latency. Disconnect, page hiding, component teardown or ended session cancels transport. Original physical test harness expiry is unchanged.

Raw H264 packets carry pinned scrcpy12byte frame headers. Browser extracts SPS codec metadata, configures low-latency WebCodecs decoding and renders to canvas. Packet config is prepended to keyframes; unsupported browser/codec shows a visible failure. Native screen dimensions drive touch coordinates. Device rotation with a changed aspect ratio disables canvas input until the user returns to screenshot mode; no guessed coordinate mapping.

## Limits and acceptance

This is an explicitly bounded trial, not an unattended production stream or physical acceptance PASS. Reconnection after60seconds currently uses the UI. No audio, multi-video, Wi-Fi-only Android backhaul or universal Safari compatibility claim. Glass-to-glass latency must be measured/owner-confirmed; time to first network packet is not that latency.

References: [scrcpy3.3.3 protocol](https://github.com/Genymobile/scrcpy/blob/v3.3.3/doc/develop.md), [WebKit video WebCodecs support](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

Rollback: revert #732 and rebuild; owner can immediately select screenshot mode. No credential/schema/OS permission change.
