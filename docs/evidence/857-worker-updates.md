# #857 Worker update evidence

2026-09-17. Parent#681; PR858. Software evidence only.

## Observed failure

- Owner photograph shows Worker0.4.2 with Accessibility enabled and remote UI disabled.
- Stable release asset last updated2026-09-16T09:05:32Z; MacBook signer offline;
  Worker0.4.3 signing job104942660892 queued. No new APK was published.
- Certificate-verified HTTPS request to the installation's private
  `/downloads/jarvis-worker.apk` returns404. UpdateManager previously used that
  path; the ingress intentionally permits signed Worker POST routes only.
- Activity discarded update-check exceptions; background failure aborted its
  remaining task poll loop. These are code findings, not a device update PASS.

## Verification

- Local973 Node tests passed, including actual remote inventory version and
  capability behavior. TypeScript, full ESLint and production Next build passed.
- Android unit tests added: allowlisted HTTPS redirects, wrong package/signer,
  extra signer, equal/older version, clock rollback and hourly retry boundary.
  Android build/test outcome is recorded in PR CI; do not infer a physical PASS.
- No ingress allowlist or APK permission changes. Credentials are never attached
  to the public release download. Existing signer must match exactly.

## Pending

Signed0.4.4 release, ordinary-device installer consent, managed-device automatic
upgrade, retained UUID/keys, reconnect, real screen/control, offline recovery,
download interruption and install failure recovery all require actual hardware.
OPS-013 remains PARTIAL. PR856's approval does not authorize PR858 deployment.
Mac signing recovery is required; no replacement signing key may be generated.

Rollback: retain current production release and app data; installer rejects
binary downgrades. Recover APK regressions via same-key higher-version build.
