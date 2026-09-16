# Issue 779 installation rollout — 2026-09-16

## Verified software and installation preparation

- PR #782 merged as `9dff5c1e1e93769394605fd0f28d69ceabaaf293`.
- PR CI 35074862180 and Android build 35074862036 passed.
- Exact merged commit main CI 35075099970 passed. Main Android build job 104725523676 passed, including release unit tests and installation certificate configuration.
- Local Next production build of an archive of that exact commit passed. Existing dynamic filesystem tracing warning remains; it is not an enrollment acceptance result.
- Explicit owner approval is in `779-installation-authorization.json`. Protected private key and certificate were created outside the repository. Only the public certificate is tracked and bundled.
- Public certificate SHA-256: `5F:21:9E:90:01:A0:57:BD:D6:B6:83:B3:A9:33:1B:D2:E3:6B:2E:4D:97:8B:F0:24:3B:FB:98:89:D5:7D:2C:D5`.
- Bounded ZBook runtime started from the exact merged commit, expiring at 2026-09-16T09:28:15Z. Runtime authorization and sanitized observations are stored locally under `tmp/physical-remote-tools/779-*.json`.
- Broker 8787, Gateway 8790 and dashboard 3000 listen only on loopback. Worker TLS ingress 8792 listens only on the configured private LAN address.
- HTTPS request using the public certificate and hostname verification succeeded; attempting the admin state route through Worker ingress returned 404 as intended.
- Registration window accepts up to 100 individually issued grants. Each fresh grant lasts at most 30 minutes and cannot outlive the open window. Existing automated integration test covers 100 distinct identities and rejection of the 101st; this is not a physical 100-device test.

## Physical observations and blockers

- Connected ZTE A202ZT still runs Worker 0.4.1 / code 14. Accessibility is enabled. No application data was cleared and no replacement signing key was created.
- Android Wi-Fi is on the same private subnet as ZBook. No ADB reverse forwarding is installed.
- Android TCP connection to Worker ingress timed out. Windows has an explicit inbound TCP block for `C:\Program Files\nodejs\node.exe` on Private/Public profiles; current Wi-Fi profile is Public. Local TLS succeeds, so changing app trust does not resolve this network block.
- Firewall permission changes have NOT been approved or performed. A narrowly scoped rule change requires its own Human Gate; do not disable the firewall or allow arbitrary Node ports/public access.
- Existing Mac signing job 104726026614 is queued. The preceding main build's signing job is also queued. Mac runner availability is not proven. The public signed APK asset remains the September 14 v0.4.1 artifact (SHA-256 `cfe4ea32e0bf333d9f485bbaeb7d7770ad6f2e798a51cf0c90bfb907242e3623`).
- Do not tell the owner that downloading the stable link currently provides the configured update until the signing job publishes it and its digest/provenance is checked.
- Real launch enrollment, signed Android heartbeat and reopen-without-reenrollment are **NOT VERIFIED**. Fleet requirements remain PARTIAL.

## Durable continuation

1. Restore the existing Mac signing runner; reuse its existing APK signer. Watch the #782 main Android workflow, then verify the stable signed APK belongs to this installation build. Older queued builds must not be mistaken for the configured APK.
2. Obtain a separate, precise owner approval for the Windows LAN-only Worker ingress firewall exception. Prepare a reversible change limited to the existing Node executable, private host address, TCP 8792 and home LAN source subnet; preserve blocking of other traffic. No router forwarding, Funnel or public Broker/Gateway.
3. Within valid task authorization, install the verified signed APK with `adb install -r`; preserve identity, app data and accessibility. Open the app and verify registration plus signed heartbeat over actual Wi-Fi.
4. Reopen the app and verify unchanged device identity and no additional grant consumption. Add another actual device when available; never promote simulated capacity results to physical fleet acceptance.
5. Record physical evidence and update the ledger only after passing. The current temporary runtime stops at the recorded expiry; this is not permanent startup/recovery acceptance.

Common installation URL (publication of this update is pending): https://github.com/haji84/AI-/releases/download/jarvis-worker-latest/jarvis-worker.apk

Owner enrollment UI during the bounded runtime: https://haji.tail93987e.ts.net/jarvis/enroll

Rollback: stop this bounded runtime/ingress, retain the protected credentials and existing device data, and use the previous verified release. No deletion, uninstall, firewall modification or OS-wide CA installation was performed.
