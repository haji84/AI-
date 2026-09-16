# Existing-key APK signing on Windows

APK signing is not Mac-specific. Android requires the same signing identity to
update an existing installation without uninstalling or losing local identity.
The old Mac workflow stores the existing files at:

- `~/Library/Application Support/JARVIS/jarvis-worker-signing.jks`
- `~/Library/Application Support/JARVIS/jarvis-worker-signing.pass`

Copy those files through an owner-approved private channel to an owner-only
Windows directory outside this repository. Never paste/upload them into chat,
commit them, create a replacement key, or use a debug key. If the only copy is on
an unavailable Mac, same-identity signing remains blocked until it is recovered.
The APK's public signing certificate cannot reconstruct the private key.

Windows needs Java and Android SDK Build Tools (`apksigner.bat`, `aapt.exe`).
Use `scripts/sign-jarvis-worker-windows.ps1` with explicit input paths, a trusted
baseline APK from an existing device, and the expected new version code. Run
without `-Sign` first. The helper checks package/version and baseline signature;
with `-Sign` it uses the existing keystore and password file, verifies the full
signer set against the baseline, and refuses overwrites/downgrades. It does not
publish, modify device permissions, generate keys, or uninstall anything.

Release automation migration is a separate reviewed workflow change after the
existing key is available and the helper is verified with that key. Prevent old
queued Mac jobs from replacing a newer stable asset before enabling Windows
publication. Exact main CI and task-scoped release approval are still required.

This helper has parser validation only until a real existing key and SDK are
available. It is not evidence that a Windows-signed release has been produced.
