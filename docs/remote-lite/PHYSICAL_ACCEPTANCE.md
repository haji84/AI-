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
