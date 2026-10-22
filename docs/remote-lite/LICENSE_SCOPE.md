# Remote Lite licensing scope

Owner approval: 2026-10-23, Issue1831 / PR1832. The owner approved MIT licensing
of Remote Lite's original code, build/test scripts and related documentation,
and explicitly selected **haji84** for the copyright notice. The canonical
notice is [LICENSE-REMOTE-LITE.txt](../../LICENSE-REMOTE-LITE.txt).

## Included original material

- `apps/remote-lite-windows/`: manual Windows host, embedded browser code,
  MSI authoring, tests and build-only dependency declarations.
- `android/remote-lite/`: original manual Android code, resources, build files,
  test harnesses and documentation, with the third-party exclusions below.
- `src/remote-lite/`: manual protocol, coordinator, owner portal and adapters.
- `deploy/remote-lite/` and `docs/remote-lite/`: Remote Lite configuration examples
  and product/development documentation.
- Repository `scripts/remote-lite-*` and `tests/remote-lite-*` files only.

The notice itself is the licensing grant for this identified material. There is
no repository-wide MIT grant: GORIQ/JARVIS core, shared workflows, unrelated
scripts/tests, governance documents and other unlisted files are outside it.
GitHub visibility or a dependency reference does not relicense another work.

## Third-party material stays under its own terms

| Material | Treatment |
|---|---|
| `android/remote-lite/app/src/main/assets/notices/WEBRTC.md` and `WEBRTC_SDK_LICENSE.txt` | Preserve the upstream notices verbatim; excluded from the haji84 MIT grant |
| WebRTC Android SDK/native libraries | Original upstream/component licenses; no ownership claim or replacement by MIT |
| Go runtime | Original Go redistribution notice remains installed as `GO_LICENSE.txt` |
| goversioninfo1.5.0 / rsrc0.10.2 | Original MIT authors/notices; build-only, not bundled as tools in MSI |
| Android/Kotlin/build/test dependencies | Their own licenses; not relicensed by the original project's MIT notice |

This records the grant boundary, not a claim that every transitive dependency
or free-signing eligibility condition has been independently cleared. Dependency
and provider review remain part of final distribution acceptance.

## Package notices

The Android asset `notices/REMOTE_LITE_LICENSE.txt` is a byte-identical copy of
the canonical notice and is displayed before the existing WebRTC notices.
CI compares the notice extracted from the actual release APK with the canonical
file. Windows packages the same notice as `REMOTE_LITE_LICENSE.txt` alongside
the Go notice. The MSI VM checks its installed bytes during install/repair/
upgrade and checks removal of packaged notices on uninstall.

License approval is separate from SignPath application/contracts, publisher
identity, credentials/permissions, signing, public hosting and distribution.
No provider endorsement or signing certificate is claimed. Source rollback can
revert packaging changes; it does not retroactively withdraw MIT permissions
already granted to recipients.
