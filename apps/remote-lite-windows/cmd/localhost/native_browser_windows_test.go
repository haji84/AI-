//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"goriq-remote-lite-windows/winbridge"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type revocableStatusGate struct {
	base    statusChecker
	revoked atomic.Bool
}

func (g *revocableStatusGate) Check(ctx context.Context) error {
	if g.revoked.Load() {
		return errors.New("VM device registration revoked")
	}
	return g.base.Check(ctx)
}

// The disposable Windows VM supplies a synthetic owner-consent grant. This
// test drives the embedded browser page through the signed route, real GDI
// capture, RTCPeerConnection media/DataChannel, and real SendInput. It is not
// a friend's clean-install, Internet, iPhone, or physical-device acceptance.
func TestWindowsVMNativeWebRTCFrameInputAndRevocation(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_VM_NATIVE") != "1" {
		t.Skip("enable on disposable Windows CI VM")
	}
	bridge := new(winbridge.Bridge)
	if err := bridge.AuthorizeLocalUse(time.Now().Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Stop() })
	active := true
	gate := &revocableStatusGate{base: signedRouteFixture(t, &active)}
	token := strings.Repeat("c", 64)
	app := &server{bridge: bridge, token: token, enabled: true,
		expires: time.Now().Add(2 * time.Minute), remoteStatus: gate}
	mux := http.NewServeMux()
	app.routes(mux)
	vmServer := httptest.NewServer(mux)
	t.Cleanup(vmServer.Close)
	app.host = strings.TrimPrefix(vmServer.URL, "http://")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	script := filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-windows-native-browser-vm.mjs")
	url := vmServer.URL + "/#token=" + token + "&remote=1"
	cmd := exec.CommandContext(ctx, "node", script, url)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Wait()
	})
	lines := bufio.NewScanner(stdout)
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"active"`)) {
		t.Fatalf("native WebRTC failed before revocation: %v %s", lines.Err(), stderr.String())
	}
	gate.revoked.Store(true)
	if _, err := fmt.Fprintln(stdin, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"stopped"`)) {
		t.Fatalf("native WebRTC did not stop after revocation: %v %s", lines.Err(), stderr.String())
	}
}
