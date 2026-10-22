# Physical device acceptance — Issue #1831

## USB preparation, 2026-10-22

The `physicalCheck` build is a separate, test-signed package,
`app.goriq.remote.lite.physicaltest` (GORIQ Remote 実機試験). It uses the
unchanged normal `RemoteSessionService`, native video and Accessibility input.
It is not debuggable and does not include emulator-only activities, the VM
service or its `10.0.2.2` TURN configuration. It is not the distribution APK.

Generate the disposable TLS fixture with `scripts/prepare_vm_tls.py` from the
Android project, then build `:app:assemblePhysicalCheck`. Keep the generated CA
and server certificate together for that test. The additional CA is trusted
only for the exact host `127.0.0.1`; all other HTTPS hosts use system roots.
Cleartext remains disabled. The release build does not contain this CA or
network security override. No device-wide CA installation is needed.

Start the owner portal on PC loopback with this certificate. On the explicitly
selected, owner-authorized USB device, map only the test server port with
`adb -s SERIAL reverse tcp:PORT tcp:PORT`. Install the physicalCheck APK without
uninstalling existing applications or resetting the device. Finish enrollment,
full fingerprint comparison, owner approval, Accessibility permission and
MediaProjection consent through their normal user interfaces. OS permission
and capture dialogs require the owner; do not automate their acceptance.

Record actual device model/Android version, APK SHA-256, tested commit, decoded
video dimensions/frame progress, real input effect, ACK, and stop/revocation
behavior. A USB result verifies native interoperability only; it does not
establish public internet, mobile iPhone, TURN, reboot or distribution acceptance.
Remove only the specific test reverse mapping after the test. Preserve keys and
registry while investigating failures; do not reset them to obtain a pass.

## Local artifact checks

- `:app:assemblePhysicalCheck :app:assembleRelease`: passed on Windows.
- `apksigner verify --verbose`: APK Signature Scheme v2 verified.
- `aapt`: separate application ID and label, normal service, no VM components,
  cleartext disabled and no debuggable flag.
- Physical APK SHA-256 at initial preparation:
  `8719274DF2A548DC2495FBAA7F3AA54F83B3190EBE0587E647F0CA0F3929DBF2`.
- This records artifact preparation only. Physical video/input acceptance is
  still pending at artifact preparation.

## Physical setup observed, 2026-10-22

The owner authorized USB debugging. Read-only device properties identified nubia
A403ZT, Android 15 / API 35. The above APK installed successfully as a separate
app. Only test port 57755 was reverse-mapped. The owner submitted enrollment in
the normal UI, confirmed the complete fingerprint against the independent
owner registry, and explicitly enabled the Accessibility service. The exact
physicaltest service appears in the OS enabled-service setting. No capture or
remote-input success is implied by these setup observations. Browser/capture
consent and actual video/input are the next checks.

The `d685dd76` physical profile passed CI39760390261 and Android39760390265,
including APK separation checks. The following `ba4bd63d` TURN wiring passed
normal CI39761328273, but Android39761328131 FAILED in the VM's Settings setup:
three service-row coordinate taps left the same list visible. No native media
test ran in that job. Android and harness files did not change between those
two heads; the successful previous run also needed its second Settings tap.
The exact cause of the ignored coordinate tap is not established.

The next harness method records node bounds/enabled/class and focused activity;
after the existing three taps, it tries Android 15's normal Accessibility detail
Settings entry once. It preserves platform permission checks, visible service
name, switch/Allow/enabled checks and the later exact-service binding assertions.
It does not grant permissions through shell or change the product. A denied
alternate launch remains a failed test. This approach is pending CI validation.

## 19:40 JST checkpoint — physical video not accepted

