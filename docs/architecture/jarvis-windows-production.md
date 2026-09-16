# Windows production handoff (#786)

Owner request: `検証用でなく本番用を出して`. This authorizes the production deployment task; credential persistence and startup account permissions still need their own approval. The owner explicitly chose unchanged Windows firewall rules. Do not run the abandoned #779 firewall proposal.

## Production design

- Use an archived, built release of the exact merged commit whose main CI passed; record its full SHA in `jarvis-release.json` and the local deployment authorization. Do not run a mutable development checkout as the production release.
- Preserve the existing Broker SQLite state (including worker identity records), teaching data and audit/recording paths. Stop the bounded trial gracefully before migrating; use SQLite's backup API or copy the complete quiescent database. Never clear app data or re-enroll to mask lost identity records.
- `jarvis-remote-host.mjs` supervises Broker, Gateway, Dashboard and explicitly enabled private Worker TLS ingress with bounded exponential backoff. Production has no trial shutdown timer. The registration window still expires normally; permanent runtime does not mean permanently open enrollment.
- Load `%LOCALAPPDATA%\JARVIS\production\config.dpapi` as the same Windows owner. DPAPI CurrentUser protects secrets at rest. Configuration is allowlisted, release-root/commit bound and pins management to loopback. It must never be placed in Git, APKs or logs. TLS uses the already provisioned certificate/key.
- The Windows task runs Node directly as the normal owner, Limited run level, on boot and logon, with no execution limit, battery continuation, bounded task restart and duplicate-instance prevention. Password logon supports networking; S4U and Interactive-only are not substitutes.
- Tailscale remains the existing private Serve route. No firewall, Funnel, router, billing or model-provider changes.

## Prepared installation, not an executed permission change

`scripts/install-jarvis-production-windows.ps1` defaults to PLAN ONLY. `-Apply` requires explicit credential/task approval and a matching, unexpired local authorization receipt (`scopeId: issue:786`, exact `commit`, `mainCi: success`, `ownerSid`, `credentialAndTaskApproval: true`, `expiresAt`). Installation approval expiry gates setup, not the lifetime of an already authorized production service.

Inputs are an absolute `ReleaseRoot`, a local non-secret `SettingsPath` with an `environment` map, and `AuthorizationPath`. The settings contain approved device serials, existing tool paths, preserved persistent state paths, `https://192.168.0.169:8792`, the private IP and certificate/key paths, and the stable signed APK URL. The installer validates all settings, refuses an existing configuration or task rather than silently rotating credentials, and refuses conflicting listeners. It never kills existing services automatically.

After separate approval, run as the same Windows owner with explicit elevation. Enter that account's Windows password in the local credential dialog (never chat or logs). The installer generates persistent owner/Broker/Gateway credentials, encrypts configuration and restricts its directory to owner and SYSTEM. The new owner login code is shown once locally. Existing sessions will need this new login; Worker signing identities are retained in the preserved Broker database.

If registration fails after configuration creation, inspect the error and preserve the encrypted configuration. Do not rerun by deleting it or creating different credentials. No automatic destructive rollback is performed.

## Acceptance and rollback

Check scheduled-task identity/action/settings, authenticated UI, two existing workers' signed reconnect, stable grant count on reopen, and deliberate child-process crash recovery. Then perform separately coordinated physical reboot/network recovery. A successful install or CI is not physical reboot/AC-loss evidence. BIOS and Windows-password gates cannot be bypassed.

Rollback stops/disables only this named task, stops its identified children, retains credentials and durable data, and restores the prior known-good release/configuration with a backup. Never revive an expired trial approval. Retain source DB until migration/reconnect is verified. Release and credential rotation require a new reviewed operation.

The #779 bounded trial expires 2026-09-16T09:28:15Z. Until production setup and physical validation actually pass, describe this as prepared production software, not an operational production release.

## Observed Windows gate (2026-09-16 09:31Z)

The local Windows test found and fixed trailing-newline handling in the DPAPI reader and inherited PowerShell module-path incompatibility. Windows PowerShell then refused the helper script with `UnauthorizedAccess` because effective script execution is restricted (all policy scopes are Undefined on this client). This is a real failed acceptance test, not a reason to skip or disable it. Linux CI does not prove the Windows DPAPI roundtrip.

Remaining explicit approval must cover: production credential generation/protected persistence, Limited owner boot/logon task registration, and a process-only RemoteSigned execution policy for the reviewed JARVIS setup and dedicated configuration-reader processes. No machine-wide or user-wide policy change, Unrestricted/Bypass setting, firewall change, or alternative privileged service account is proposed. The process policy option is not yet added or executed. A group policy, if subsequently configured, must remain authoritative.

Once approved, implement that exact process-scoped option, rerun the real Windows DPAPI regression and full CI, then merge, stage the exact main-CI-passing release and apply setup. Enter the Windows account password only in its local dialog. Do not merge/deploy while the physical Windows configuration test is failing. The trial has now stopped; restarting it requires a fresh authorized scope rather than editing its expiry.
