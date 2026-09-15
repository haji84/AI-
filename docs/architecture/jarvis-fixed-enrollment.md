# JARVIS fixed enrollment portal

Parent: Issue #681 P4. Child: #702.

## Goal

Provide one stable installation-scoped enrollment URL that can be reused on many existing Android devices. Opening the stable URL must never reuse a long-lived Broker enrollment token. Instead, each authorized open requests a fresh 10-minute, single-device `quick` enrollment from the existing loopback Broker and redirects to the existing one-tap page.

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

## Fixed flow

1. Administrator performs the one-time Human Gate to provision a strong `JARVIS_ENROLLMENT_PORTAL_KEY` on the host.
2. Start the portal with `pnpm jarvis:enroll:portal`.
3. Stable URL format: `http(s)://<portal-host>:<portal-port>/enroll/<opaque-portal-key>`.
4. Each valid GET calls the loopback Broker `POST /api/jarvis/admin/enrollment` with:
   - `mode: quick`
   - `maxDevices: 1`
   - `ttlMs: 600000`
5. The Broker returns its normal one-tap URL backed by a new bounded grant.
6. The portal validates that URL as HTTPS and returns a `303` redirect.
7. The existing Worker/deep-link flow performs enrollment and keeps the current per-device identity/signing behavior.

A fixed URL therefore stays stable while the actual enrollment authority is fresh and short-lived on every open.

## Configuration

Required:

- `JARVIS_ENROLLMENT_PORTAL_KEY`: dedicated opaque secret, at least 32 characters.
- `JARVIS_OWNER_TOKEN`: existing local Broker owner credential.

Optional:

- `JARVIS_BROKER_URL`: defaults to `http://127.0.0.1:8787`; loopback only.
- `JARVIS_ENROLLMENT_PORTAL_HOST`: defaults to `127.0.0.1`.
- `JARVIS_ENROLLMENT_PORTAL_PORT`: defaults to `8790`.
- `JARVIS_ENROLLMENT_PORTAL_GROUP`: defaults to `fixed-url`.
- `JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN=1`: explicitly permits a non-loopback listener for the home LAN. This does not authorize router port forwarding or public ingress.

## Evidence boundary

The following are CODE/UNIT evidence once CI passes:

- fixed route policy
- fresh 10-minute single-device request generation
- exact portal-key comparison
- loopback Broker enforcement
- explicit LAN opt-in
- HTTPS redirect validation
- bounded rate limiting

Still required before related P4 requirements can be VERIFIED:

- actual host credential provisioning
- host startup integration
- real existing-device enrollment through the fixed URL
- reconnect/reboot evidence without re-enrollment
- staged fleet evidence
- Device Owner / reset-device QR evidence where supported

Do not promote PHYSICAL-dependent Requirement Ledger rows to VERIFIED from this software merge alone.
