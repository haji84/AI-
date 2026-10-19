# Remote Lite: Windows local-control prototype

Issue #1831. This is a bounded **development preview**, not a friend-distributable remote-control product and not a real WebRTC-to-native bridge.

## Output and provenance (2026-10-19)
A conversation-download ZIP named `GORIQ_Remote_Lite_Windows_Local_Preview.zip` was generated separately from GitHub and includes:
- `apps/remote-lite-windows/go.mod`
- `apps/remote-lite-windows/winbridge/bridge_windows.go`
- `apps/remote-lite-windows/cmd/localhost/main_windows.go`
- `apps/remote-lite-windows/cmd/localhost/web_windows.go`
- `apps/remote-lite-windows/cmd/localhost/index.html`
- a Windows/amd64 executable and Japanese README

Final bundled executable SHA256: `32d74223862fd4fae0bd3ea22c1cef2f11e4c78351579bce06a07288e6492746`.
**These Go/HTML source files are attached to the chat ZIP, not yet imported into this GitHub PR.** A GitHub issue comment records the development output, but the ZIP is not a durable GitHub release.

## Behavior (code-level)
1. Run the unsigned preview locally as the normal Windows desktop user, never with raised privileges.
2. A visible native local-consent dialog appears. Declining does not open a listener.
3. On consent, it runs a Go loopback-only HTTP server bound to `127.0.0.1` on an OS-assigned port, creates a random 256-bit access token and opens a browser UI.
4. Within the same local PC, the authenticated page can request bounded JPEG snapshots and manually issue touch-like clicks, a single-batch drag, typed text or selected keys.
5. Input is denied when the default desktop is not the current input desktop, as an additional lock/secure-desktop guard. This is not a verified UAC/lock safety claim.
6. Explicit stop and a 15-minute lifetime end capture/input and the listener. No external listening interface or installed background service is created.

## Checks performed
- `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath`: PASS (cross-compile only)
- `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...`: PASS
- `gofmt`: PASS
- JavaScript inline script parsed using `node --check`: PASS
- Native Windows runtime, actual display, keyboard/touch, lock/UAC and real client interaction: **NOT TESTED**.
- Browser automation inside the current sandbox is blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`. Do not count as an application failure or PASS.

## Release gate
This local test **does not** provide Internet access from iPhone, Android capture/control, an installer, TLS/TURN relay or a verified WebRTC-to-Win32 binding. No release/production deployment or extension of owner privileges has occurred.

Before integrating this prototype as a real feature: import Go/HTML sources into an isolated reviewed branch, review Windows secure-desktop and owner-consent behavior, authenticate the WebRTC peer independently of signals, connect a time-limited manual-only channel to the native Win32 bridge, test in a physical Windows user session, and validate signed Windows distribution. Preserve GORIQ parent services and identities.

Rollback: discard this documentation/prototype; no existing runtime or configuration is mutated.
