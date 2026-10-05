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