Head `42d48aebbe634d1a7bcb3a0197d4a78ed14b2538` passed normal CI
[39763402723](https://github.com/haji84/AI-/actions/runs/39763402723) (all four jobs)
and Android CI
[39763402705](https://github.com/haji84/AI-/actions/runs/39763402705).
Android VM decoded native video through the local TURN fixture, observed actual
tap/ACK/pixel changes at 0.888/0.644 seconds, refused the secure target and
released video/input/capture after revocation in 0.250 seconds. The Settings row
opened on the first normal attempt in this run; the alternative Settings entry
was not exercised and is not claimed as runtime-verified.

The owner reported approving screen sharing on nubia but seeing no PC video.
The PC owner page subsequently showed `SESSION_NOT_FOUND_OR_EXPIRED`; read-only
Android diagnostics showed MediaProjection null and no RemoteSessionService.
The Accessibility service remained enabled and bound. Both endpoints had Wi-Fi
addresses on the same LAN; this alone does not prove a working ICE route. A new
browser request remained pending and expired without observed native acceptance.
The actual stop cause of the original attempt is not established. Do not report
physical video/input as passed or change the accepted Android capture path on
the basis of this observation alone.

The owner UI now shows the session ID for comparison, the remaining consent
deadline, and specific steps for a new request after expiration. The 60-second
server deadline and all native authorization checks remain unchanged. Its real
HTTPS Chrome regression test advances the fixture clock to reproduce expiration,
requires disabled input/no media, then verifies a fresh request and logout.
The test failed before the UI change and passed afterward (4/4 focused tests).
The Remote Lite suite passed 95 tests with the separately executed browser test
skipped in the ordinary invocation; ESLint and diff checks passed.

Next physical check: open RemoteSessionActivity first, then start a fresh PC
request and complete local consent within its displayed deadline. Record the
native message/frame count, PC decoded video and actual test-button effect/ACK.
The USB reverse carries HTTPS signaling only, not WebRTC media. Public HTTPS,
TURN, cellular iPhone, release signing and distribution acceptance remain open.

## Physical input interruption report — 2026-10-22 19:51 JST

The owner reported that nubia video sharing worked but stopped on the fourth
input. This is human-reported physical video evidence, not machine-verified
input/ACK or sustained-session acceptance. The fourth action and its spacing
are not yet known. Do not infer that a three-input product limit exists.

At inspection MediaProjection was null and the sharing service had stopped.
The in-app browser showed a hidden-page stop and zero ACKs; it is not yet known
whether the reported test used that browser or the separate Chrome window.
The initial physicalCheck was not debuggable, so existing diagnostic events were
disabled. Enabling them for that test package at INFO still produced no events:
read-only inspection found the device's `persist.log.tag=W`. The device-wide
logging configuration was left unchanged.

A resource switch now enables the existing bounded diagnostic event names at
WARN only in physicalCheck. Debug retains INFO; release has the resource set to
false. Events contain lifecycle/stop codes, timing, error classes and candidate
types, not screen contents, input contents, coordinates, SDP, IP addresses,
session IDs or keys. Authorization, capture, input and stop logic are unchanged.
The updated APK was installed with `adb install -r` only after confirming no
active MediaProjection; application data and keys were preserved.

- `assemblePhysicalCheck assembleRelease testDebugUnitTest`: success, 49 JVM
  tests with zero failures/errors; APK v2 signature verification passed.
- Compiled APK resources: physicalCheck diagnostics true; release false.
- Current diagnostic APK SHA-256:
  `7CA238C1D9F28E42291F9A6C5D7C8D23D31085E0D4A4A9FAF05756D1B83C4A8E`.
- Independent review found no P1/P2 in the diagnostic-only change.
- Reproduction remains required: new consent, five taps on the app's harmless
  test button spaced about one second apart, then inspect stop code/frame/ACK
  evidence. Do not retry uncertain inputs automatically or relax the one-second
  input freshness rule to obtain a pass.

Rollback this diagnostic change by reverting its commit and rebuilding/updating
the same test package with the existing test signer. Do not uninstall/clear app
data, regenerate keys or change the device-wide logging/Accessibility settings.

## Native/browser interruption evidence — 2026-10-22 20:20 JST

The diagnostic physicalCheck APK above recorded two native input successes in
each of two observed sessions at 19:59 and 20:00 JST. Each input passed fresh
signed pre-status, the nonsecure-window screenshot proof, OS dispatch and signed
post-status. The final session's input-status age was 60/20 ms. Native shutdown
reported `control-channel-ended`; the owner browser displayed
`映像の更新を確認できないため停止しました` and `入力確認: 2`.
This narrows the observed shutdown to the browser frame watchdog. It does not
prove that the owner's earlier fourth-input report has a four-input limit, or
that input-queue or native capture changes are required.

A disposable local IAB/WebRTC experiment on this PC used a synthetic canvas,
the existing BrowserManualPeer, and the same frame-age condition. With dynamic
content, callbacks continued even when the video was 2,211 px below the viewport
(age 92 ms). After source redraw stopped, the peers remained connected but the
callback count stayed at 274 and decoded-frame count at 306 for over 23 seconds.
The current four-second stale-frame close condition would fire. Video currentTime
continued advancing despite no new frames, so currentTime alone must never be
used as evidence of fresh media. This is a browser reproduction of a static-source
failure mode, **not confirmation that nubia stopped producing frames**. The
physical capture/frame counters must still be compared under the same conditions.
No freshness threshold, authorization check or native capture/input behavior was
relaxed. The local probe is isolated under ignored `.jarvis`, uses no real screen
or OS input, and has a bounded lifetime.

The owner clarified that the earlier fourth action was a swipe. The initially
requested session's pending deadline elapsed, and the owner subsequently started
a different session and approved sharing. Native capture began at 20:13:38,
ICE connected at 20:13:39, and the IAB viewer displayed actual 270x600 media.
The app's frame count advanced from 118 to 225. Two agent-driven viewer taps
received native OS completion, fresh signed post-status and browser ACK 1/2,
but the intended test button's counter remained zero. Target activation and
input-coordinate accuracy are therefore **not passed**. A fresh screenshot and
coordinate/viewport mapping check are needed before further gesture tests.

At 20:15:20 the native service stopped with `session-not-active`; the browser
then showed `control-channel-failed`, and OS MediaProjection was null. This is
a different failure signature from the earlier browser frame timeout. The
existing stop code combines failed signed status and failed lease renewal, so
the current evidence does not identify which one occurred. A bounded diagnostic
callback now distinguishes fixed transport failure categories, explicitly
allowlisted coordinator refusal codes, invalid proof/response, and lease-renewal
failure. Unknown server codes and exception messages are never logged. Stop
also reports the captured-frame count. The existing test-only log gate,
authorization decisions and time limits are unchanged.

The added diagnostic test first failed because the callback did not exist.
After implementation, `assemblePhysicalCheck assembleRelease testDebugUnitTest`
passed with 50 JVM tests, zero failures/errors; APK v2 verification and independent
review passed. The physical package was updated with `adb install -r` after OS
MediaProjection was confirmed null; registered data was retained. Updated APK
SHA-256: `6A740151B87F7D97564404B59B7D9996FC7868A3C5C3D04AA14B1A30947A17AB`.

A separate synthetic pointer probe reproduced the IAB's 396x586 CSS viewport
and smaller screenshot. A screenshot-based click at (182,309) arrived as the
same CSS client coordinates and missed the synthetic target; CSS-corrected
(190,322) hit it. This identifies an automation-coordinate issue in the first
tap, but does not explain the second physical miss. The product's letterbox
mapping was not changed. The temporary viewport override was reset. Android's
read-only activity dump can expose this app's actual view bounds without running
UiAutomator or interrupting its Accessibility service; use those bounds in the
next session to verify the intended button, not just an ACK.

The owner requested permanent screen-sharing consent. On this Android 15 device,
the normal MediaProjection API requires consent for each new capture session;
the token is single-use. There is no implemented permanent-consent mode. Keeping
an existing authorized capture alive can avoid unnecessary prompts within that
session, but it does not establish unattended restart/lock recovery. Reference:
https://developer.android.com/media/grow/media-projection#user_consent

Exact diagnostic source `0bba52579d21e064624e7dacad2c151286b2cf2e` passed
[normal CI 39767138245](https://github.com/haji84/AI-/actions/runs/39767138245)
and [Android CI 39767138292](https://github.com/haji84/AI-/actions/runs/39767138292).
The latter is emulator evidence: native tap/ACK/decoded pixel change 0.641/0.637 s,
secure-window refusal, and owner revoke stopping video/input and releasing capture
in 0.266 s. It is not sustained physical or cellular acceptance.

The owner subsequently reported being away from home. Local nubia consent is
unavailable, and capture is already stopped. Do not request more local device
actions or restart capture through a permission workaround. The next available
step is Android VM reproduction; physical retesting remains blocked.

Diagnostic source `937c23cf68053d220f9773b84abb80d94c1e7eb5` passed
[normal CI 39770678090](https://github.com/haji84/AI-/actions/runs/39770678090)
and [Android CI 39770677947](https://github.com/haji84/AI-/actions/runs/39770677947).
The VM recorded actual tap/ACK/pixel changes in 0.648/0.634 s and revoke cleanup
in 0.245 s. These checks still used three taps in the sharing activity, whose
500 ms frame-counter redraw can hide static-screen behavior.

The next VM experiment adds four alternating RTC swipes on the existing license
screen. Each requires an OS ACK and a substantial change in decoded app pixels,
excluding system bars. It then records ten seconds of presentation-callback age
without changing the screen. A gap at or above the product browser's four-second
stop threshold fails the experiment, after the existing secure-window/revocation
checks have run. The fixture viewer still differs from the production owner UI;
this checks the native stream/input hypothesis, not end-to-end product acceptance.
No product capture, input, authorization, timeout or permission setting changes.

Select a fix from observed evidence; do not label stale pixels LIVE or count a
transport heartbeat as a new frame. No release/distribution acceptance is granted.
Rollback this VM experiment by reverting its commit; device state is unchanged.

### VM swipe reproduction and a separate short-gesture defect — 2026-10-22

`56b28e316bb5ab74b1af5436e372d65ce0317d2c` passed
[normal CI 39772628560](https://github.com/haji84/AI-/actions/runs/39772628560), but
[Android CI 39772628591](https://github.com/haji84/AI-/actions/runs/39772628591)
failed on the first 250 ms swipe. Three preceding taps reached ACK/count 3.
The swipe passed signed pre-status at age 224 ms, then failed with
`IllegalStateException` at 226 ms before `remote-window-selected`.
Native stop was `manual-input-not-confirmed`, captured frames 107. This places
the failure before the window screenshot and OS gesture dispatch. Cross-window
or overlapping-window checks are candidates; their predicates are unchanged.
Fixed diagnostic categories now distinguish display validation, missing target,
cross-window endpoints and overlap. They log no coordinates/window names/content.
The idle observation was not reached and is **not passed**.

The preceding `19606ffb` run
[39772473008](https://github.com/haji84/AI-/actions/runs/39772473008) failed earlier:
the rapid-tap sequence reached input age 1,001 ms and correctly stopped at the
existing freshness boundary. This is a separate load/queue failure, not evidence
of a swipe result or a reason to extend the input deadline. Both failed runs
remain failures. Independent review confirmed the diagnostic change preserves
the input/permission/lease decisions.

Source review also found a distinct reproducible contract mismatch: the portal
generated 50–99 ms swipes while Android accepts durations from 100 ms. Such
packets are rejected as `invalid-manual-input` and terminate the connection.
The portal now clamps its outgoing gestures to 100–1,000 ms; Android's accepted
range and security checks are unchanged. A regression test executes the shipped
pointer handlers at 50/99/100/250/1,500 ms and checks the outgoing command;
it failed on the original 50 ms output, then passed with the correction. A native
boundary test confirms 50/99 ms remain rejected and 100 ms is accepted.
Local targeted Node checks passed 15 tests with one real-Chrome case skipped;
Android JVM checks passed 51 tests with zero failures/errors, release build and
targeted ESLint/diff checks passed, and independent review found no P1/P2.
This does not explain the VM's 250 ms refusal or establish the nubia failure's
cause. No new APK was installed on the physical device while the owner was away.

Next: run the same bounded VM swipe experiment with fixed refusal categories;
address the observed cause without weakening protected-window or freshness checks.
Rollback the short-gesture/diagnostic change by reverting its commit. The earlier
VM experiment can be reverted with `56b28e31` then `19606ffb`. Device registrations,
permissions and production state were not changed by these commits.

### Static native video gap reproduced — 2026-10-22 21:05 JST

`8856c7e88b024d11d29815b2f478064ac1ca6239` passed
[normal CI 39774535191](https://github.com/haji84/AI-/actions/runs/39774535191).
[Android CI 39774535169](https://github.com/haji84/AI-/actions/runs/39774535169)
passed all four RTC swipes: ACK 4–7, decoded app-pixel changes
45.3/23.6/21.7/20.7%, and 0.856/0.841/0.830/0.830 s. The earlier window-selection
refusal did not recur; that alone does not establish that it is fixed.

The ten-second static license-screen observation recorded a maximum frame gap of
10,088.9 ms (two presentation callbacks/decoded frames during the interval).
RTC stayed connected. The unchanged four-second freshness assertion correctly
failed the run. This reproduces the static-native-stream/owner-watchdog mismatch
without a synthetic canvas. It is not confirmation of the physical nubia's cause.
The existing secure-window refusal and owner-revoke checks still ran: revoke
stopped RTC/input and released OS capture in 0.455 s.

The next candidate requests a fresh compositor output only when native capture
has been idle for one second, at most once per second. It uses the existing
ScreenCapturerAndroid `changeCaptureFormat` with unchanged dimensions on Android
12 or newer. Inspection of the pinned SDK 150.7871.01 bytecode confirmed that
this calls resize/setSurface on the existing authorized VirtualDisplay, without
creating another projection or reusing a consent token. See also the
[upstream capturer implementation](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/api/org/webrtc/ScreenCapturerAndroid.java).
The timer is separate from authorization/watchdog work, checks the existing lease
and closed state, and is shut down on close. It does not emit a cached frame or
advance any frame timestamp/counter itself. Only a subsequent real capture can
refresh media. Existing frame-age, input, lock, revocation and consent conditions
remain unchanged. Effectiveness is pending the same native VM test; it is not
installed on the physical nubia. Rollback is a revert of this candidate commit.

The candidate `aaaa185249bd74eb9376a4eba76717aceefa98da` passed local 51 JVM
tests, release build, diff checks, independent review and
[normal CI 39777129151](https://github.com/haji84/AI-/actions/runs/39777129151).
[Android CI 39777129148](https://github.com/haji84/AI-/actions/runs/39777129148)
failed before reaching the swipe/idle experiment: the second rapid tap reached
signed pre-status at 991 ms, then failed before OS dispatch at 1,005 ms.
Actual count/ACK remained 2. This reproduces the independent queue/freshness
failure; the idle-refresh candidate's effect remains unverified.

The next experiment moves the same four-swipe/ten-second idle observation before
the first rapid-tap pair. Both rapid-tap pairs and their real count/ACK assertions
remain, as do secure-window rejection, revocation and the four-second frame gap
limit. The first session now has tap ACK 1, swipe ACK 2–5, and rapid-tap ACK 6–7.
No failure is converted to a pass, no native deadline changes, and no extra
physical consent is requested while the owner is away.

At `977ad54d4f531d8bdb14804e836a4eab5839da8e`,
[normal CI 39778639184](https://github.com/haji84/AI-/actions/runs/39778639184)
passed, but [Android CI 39778639236](https://github.com/haji84/AI-/actions/runs/39778639236)
failed the static frame-gap assertion at 9,942 ms (two decoded frames/callbacks).
All four swipes had actual pixel changes and ACK 2–5 in 0.859/0.851/0.847/0.845 s.
Both rapid pairs passed in this run, secure input was refused, and revocation
released RTC/OS capture in 0.467 s. Earlier rapid-input failures remain unresolved.
The idle-refresh candidate has not fixed the decoded-frame gap and is not shipped.

Before replacing the capture path, the next diagnostic records capture-side
actual frame count/age once per second and reads those fixed numeric events
immediately after idle observation. An increasing count establishes continued
native callbacks/handoff before the browser; a stalled count still leaves both
producer inactivity and delegate/GPU backpressure possible. Previous bounded
failure logs were taken after the second session and do not establish that
distinction. It changes no authorization, input, frame timestamps or acceptance
assertions, and remains disabled in the release build.

## Owner portal baseline

Commit `f4b00c147e3996c79643cf88c39c3f0633f6f4ad` passed normal CI
([39758076923](https://github.com/haji84/AI-/actions/runs/39758076923)) and
Android candidate CI
([39758076950](https://github.com/haji84/AI-/actions/runs/39758076950)). The latter
used the Android 15 emulator and separate Chrome with local forced TURN:
actual tap/ACK/pixel change 0.641/0.636 seconds, secure-window refusal, and owner
revocation stopped video/input and released capture in 0.246 seconds. These are
VM observations, not physical or public-connection acceptance.

Rollback: revert the physicalCheck preparation commit to remove only this
test build profile. Earlier implementation rollback is `f4b00c1` then `f279a5d`.
Do not delete the user's device registration, OS settings or existing GORIQ data.
