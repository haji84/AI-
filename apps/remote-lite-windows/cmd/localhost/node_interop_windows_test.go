//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func protectVMDeviceKey(keyDER []byte) ([]byte, error) {
	input := dataBlob{Size: uint32(len(keyDER)), Data: &keyDER[0]}
	var output dataBlob
	protect := syscall.NewLazyDLL("crypt32.dll").NewProc("CryptProtectData")
	ok, _, err := protect.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0,
		0x00000001, uintptr(unsafe.Pointer(&output)))
	if ok == 0 || output.Data == nil {
		return nil, fmt.Errorf("VM DPAPI protection failed: %w", err)
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.Data)))
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}

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
	protected, err := protectVMDeviceKey(keyDER)
	if err != nil {
		t.Fatal(err)
	}
	clear(keyDER)
	config, err := json.Marshal(activeRemoteSession{Version: 2, StatusServiceURL: ready.URL,
		DeviceID:            ready.DeviceID,
		ProtectedPrivateKey: base64.StdEncoding.EncodeToString(protected)})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCALAPPDATA", t.TempDir())
	configPath, err := remoteSessionPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, config, 0600); err != nil {
		t.Fatal(err)
	}
	gate, err := configuredSignedRemoteSession(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !gate.discoveryOnly {
		t.Fatal("registered device configuration must discover a session before capture")
	}
	if err := gate.Check(ctx); err == nil {
		t.Fatal("discovery-only configuration enabled frame or input before acceptance")
	}
	pending, err := gate.DiscoverPending(ctx)
	if err != nil || pending == nil || pending.SessionID != ready.SessionID || pending.DeviceID != ready.DeviceID || pending.Status != "pending" {
		t.Fatalf("signed pending session was not discovered through the real coordinator: %+v, %v", pending, err)
	}
	approved, err := prepareRemoteGate(ctx, gate, func() bool { t.Fatal("local-only approval used"); return false },
		func(sessionID string) bool { return false })
	if err != nil || approved || !gate.discoveryOnly {
		t.Fatalf("denied local consent activated remote session: %v, %v", approved, err)
	}
	approved, err = prepareRemoteGate(ctx, gate, func() bool { t.Fatal("local-only approval used"); return false },
		func(sessionID string) bool {
			if sessionID != ready.SessionID {
				t.Errorf("wrong session shown for approval: %s", sessionID)
				return false
			}
			return true
		})
	if err != nil || !approved || gate.discoveryOnly || gate.sessionID != ready.SessionID {
		t.Fatalf("normal EXE flow did not accept pending session: %v, %v %s", approved, err, stderr.String())
	}
	if err := gate.Check(ctx); err != nil {
		t.Fatalf("normal EXE signed gate could not check actual coordinator: %v", err)
	}
	deniedRestart, err := configuredSignedRemoteSession(nil)
	if err != nil {
		t.Fatal(err)
	}
	approved, err = prepareRemoteGate(ctx, deniedRestart, func() bool { t.Fatal("local-only approval used"); return false },
		func(sessionID string) bool { return false })
	if err != nil || approved || !deniedRestart.discoveryOnly {
		t.Fatalf("restarted EXE bypassed local consent: approved=%v err=%v", approved, err)
	}
	// A process restart reloads only the registered device identity. The active
	// session must require a fresh signed discovery and local consent again.
	restartedGate, err := configuredSignedRemoteSession(nil)
	if err != nil || restartedGate == nil || !restartedGate.discoveryOnly {
		t.Fatalf("restarted EXE did not load registered identity: %v", err)
	}
	approved, err = prepareRemoteGate(ctx, restartedGate, func() bool { t.Fatal("local-only approval used"); return false },
		func(sessionID string) bool { return sessionID == ready.SessionID })
	if err != nil || !approved || restartedGate.discoveryOnly || restartedGate.sessionID != ready.SessionID {
		t.Fatalf("restarted EXE could not safely rejoin active session: approved=%v err=%v", approved, err)
	}
	gate = restartedGate
	bridge := new(fakeRemoteDesktop)
	app := newHostServer(bridge, gate, strings.Repeat("c", 64), time.Now().Add(time.Minute), "127.0.0.1:42000")
	mux := http.NewServeMux()
	app.routes(mux)
	iceReply := remoteRequest(t, mux, http.MethodGet, "/api/remote/ice", nil)
	var ice remoteICEConfig
	if iceReply.Code != http.StatusOK || json.Unmarshal(iceReply.Body.Bytes(), &ice) != nil ||
		ice.SessionID != ready.SessionID || ice.DeviceID != ready.DeviceID || ice.Mode != "direct-only" || len(ice.ICEServers) != 0 {
		t.Fatalf("actual Node did not authorize signed Windows ICE: HTTP %d", iceReply.Code)
	}
	if _, err := fmt.Fprintln(stdin, "offer"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"offered"`)) {
		t.Fatalf("Node viewer did not send offer: %v %s", lines.Err(), stderr.String())
	}
	polled := remoteRequest(t, mux, http.MethodGet, "/api/remote/poll?ack=0", nil)
	var batch remoteSignalBatch
	if polled.Code != http.StatusOK || json.Unmarshal(polled.Body.Bytes(), &batch) != nil || batch.Cursor != 1 || len(batch.Signals) != 1 || batch.Signals[0].Type != "offer" || batch.Signals[0].SDP != "v=0\r\n"+strings.Repeat("a", 32*1024) {
		t.Fatalf("signed Windows host did not receive viewer offer: HTTP %d %+v %s", polled.Code, batch, polled.Body.String())
	}
	replayed := remoteRequest(t, mux, http.MethodGet, "/api/remote/poll?ack=0", nil)
	var replay remoteSignalBatch
	if replayed.Code != http.StatusOK || json.Unmarshal(replayed.Body.Bytes(), &replay) != nil || replay.Cursor != batch.Cursor || len(replay.Signals) != 1 || replay.Signals[0].SDP != batch.Signals[0].SDP {
		t.Fatalf("unacknowledged offer was not replayed: HTTP %d %s", replayed.Code, replayed.Body.String())
	}
	acknowledged := remoteRequest(t, mux, http.MethodGet, "/api/remote/poll?ack=1", nil)
	var empty remoteSignalBatch
	if acknowledged.Code != http.StatusOK || json.Unmarshal(acknowledged.Body.Bytes(), &empty) != nil || empty.Cursor != 1 || len(empty.Signals) != 0 {
		t.Fatalf("acknowledged offer was not cleared: HTTP %d %s", acknowledged.Code, acknowledged.Body.String())
	}
	answer, _ := json.Marshal(remoteSignal{Type: "answer", SDP: "v=0\r\na=recvonly"})
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/signal", answer); got.Code != http.StatusNoContent {
		t.Fatalf("signed Windows host could not send answer: HTTP %d %s", got.Code, got.Body.String())
	}
	mid, line := "0", 0
	candidate, _ := json.Marshal(remoteSignal{Type: "candidate", Candidate: "candidate:1 1 udp 1 127.0.0.1 1234 typ host", SDPMid: &mid, SDPMLineIndex: &line})
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/signal", candidate); got.Code != http.StatusNoContent {
		t.Fatalf("signed Windows host could not send ICE candidate: HTTP %d %s", got.Code, got.Body.String())
	}
	if _, err := fmt.Fprintln(stdin, "answer"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"answered"`)) {
		t.Fatalf("Node viewer did not receive signed answer: %v %s", lines.Err(), stderr.String())
	}
	if pending, err := gate.DiscoverPending(ctx); err != nil || pending != nil {
		t.Fatalf("active session appeared as pending: %+v, %v", pending, err)
	}
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
