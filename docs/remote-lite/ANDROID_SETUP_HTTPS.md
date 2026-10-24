# Android HTTPS enrollment design

Issue #1831, continuation from `dd1790f2`. This step connects the existing device proof protocol to the normal Android setup screen. The owner requested autonomous completion; ordinary design and implementation choices are made here within that scope.

## Behavior

A `goriqremote://enroll?server=<encoded HTTPS origin>&invite=<48 lowercase hex>` link opens a preview in the app. It never submits on launch. The person sees the exact server origin and explicitly chooses registration. The app generates/reuses its independent AndroidKeyStore identity, submits the enrollment proof over system-validated HTTPS, discards the invite, and persists only the origin and pending receipt. The complete key fingerprint is visible for owner comparison. Approval is confirmed by a fresh signed discovery request; absence of a pending control session is still a successful registration check. A new origin cannot replace an existing registration silently.

The normal release requires INTERNET for this explicitly requested function. Prior task-scoped approval of device credentials and OS permissions applies to user-triggered Android enrollment; no production credential, external account, signing key or public resource is created by development. No remote screen/input session starts from registration or an incoming link.

## Boundaries

An unsuccessful or uncertain request is never automatically repeated. After the owner verifies that the old request expired without registration, a new same-origin invitation can be submitted through an explicit local confirmation dialog. The key, fingerprint and previous receipt IDs remain intact. Approved registrations cannot use this recovery route; concurrent requests and stale approval snapshots are refused.

`EnrollmentLink` validates a maximum 2048-character invitation and an HTTPS origin with no credentials, path, query or fragment. Unknown/duplicate parameters fail. `HttpsJsonTransport` uses standard certificate and hostname validation, disables redirects/cache, permits only the existing fixed device endpoint paths, bounds request/response bytes to 96 KiB, and uses 5-second connect/read timeouts. It never falls back to HTTP. `CoordinatorExchange` owns JSON protocol mapping and sanitized refusal codes; it is reused by release and VM diagnostics. UI persistence never contains the invite, private key or viewer token. User-visible errors do not echo raw responses.

## Verification

JVM tests cover origin/link validation, genuine local TLS requests, untrusted certificates, redirect refusal, body limits, and endpoint allowlisting. Android 15 VM uses an ephemeral test certificate generated into debug-only resources. The fixture binds only loopback and proxies to the existing coordinator. The normal setup screen performs registration over HTTPS, fixture owner approval is explicit in the harness, and the existing signed status/capture/tap/revocation smoke continues through the shared production exchange. Release inspection must reject debug CA trust, cleartext and debug activity while requiring INTERNET.

This step does not supply public service operation, production owner login, native WebRTC media, distribution signatures, Android 9/10 capture, physical acceptance, or universal unattended restart. Those remain requirements of the parent goal. Rollback reverts this step's commits; no deployed or external state is changed. Local app enrollment state must be retained rather than silently deleted.
