# #1662 network mobility incident and local service recovery

Parent Goal: #1219/#681. Nubia remains owner-deferred.

## Native baseline
Owner-supplied sanitized native receipts, not an independent rerun:
- 2026-10-05T00:19:29.1463605Z: configured old runtime 6f41ee2ede5d761dbcd5efe258362126f4da1079; configured private IP not assigned/usable; same configured worker origin. All four ports absent; task Ready.
- Subsequent receipt: active Wi-Fi has one usable private IPv4 and zero subnet matches with configured IP. Existing certificate valid and covers configured IP; covers zero current usable private addresses. No raw addresses, interface names or private keys collected.

The earlier latest-main refresh48b6fb9 failed health verification. Pointers reverted but full service recovery was not verified. Source shows private ingress retry exhaustion shuts down the whole local stack. Restoring the former LAN is not a permanent mobility solution.

## Minimal recovery change
Keep Broker, Gateway and loopback Dashboard independent of private ingress retry exhaustion. If its configured address is absent, that child waits without process retries. Poll availability every five seconds; a genuine absent->present transition permits a new bounded launch budget. Address loss stops only that child, with no duplicate launch if stop fails. Existing exact bind, certificate/key, URL, task, DACL, node identity, fleet/database and security validation remain unchanged.

Regression process fixtures establish RED: CI37247946866, private ingress started despite absent address; private retry exhaustion caused local Broker ECONNREFUSED. Core failure policy remains tested. Fixtures accelerate backoff scheduling only and do not claim native TLS/mobility evidence.

## Remaining acceptance
This patch is local survival and existing-address recovery, NOT full cross-subnet mobility. No new certificate, automatic IP substitution, wildcard/plaintext bind or credential transfer is authorized by this patch. A secure moving-node transport must reuse authenticated private infrastructure and node identity, preserve TLS/nonce/fencing/privacy, rediscover valid peers/endpoints and reconcile state. Existing Tailnet dashboard alone is not proof of Worker routes or PC peer transport.

Latest-main native activation, actual moved-network task/return, offline/reconnect/failover/rebalance, peer state wiring and Nubia acceptance remain unverified. GORIQ and Stage C remain incomplete. Physical repair requires an available native execution capability; cloud CI does not substitute for it.

## Independent review correction
Review of a666f654 identified premature child ownership release on SIGTERM delivery or kill(false). Exact-source deterministic replay reproduced two launches with no confirmed exit. Controller now retains the child through exit/close, absorbs pending kill errors, waits after a successful signal, and retries a failed stop without duplicating a live child. Tests cover false/error kill, delayed successful exit and thrown failure. Fresh CI and re-review are required before merge.

## Merged local-survival validation and stopped activation
PR1702 final dd2fe2c73d3f5f3c64200445ec7932d102489b9a passed independent re-review and CI37248714065: 2166 tests, 2161 PASS, 5 platform SKIP, zero failures; P8 332 PASS; Windows byte fixtures PASS. Merged5b65821011258127543757657bec840d3c10f7cf: exact main CI37248930336 and Production Sync37249027176 both SUCCESS. This does not establish ZBook activation or cross-subnet reconnect.

PR1704 regression-only45b3f180e7e91279344db80d84f96314fc1d466e / CI37249584382 established OFFLINE_CORE_ACTIVATION_REJECTED: existing refresh could not activate healthy local cores when its configured LAN address was absent. Guarded stopped activation admits only task Ready with unchanged task XML and successful listener/process inventory excluding installation orphans, other release processes and hidden Node commands. It preserves all six schema/identity/fleet/Android tasks/PC tasks/Compass digests. Actual Broker revision, Gateway and Dashboard health plus owned service tree are required; address-present still requires all four ports. Confirmed absent address yields explicit coreServicesReady=true/privateIngressReady=false/activationState=network-waiting, never full service recovery or mobile transport PASS.

Independent review of1bb49c5 identified an outside-tree orphan race. Corrected c95147e5adc6a67383fc22f2ebe86b1f8dd9ed02 rejects outside installation processes during active health verification, permits only proven same-owner launcher ancestors, and adds actual AST tree fixtures. Independent re-review cleared that code. The same stopped/readiness fixtures run with Linux pwsh and Windows PowerShell, alongside existing real Windows Owner/DACL/atomic-pointer fixtures. Final exact-head CI and native execution remain required.

On failed activation from a stopped baseline, restore protected pointer bytes and verify unchanged state and stopped inventory without starting the old task. baselineRestored is separate from serviceRecoveryVerified. No DB restore, new address/certificate, TLS bypass, wildcard listener, firewall change, task re-registration, DACL mutation or credential grant is part of this repair.
