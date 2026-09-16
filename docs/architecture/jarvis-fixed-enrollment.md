# JARVIS fixed enrollment portal

Parent: Issue #681 P4. Children: #702, #704.

## Goal

Provide one stable installation-scoped enrollment URL that can be reused on many existing Android devices. Opening the stable URL must never reuse a long-lived Broker enrollment token. Instead, each authorized open requests a fresh 30-minute, single-device `quick` enrollment from the existing loopback Broker and redirects to the existing one-tap page.

This is a software capability only. It is not physical enrollment evidence.

## Security boundary

The portal is a separate local service and fails closed.

- `JARVIS_ENROLLMENT_PORTAL_KEY` is a dedicated opaque portal credential and must be at least 32 characters. It is not the owner token and is never returned to the device as an enrollment token.
- Creating or rotating the real portal credential is a credential Human Gate. Repository code does not invent or install that secret.
- `JARVIS_OWNER_TOKEN` is used only by the local portal to call the existing owner-authenticated Broker admin enrollment endpoint.
- The Broker URL is forced to loopback. The portal cannot be configured to mint through a remote/public Broker.
- The portal binds to loopback by default. A LAN bind requires explicit `JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN=1` and still requires the opaque portal key.
- Public port forwarding, Funnel and a public Broker/Remote Gateway remain prohibited.
- The returned one-tap target must be HTTPS and must not contain URL credentials.
- Responses are `no-store` / `no-referrer`; failures never return the owner token, portal key or underlying enrollment token.
- Minting is bounded by per-client/global fixed-window limits and bounded client tracking.
- The opaque key is part of the URL path and must be treated as a credential by any proxy/access-log layer. Do not publish or log the full fixed URL.

## Fixed flow

1. Administrator performs the one-time Human Gate to provision a strong `JARVIS_ENROLLMENT_PORTAL_KEY` on the host.
2. Starting `pnpm jarvis:remote:host` automatically includes the portal under the same bounded supervisor when that key is present. If the key is absent, the portal stays disabled and the rest of JARVIS continues; the supervisor logs the missing portal credential explicitly.
3. The portal can also be started directly with `pnpm jarvis:enroll:portal` for focused operation/testing.
4. Stable URL format: `http(s)://<portal-host>:<portal-port>/enroll/<opaque-portal-key>`.
5. Each valid GET calls the loopback Broker `POST /api/jarvis/admin/enrollment` with:
   - `mode: quick`
   - `maxDevices: 1`
   - `ttlMs: 1800000`
6. The Broker returns its normal one-tap URL backed by a new bounded grant.
7. The portal validates that URL as HTTPS and returns a `303` redirect.
8. The existing Worker/deep-link flow performs enrollment and keeps the current per-device identity/signing behavior.

A fixed URL therefore stays stable while the actual enrollment authority is fresh and short-lived on every open.

## Configuration

Required to enable the portal:

- `JARVIS_ENROLLMENT_PORTAL_KEY`: dedicated opaque secret, at least 32 characters.
- `JARVIS_OWNER_TOKEN`: existing local Broker owner credential; already required by the remote host.

Optional:

- `JARVIS_BROKER_URL`: defaults to `http://127.0.0.1:8787`; loopback only.
- `JARVIS_ENROLLMENT_PORTAL_HOST`: defaults to `127.0.0.1`.
- `JARVIS_ENROLLMENT_PORTAL_PORT`: defaults to `8791`, deliberately separate from Remote Gateway `8790`.
- `JARVIS_ENROLLMENT_PORTAL_GROUP`: defaults to `fixed-url`.
- `JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN=1`: explicitly permits a non-loopback listener for the home LAN. This does not authorize router port forwarding or public ingress.

## Supervision and recovery

When configured, `jarvis-remote-host.mjs` adds `enrollment-portal` to the existing Broker / Remote Gateway / dashboard managed-process set. It therefore inherits the same bounded restart/backoff and host shutdown behavior. Credential absence does not masquerade as portal readiness: the service is omitted and a clear disabled message is emitted.

The portal is not required for already-enrolled workers to reconnect. Existing device identities and signed result paths remain separate from onboarding.

## Evidence boundary

The following are CODE/UNIT evidence once CI passes:

- fixed route policy
- fresh 30-minute single-device request generation
- exact portal-key comparison
- loopback Broker enforcement
- explicit LAN opt-in
- HTTPS redirect validation
- bounded rate limiting
- dedicated non-colliding default port
- optional bounded host supervision when explicitly credentialed

Still required before related P4 requirements can be VERIFIED:

- actual host credential provisioning
- real existing-device enrollment through the fixed URL
- reconnect/reboot evidence without re-enrollment
- staged fleet evidence
- Device Owner / reset-device QR evidence where supported

Do not promote PHYSICAL-dependent Requirement Ledger rows to VERIFIED from this software merge alone.
