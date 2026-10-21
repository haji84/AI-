//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This opt-in VM test crosses the real Node loopback signaling adapter and
// the Go signed gate. The device key exists only inside the child process and
// this test; neither is a usable friend-distribution enrollment flow.
func TestActualNodeCoordinatorRevocationStopsWindowsRoutes(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_NODE_INTEROP") != "1" {
		t.Skip("enable on disposable Windows CI VM")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	script := filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-go-vm-fixture.mjs")
	cmd := exec.CommandContext(ctx, "node", script)
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
		_, _ = fmt.Fprintln(stdin, "exit")
		_ = stdin.Close()
		_ = cmd.Wait()
	})
	lines := bufio.NewScanner(stdout)
	if !lines.Scan() {
		t.Fatalf("Node fixture did not start: %v %s", lines.Err(), stderr.String())
	}
	var ready struct {
		Event         string `json:"event"`
		URL           string `json:"url"`
		DeviceID      string `json:"deviceId"`
		SessionID     string `json:"sessionId"`
		PrivateKeyDer string `json:"privateKeyDer"`
	}
	if err := json.Unmarshal(lines.Bytes(), &ready); err != nil || ready.Event != "ready" {
		t.Fatalf("invalid Node fixture readiness: %v %s", err, stderr.String())
	}
	keyDER, err := base64.StdEncoding.DecodeString(ready.PrivateKeyDer)
	if err != nil {
		t.Fatal(err)
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(keyDER)
	if err != nil {
		t.Fatal(err)
	}
	private, ok := parsedKey.(ed25519.PrivateKey)
	if !ok {
		t.Fatal("fixture key is not Ed25519")
	}
	gate, err := newSignedStatusGate(ready.URL, ready.DeviceID, ready.SessionID,
		func(message []byte) ([]byte, error) { return ed25519.Sign(private, message), nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	bridge := new(fakeRemoteDesktop)
	app := &server{bridge: bridge, remoteStatus: gate, token: strings.Repeat("c", 64),
		enabled: true, expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000"}
	mux := http.NewServeMux()
	app.routes(mux)
	if got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil); got.Code != http.StatusOK || bridge.frames != 1 {
		t.Fatalf("real Node active status did not permit one frame: HTTP %d frames=%d %s", got.Code, bridge.frames, stderr.String())
	}
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`)); got.Code != http.StatusNoContent || bridge.inputs != 1 {
		t.Fatalf("real Node active status did not permit one input: HTTP %d inputs=%d", got.Code, bridge.inputs)
	}
	if _, err := fmt.Fprintln(stdin, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"revoked"`)) {
		t.Fatalf("Node fixture did not revoke: %v %s", lines.Err(), stderr.String())
	}
	if got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil); got.Code != http.StatusForbidden || bridge.frames != 1 || bridge.stops != 1 {
		t.Fatalf("revoked Node session leaked frame: HTTP %d frames=%d stops=%d", got.Code, bridge.frames, bridge.stops)
	}
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`)); got.Code != http.StatusForbidden || bridge.inputs != 1 {
		t.Fatalf("revoked Node session applied input: HTTP %d inputs=%d", got.Code, bridge.inputs)
	}
}
