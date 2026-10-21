# GORIQ Remote Lite: Windows interactive-desktop local prototype

Owner task: [Issue #1831](https://github.com/haji84/AI-/issues/1831). **Development test only, not a distributable external remote-control product.**

## Functional boundaries
- The Windows host binds exclusively to `127.0.0.1` on a randomly selected local port.
- Launch as a normal interactive Windows user. It displays an explicit Windows consent dialog *before* opening the local listener. Consent has a 15-minute maximum and can be ended immediately from the local page.
- A per-launch cryptographically random 256-bit token is used for local frame/input APIs. The URL fragment is removed from browser history. The program never exposes that token in a public endpoint.
- The host captures JPEG frames through GDI; an interactive non-protected input desktop is required for frames and manual bounded input. It refuses attempts to operate the protected Windows desktop. Windows UAC/locked-screen behavior must be accepted physically; build or unit tests do not prove it.
- If an approved enrollment flow has installed `%LOCALAPPDATA%\GORIQ Remote Lite\active-session.json`, the ordinary EXE unlocks its Ed25519 PKCS#8 key through current-user Windows DPAPI. Version 2 contains a registered device ID without a session ID: the EXE makes a signed pending-session query, shows the session ID in a local consent dialog, signs its acceptance, then checks active status before opening native frame/input routes. Version 1 remains an active-session VM compatibility format. A malformed, revoked or inactive configuration refuses startup. Without that file, the EXE remains a local preview and `/api/remote/*` remains unavailable. The repository does not create or ship this credential file.
- The local page offers a **real RTCPeerConnection self-test**: Chrome/Edge creates two browser peers on the same PC, sends the captured canvas video track to the viewer peer, verifies a data-channel ping/pong, and optionally sends a single owner-confirmed pointer movement through the RTCDataChannel and native API.
- The WebRTC self-test closes after 60 seconds, on page hide, disconnect, or owner stop. It has **no Internet, account, other-PC or TURN connection** and never means that remote cellular operation has succeeded.
- The signed configuration path discovers and accepts a pending request with the real Node coordinator in a Windows VM. It does not yet connect a separate viewer's WebRTC peer or provide Internet signaling. The VM creates disposable credentials; it is not a friend setup workflow.
- If the coordinator accepts a request but its response is lost, the EXE checks the exact session's active status with a fresh device signature. It opens the host only if that check succeeds. If status cannot be confirmed or the EXE stops before checking, the viewer must end the session, start a new request, and reopen the host. Recovery across a process restart remains to be implemented before distribution.

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

Rollback is removal of this isolated `apps/remote-lite-windows` directory; no runtime migration or GORIQ main dependency exists.
