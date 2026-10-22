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
