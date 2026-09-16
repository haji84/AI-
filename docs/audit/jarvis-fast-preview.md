# Android fast preview measurement — #728

Parent #681. Owner reported continued temporal mismatch after #724. Acceptance remains open.

## Measurement and change

On the USB-connected nubia S 5G (A403ZT, Android 15), direct PNG capture took 1,218/1,198ms; raw capture took 663/654ms. The previous authenticated localhost preview took 1,258–1,288ms after warmup, transferring approximately 145KB JPEG per frame.

The opt-in preview now captures bounded raw pixels over local ADB, converts them on ZBook, and sends a JPEG with its longest side at most 1,280 pixels. Original physical dimensions accompany the preview. Pointer geometry uses those dimensions and excludes object-fit letterbox margins. Default lossless screenshots/recordings retain PNG. Owner/session checks, gateway bearer authentication and the serial allowlist still guard the same endpoint.

Only exact packed RGBA/RGBX frames with supported 12/16-byte headers and known colour space are accepted; malformed/unsupported frames fall back to bounded PNG capture. Both-path failure stays an error. Raw data never traverses the owner cellular connection. Gateway output is bounded by the existing 16MiB process buffer; raw conversion accepts at most four million pixels. Capture subprocess timeouts remain bounded.

Format reference: [AOSP screencap implementation](https://android.googlesource.com/platform/frameworks/base/+/4a2501278c17/cmds/screencap/screencap.cpp). This implementation supports a subset and does not claim universal Android format support.

## Verification

- Focused preview/parser/fallback/native-coordinate tests: 14 PASS.
- Full suite: 763/763 PASS. Lint, TypeScript and production build PASS.
- Authenticated physical preview after restart: 62,438 bytes, 681ms. Five additional local samples: 669, 705, 671, 695, 687ms (median 687ms).
- Native 1080×2400 frame displayed at 576×1280; actual JPEG visually inspected successfully.
- Physical authenticated Home command200, unauthenticated request401, ended-session request409.
- This is local API latency, NOT iPhone glass-to-glass latency. Owner cellular retest is pending. Screenshot refresh is still not video streaming.
- Test runtime was rebuilt with the existing memory-only owner code and original expiry2026-09-16T03:39:35Z. No extension or credential persistence.

RA-001/007/009 remain PARTIAL: PC and other-platform physical evidence, cellular usability and broader product acceptance are not implied by these results.

Rollback: revert #728 changes and rebuild the explicitly authorized local test runtime. No migration, stored credential, OS permission or public ingress change.
