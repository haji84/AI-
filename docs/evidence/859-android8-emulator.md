# Android 8 remote-control regression verification (#859)

Date: 2026-09-18 JST. Evidence class: **INTEGRATION / emulator**, not PHYSICAL.
Result: the static-capture and single-view input regressions described below are
fixed and exercised on Android 8. This is not a product-completion or fleet-release PASS.

## Tested artifacts and isolation

- Android code: `8470a70a143d8630d047f0422b3cc2db016dbed6`.
- Dashboard, queue, coordinates, regression harness: `ac7ee1f254903a1e74be73a43a4a8cb461bd9cf6`.
  Android source is unchanged between these commits.
- CI APK artifact `10519422667`, workflow run `35272333537`, verified ZIP SHA256
  `0be0ff301358262e3ebb9ce4ef34de38a8b92e8f1ae95b8a5d8ac1d07ba5a121`.
  Signed using a disposable test key. No application-code repackaging.
- Official Google API26 x86_64 image revision16; WHPX emulator, 320x640,
  2048 MB RAM, serial `emulator-5580`. Worker 0.4.5 / versionCode18.
- Actual Broker, private Worker HTTPS handler and Next dashboard on isolated
  loopback ports 18787 / 18792 / 13008; disposable owner token, CA and database.
  No real device registration, signer, production APK, endpoint or service changed.

## Reproduction and repairs

1. Before repair (`3ccac0d`), HOME succeeded, but an idle-screen capture returned
   HTTP409 after 3233 ms. The reader discarded frames before the request and then
   waited for a new draw, which static content need not produce.
2. Each capture now attaches a fresh ImageReader surface to the consent-bound
   VirtualDisplay. Old readers cannot satisfy new requests. No cached-frame fallback.
3. Browser input initially collided with an in-flight automatic screenshot and
   received HTTP409. The capture queue now waits for that frame before one manual
   input, suppresses competing refreshes, drops duplicate inputs, cancels pending
   input on context changes, and never retries an input with unknown outcome.
4. Swipe buttons used fixed coordinates outside the 320x640 display. They now
   derive coordinates from the actual image's native dimensions.

## Observed verification

| Check | Result |
|---|---|
| Three idle HOME screenshots, no UI redraw stimulus | PASS, HTTP200, JPEG320x640; 654 / 132 / 153 ms |
| Fresh timestamps after request | PASS using guest clock, increasing across captures |
| Same-key APK replacement | PASS for test replacement; same Device ID and one enrollment event |
| Browser single-view display / continuous update | PASS; 122 successful captures, no errors in final session |
| Browser swipe | PASS; HOME to app drawer with automatic update enabled |
| Browser tap | PASS; app drawer to Settings, then Settings search |
| Browser text | PASS; `battery` appears in Android search and returns matching settings |
| Browser BACK / APP_SWITCH / HOME | PASS; keyboard dismissed, recent-app cards shown, home restored |
| Wrong owner / expired command / ended session | PASS; 401 / 409 / 409 |
| Stop sharing through Worker UI | PASS; screenshot and HOME both rejected409 |
| Reboot emulator | PASS; same ID, enrollment count1, accessibility retained, capture=false |
| Capture without renewed consent after reboot | PASS; rejected409 |
| Renew consent through actual Android dialog | PASS; three more static captures200, 791 / 189 / 160 ms |
| Rotate Settings to landscape during sharing | PASS; screenshot and HOME rejected409; orientation restored |
| Node regression suite | PASS, 978 tests |
| TypeScript and changed-file ESLint | PASS |
| Independent read-only diff review | No important regression identified; emulator results not independently rerun |

The initial timestamp assertion compared host and guest clocks and failed despite
HTTP200 images. It was corrected to read the emulator's own clock without changing
the screen. Both the failure and subsequent PASS remain in local evidence.

One intermediate browser session failed while `uiautomator dump` was running;
that diagnostic can interfere with the Accessibility service. The final browser
session used no concurrent UIAutomator inspection. Its 122 captures and five
tap/text/key actions have no error outcomes in the actual server audit.

## Reproduce

Start an isolated Broker and enrolled API26 emulator, enable Accessibility and
grant screen sharing through the Android UI, then run:

```text
node scripts/verify-android8-static-capture.mjs <test-fixture.json> <emulator-node-id> <result.json> <adb-path> emulator-5580
```

The fixture contains only a disposable owner token and a loopback Broker URL.
The script requires an emulator serial. Never pass production credentials.
Machine-readable observations: [859-android8-emulator.json](859-android8-emulator.json).
Extended local logs remain under the root checkout's `tmp/android8-e2e/`.

## Limits and next action

Not proven: physical Android8 OEM behavior, real WAN/Tailscale latency, Windows
reboot/AC loss, protected-window redaction or PIN-lock behavior, fleet rollout,
automatic installer upgrade, multidevice concurrency, or video/recording on Wi-Fi.
Same-version `adb install -r` verifies retained test registration; it is **not**
proof of the unattended updater. Android8 still requires fresh OS screen-sharing
consent after reboot, stop or orientation invalidation.

PR #860 remains staged on #858. Keep the production/enrollment release hold.
Next: signer-matched Android8 physical canary and enrollment-safe release
coordination, with no re-enrollment or production key rotation.
Rollback: discard these branch commits or restore the previous test APK and
dashboard in the isolated environment; production has not been changed.
