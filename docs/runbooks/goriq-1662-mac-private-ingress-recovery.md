# #1662 Mac private ingress recovery

This is a continuation of #1219 through #1662. It records the activation plan and owner-approved implementation, not physical acceptance evidence. Nubia remains deferred. No production setting is changed by this document.

## Verified failure and baseline

Read-only native workflow [37278276564](https://github.com/haji84/AI-/actions/runs/37278276564), from exact main `b09dfc63c8400e043eba46b3762834c2f63de01c`, completed on both existing owner runners. The probe reports `diagnosticOnly: true` and `transportAcceptanceVerified: false`.

| Surface | ZBook, 2026-10-05 07:32 UTC | Mac, 2026-10-05 07:33 UTC |
| --- | --- | --- |
| Tailscale | Running, online Mac peer observed | Running, online Windows peer observed |
| Dashboard loopback 3000 | HTTP 200, health matched | Connection refused |
| Broker loopback 8787 | Healthy, revision `a49c458d69a28c0266be8fcad5b26253e5ed8d75` | Healthy, revision `b09dfc63c8400e043eba46b3762834c2f63de01c` |
| Gateway loopback 8790 | HTTP 200, health matched | HTTP 200, expected health predicate did not match |
| Own private HTTPS | HTTP 200, dashboard health matched | Connection refused |
| Serve configuration | Private dashboard route present | Expected dashboard route absent |

The Mac lacks a usable private dashboard endpoint. Its Broker is running. The Gateway observation does **not** establish that the Gateway stopped. Both original private discovery requests failed with `connection-refused` before HTTP identity proof or execution. Existing enrollment/key checks passed; reenrollment is not the repair.

Detailed evidence is retained in [#1662 comment 5990235862](https://github.com/haji84/AI-/issues/1662#issuecomment-5990235862). Native local signed task evidence [37266790236](https://github.com/haji84/AI-/actions/runs/37266790236) remains historical local execution evidence, not cross-device acceptance.

## Requested activation scope

Only the existing owner Mac (`macbook`, macOS ARM64) is the new activation target:

1. Install an owner LaunchAgent for the **dashboard only**, from an immutable release of exact current main with successful main CI.
2. Bind Next to `127.0.0.1:3000`, using the existing protected owner environment and persistent native state. Set the native private-transport environment expected by the existing implementation.
3. Configure the existing Tailscale account's **tailnet-private HTTPS 443** root route to `http://127.0.0.1:3000` using `tailscale serve --bg --yes --https=443 http://127.0.0.1:3000` only after the scoped owner approval and baseline guards pass.

The managed label is `com.aicompany.jarvis-private-dashboard`. A preexisting label or plist with that name is a conflict, not permission to replace it. Existing Broker/Gateway launch services, owner tokens, device keys, database records, roles, and public endpoints are preserved. No Funnel, wildcard listener, firewall change, raw Broker/Gateway proxy, new account, credential disclosure, or expanded token scope is part of this operation.

The TLS endpoint is served by the existing Tailscale installation. If enabling account HTTPS, changing tailnet ACLs, interactive login, or administrator permission is needed, record that blocker and return to its separate Human Gate; do not silently make those changes.

## Required plan and baseline checks

Before any activation, a bounded native plan must establish all of the following:

- Exact source is current `main`, protected main CI succeeded, checkout is clean, and staged build provenance matches that revision. Do not spoof the source context or ignore a failed source/approval guard.
- The process is the existing owner account, not root. Target directory ancestors, environment file, native identity/key, database, release, and LaunchAgent surfaces are owned/protected appropriately and are not symlinks or reparse substitutes. Do not print their contents or private paths in public logs.
- Existing Broker health and revision are retained as a baseline. The separately verified existing Mac Production Sync must already have produced a healthy Broker at the final current-main revision before this dashboard-only operation begins. If it has not, stop and diagnose that existing activation path; this repair does not restart, reinstall, or replace Broker/Gateway. Read the existing protected environment inside the owner process; never copy secret values into a workflow input, plist, repository, or diagnostic artifact.
- The dashboard reuses the **actual existing absolute database and identity paths**. Do not infer a replacement path, create a new database, or generate a key when a required existing path is absent. Compare the enrollment/state baseline (Android 38, existing PC identities, schema, and stable identity digest) through the existing verifier.
- Require the existing nonempty `JARVIS_OWNER_TOKEN` and existing `JARVIS_OWNER_SECRET` or `AI_COMPANY_OWNER_SECRET` inside the protected owner process. Do not create/reveal a secret to satisfy a missing prerequisite. Pin dashboard API clients to `JARVIS_BROKER_URL=http://127.0.0.1:8787` and `JARVIS_REMOTE_GATEWAY_URL=http://127.0.0.1:8790`; the listener `*_HOST` settings alone do not configure those clients. Preserve any required existing remote-gateway token/allowed-device policy without expanding it.
- The release is an immutable native build with pinned project Node/pnpm versions and locked dependencies. Do not run from a mutable Actions checkout or link runtime dependencies back into that checkout.
- `127.0.0.1:3000` has no listener and the new dashboard LaunchAgent is absent. Do not stop or replace an unknown listener to obtain the port.
- Tailscale is Running and its own existing MagicDNS name is present. Read `serve status --json` and the installed CLI's full all-services configuration; `unconfigured` alone does not prove an empty configuration, and status JSON can omit Services. Require an actually empty configuration before creating the root route. Preserve and stop on any unrelated TCP/Web/Foreground/Services/Funnel configuration or unsupported inspection command.
- Save a protected, owner-only baseline and scoped recovery receipt before activation. Include absent/present state and contents/metadata for every new managed file, immutable release provenance, full private Serve baseline, Broker health/revision, and stable state-verifier results. Public evidence contains sanitized classifications only.

The current Mac Broker revision and ZBook revision differ because the read-only diagnostic change advanced main/Mac, while Windows activation was deliberately retained. The cross-device client requires exact source compatibility. Record fresh exact-revision Mac Broker health after the existing verified Production Sync and use the existing owner-approved guarded Windows refresh to align ZBook before acceptance. The dashboard-only repair does not authorize a new Mac Broker refresh mechanism. Any failure of those existing activation paths is recorded and repaired separately within this same Goal/Evidence chain; do not weaken revision checks or substitute the mutable-checkout Mac installer.

## Activation and verification order

1. Build and verify the immutable release before stopping or starting any native service. Do not source native secrets into the build. A failed build leaves the old runtime intact.
2. Start only the new dashboard LaunchAgent. Reuse the existing service specification's Next command with hostname `127.0.0.1` and port `3000`. Do not start `jarvis:remote:host`, which would also supervise Broker/Gateway and can duplicate existing healthy services.
3. The dashboard entry loads the existing protected owner environment at runtime, preserves persistent state paths, sets exact `GORIQ_RUNTIME_REVISION`, `JARVIS_PRIVATE_WORKER_INGRESS_ENABLED=1`, `JARVIS_BROKER_HOST=127.0.0.1`, `JARVIS_REMOTE_GATEWAY_HOST=127.0.0.1`, and `JARVIS_DASHBOARD_PORT=3000`. Native execution must satisfy the existing non-Vercel and local registered identity guards. Do not bypass a guard with fabricated proof.
4. Within a bounded deadline, verify loopback dashboard health and unchanged Broker/state. Stop if they fail. Confirm the listener is loopback only.
5. Recheck that the Serve baseline is still empty, then execute only the scoped private HTTPS command. Validate the resulting configuration with the existing strict `inspectPrivateIngress` predicate and verify own private `/api/health` without disabling TLS verification.
6. Test a Windows-to-Mac private heartbeat over the actual discovered endpoint. Require the existing registered key, nonce, timestamp, body digest, and exact runtime revision checks. HTTP 200 alone is insufficient.
7. Run the existing bounded cross-device task client once. Verify assignment, native filesystem execution, signed result acceptance, epoch fencing, existing records, and evidence persistence. Preserve pending leases and keys on failure.
8. Continue actual offline/reconnect/failover/rebalance acceptance with the previous receipts carried forward. Neither this plan nor an own-endpoint health result completes Stage C.

The executable repair bounds subprocesses and health polling, verifies sealed release inventories and artifact identity before activation and resident startup, and rechecks current-main CI and stable enrollment at mutation boundaries. Interrupted staging is retained in an owner-protected quarantine; verified releases are reused. A same-revision healthy owned activation is verified without reapplying it. Android heartbeat timestamps, status and telemetry are permitted to change; membership, enrollment, identity, authority and schema are preserved. Unexpected data is a failed prerequisite. Public output must exclude private DNS/IP addresses, owner identifiers, subprocess error bodies, environment values, Serve configuration, and identity secrets.

## Scoped recovery

- Before every dashboard unload, inspect all live Serve and Services configuration, including when this operation never attempted route creation. If another route appeared, retain the dependency-consistent service and report recovery blocked. Otherwise a dashboard failure unloads only the new label and retains its managed files in the protected recovery directory. Do not restart healthy Broker/Gateway or delete native state.
- After route creation, first compare current Serve configuration with the exact configuration produced by this operation. If it still matches, disable only this operation's HTTPS 443 route with the original flags (`tailscale serve --bg --yes --https=443 http://127.0.0.1:3000 off`) and verify the previously empty baseline is restored. Never use `tailscale serve reset` or overwrite a concurrent/unrelated route.
- After verified route removal, also unload only the new dashboard label, verify its process exited and the originally absent 3000 listener is absent, and restore its managed files to the saved absent/present baseline. If route recovery is blocked by a concurrent change, do not leave a dependent route/service half-restored or claim success; retain the dependency-consistent state and report the exact recovery blocker for scoped intervention.
- If an unexpected concurrent route or service change is found, retain evidence and report recovery blocked instead of claiming restoration.
- Confirm Broker health/revision, existing state/schema/identity baseline, listener boundary, and affected configuration after recovery. Files/releases/backups needed for audit remain protected; no destructive cleanup is included.
- Record the attempt under #1662 with source, artifact identity, sanitized native receipts, failure stage, recovery results, and next repair target.

## Human Gate

The prior #1662 scope excludes **"port/firewall/TLS exposure changes"**. `AGENTS.md` also requires preserving approval scope and every existing Human Gate. This activation therefore needs specific owner approval before any new dashboard service, LaunchAgent, listener, or private ingress mutation; this plan is not that approval.

Requested approval: the Mac-only dashboard LaunchAgent and **private Tailscale HTTPS 443 to owner loopback 3000**, within the scope and recovery boundaries above, plus the existing guarded same-main native verification. The approval must be recorded with issuer, exact scope, source/artifact binding, and expiry before apply. No approval is fabricated from a workflow checkbox or this document.

The owner approved this exact Mac-only scope in [#1662 comment 5994510905](https://github.com/haji84/AI-/issues/1662#issuecomment-5994510905), from 2026-10-05 12:31:33.880 UTC through 2026-10-06 12:31:33.880 UTC. The owner-bound native workflow follows only the CI-triggered successful existing Production Sync (not its five-minute scheduled or push run) when public GitHub metadata proves its source is the exact merged follow-up PR #1715 commit and owner provenance matches. It also supports guarded manual plan/apply. Unrelated merge revisions and unsupported events are rejected; no new token or workflow permission is added. The machine-readable authorization binds the executable artifacts to that receipt and exact current main with successful CI. Approval expiry blocks new activation; it does not revoke an already verified resident service.

Status: diagnosis **PASS**; PR #1712 source/main CI and Production Sync **PASS**; native run [37318477396](https://github.com/haji84/AI-/actions/runs/37318477396) **FAIL at owner-environment before mutation**; follow-up PR #1715 adds fixed error classes and anonymous read-only path/ACL metadata under the same approved scope; Mac activation and cross-device task/offline/reconnect/failover/rebalance **BLOCKED pending proven owner-environment root-cause repair, transport recovery and fresh native evidence**. GORIQ and Stage C remain incomplete.

CLI semantics were checked against the [official Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve), including background persistence, the full-service inspection limitation, and disabling a route with its original flags. The native plan still checks the actually installed CLI version and supported flags before mutation.

## Approved missing-credential continuation

Diagnostic PR1715/main62ea236 produced actual native receipt37322842987: protected environment checks passed, nonempty owner-token presence predicate passed, but OWNER_SESSION_SECRET_MISSING stopped preparation before staging/service/Serve mutation. The separately owner-approved PR1716 operation initializes only the missing Mac session secret under receipt5996554289; see [bounded credential repair](goriq-1662-mac-owner-secret-gate.md). Its credential expiry2026-10-06T14:29:25.689Z does not renew dashboard expiry2026-10-06T12:31:33.880Z or Windows authority. The exact automatic callback is now PR1716 only. No native success or cross-device/StageC completion inferred from component tests or approval.
