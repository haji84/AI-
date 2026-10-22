# GORIQ Remote Lite: Windows interactive-desktop local prototype

Owner task: [Issue #1831](https://github.com/haji84/AI-/issues/1831). **Development test only, not a distributable external remote-control product.**

## Functional boundaries
- The Windows host binds exclusively to `127.0.0.1` on a randomly selected local port.
- Launch as a normal interactive Windows user. If unregistered, it opens a Japanese local setup page without any desktop capture/input routes. A registered host displays an explicit Windows session-consent dialog before opening its separate desktop listener. Desktop consent has a15-minute maximum and can be ended immediately from its local page.
- A per-launch cryptographically random 256-bit token is used for local frame/input APIs. The URL fragment is removed from browser history. The program never exposes that token in a public endpoint.
- The host captures JPEG frames through GDI; an interactive non-protected input desktop is required for frames and manual bounded input. It refuses attempts to operate the protected Windows desktop. Windows UAC/locked-screen behavior must be accepted physically; build or unit tests do not prove it.
- Setup accepts an explicitly confirmed `goriqremote://enroll` invitation with an HTTPS origin. It generates an Ed25519 key only on local registration, saves it under current-user Windows DPAPI before sending the request, proves the exact coordinator challenge, and displays the full fingerprint/receipt. A lost reply retains uncertainty and the same key; only a locally confirmed new invitation for the same origin can retry. A per-directory OS file handle prevents concurrent EXEs from changing the journal. Setup expires in15minutes and has an explicit exit button; no invitation/private key is returned in diagnostics or stored in browser storage.
- Only a fresh signed discovery confirming owner approval creates `%LOCALAPPDATA%\GORIQ Remote Lite\active-session.json`. The ordinary EXE unlocks its Ed25519 PKCS#8 key through current-user DPAPI. Version2 contains a registered device ID without a session ID: the EXE queries pending/active sessions, shows the exact session ID for local consent, and checks active status before native frame/input routes open. Version1 remains VM compatibility. A malformed, revoked or unavailable configuration refuses startup. Neither credential file nor a public coordinator address is shipped in the EXE. Windows setup/browser acceptance is pending exact-head CI; see ACCEPTANCE.md.
- The local page offers a **real RTCPeerConnection self-test**: Chrome/Edge creates two browser peers on the same PC, sends the captured canvas video track to the viewer peer, verifies a data-channel ping/pong, and optionally sends a single owner-confirmed pointer movement through the RTCDataChannel and native API.
- The WebRTC self-test closes after 60 seconds, on page hide, disconnect, or owner stop. It has **no Internet, account, other-PC or TURN connection** and never means that remote cellular operation has succeeded.
- The signed configuration path discovers and accepts a pending request with the real Node coordinator and connects a separate viewer browser in the Windows VM. This is loopback/disposable-VM evidence, not public Internet or physical friend acceptance. The new setup VM additionally requires the embedded page to enroll a Windows-generated key, refuse before owner approval, restore registration and refuse after revocation.
- If the coordinator accepts a request but its response is lost, the EXE checks the exact session's active status with a fresh device signature. On a later EXE start, a version 2 registered device can also discover its own still-active session. This requires a new local Yes/No approval for the displayed session ID and a fresh signed active-status check before frame/input routes open. It fails closed if the session expired, was revoked, or the coordinator is unavailable. This restores the native authorization gate only; WebRTC re-offer after host restart and coordinator persistence are not yet implemented or verified.

## Verified cross-build checks
Run with Go 1.23+ installed, from this directory:
```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o GORIQ_Remote_Lite_Windows_WebRTC_Local_Test.exe ./cmd/localhost
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c -o winbridge.test.exe ./winbridge
```
This compiles tests but does not run Windows-native tests on a Linux runner. On a Windows PC, `go test ./...` must be run locally before a physical PASS is recorded.

The script embedded in `cmd/localhost/index.html` was separately syntax-checked with `node --check`. Browser media/DTLS, actual input/capture, UAC, power recovery, multi-DPI and iPhone compatibility are **unverified**.

## Physical owner acceptance
1. Confirm the Windows user is signed in and running the EXE without elevation or weakened system protections.
2. Approve the on-device MessageBox, verify a JPEG frame in Edge/Chrome, then click **映像とデータ通信をテスト**.
3. Wait for **PASS: 実映像の受信とデータ往復を確認（このPC内のみ）**, then approve one pointer-movement test and verify the pointer actually moves.
4. End the session and verify the port and frame/input access close. Repeat for locked desktop, UAC, expiry, network disconnection and process restart (should refuse unsafe operation).
5. Do not release to friends until external authenticated signaling, encrypted/authorized media and input, TURN cost control, Android native integration and cellular E2E are separately implemented and verified.

## Security/rollout
No third-party packages in `go.mod`. No public bind, router changes, Tailscale changes, sign-in account, external deployment, silent elevated privileges, autostart service, update mechanism or production-installation authorization. Any installer signing/distribution, OS permission modifications or public services require separate owner approval and review.

Rollback: revert the relevant implementation commits and rebuild. Preserve the user's encrypted enrollment journal and active-session config; do not delete app data or silently re-enroll. No GORIQ main runtime dependency is introduced.
