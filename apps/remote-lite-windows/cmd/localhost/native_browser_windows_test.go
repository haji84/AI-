//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
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
	"syscall"
	"testing"
	"time"
	"unsafe"
)

type vmPoint struct{ X, Y int32 }

func logVMNavigationRecoveries(t *testing.T, receipt []byte) {
	t.Helper()
	var report struct {
		Recoveries *int `json:"navigationRecoveries"`
	}
	if err := json.Unmarshal(receipt, &report); err != nil || report.Recoveries == nil ||
		*report.Recoveries < 0 || *report.Recoveries > 2 {
		t.Fatal("missing or invalid browser bootstrap recovery receipt")
	}
	t.Logf("VM browser bootstrap navigation recoveries=%d", *report.Recoveries)
}

// Observe only the root document, without logging capabilities or request data.
// This distinguishes an HTTP refusal from a browser that never reached the host.
func observeVMRoot(t *testing.T, app *server, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/" {
			next.ServeHTTP(w, r)
			return
		}
		recorded := httptest.NewRecorder()
		next.ServeHTTP(recorded, r)
		t.Logf("VM root: status=%d embeddedHTML=%t hostMatches=%t loopback=%t originValid=%t cookiePresent=%t",
			recorded.Code, bytes.Equal(recorded.Body.Bytes(), indexHTML), r.Host == app.host,
			isLoopback(r.RemoteAddr), r.Header.Get("Origin") == "" || r.Header.Get("Origin") == "http://"+r.Host,
			r.Header.Get("Cookie") != "")
		for key, values := range recorded.Header() {
			w.Header()[key] = values
		}
		w.WriteHeader(recorded.Code)
		_, _ = w.Write(recorded.Body.Bytes())
	})
}

func prepareVMCursorAwayFromCenter(t *testing.T) {
	t.Helper()
	user32 := syscall.NewLazyDLL("user32.dll")
	metrics := user32.NewProc("GetSystemMetrics")
	setCursor := user32.NewProc("SetCursorPos")
	getCursor := user32.NewProc("GetCursorPos")
	readMetric := func(index uintptr) int32 {
		value, _, _ := metrics.Call(index)
		return int32(value)
	}
	left, top := readMetric(76), readMetric(77)
	width, height := readMetric(78), readMetric(79)
	if width < 16 || height < 16 {
		t.Fatalf("invalid VM screen: %d x %d", width, height)
	}
	x, y := left+width/8, top+height/8
	if ok, _, err := setCursor.Call(uintptr(x), uintptr(y)); ok == 0 {
		t.Fatalf("SetCursorPos failed: %v", err)
	}
	var before vmPoint
	if ok, _, err := getCursor.Call(uintptr(unsafe.Pointer(&before))); ok == 0 {
		t.Fatalf("GetCursorPos before RTC input failed: %v", err)
	}
	if before.X < x-8 || before.X > x+8 || before.Y < y-8 || before.Y > y+8 {
		t.Fatalf("cursor did not reach VM test start coordinate: got (%d,%d), expected (%d,%d)", before.X, before.Y, x, y)
	}
}

// An acknowledgement from the DataChannel is insufficient evidence of native
// input. Read the actual Windows cursor after the browser reports success.
func assertVMCursorAtScreenCenter(t *testing.T) {
	t.Helper()
	user32 := syscall.NewLazyDLL("user32.dll")
	metrics := user32.NewProc("GetSystemMetrics")
	getCursor := user32.NewProc("GetCursorPos")
	readMetric := func(index uintptr) int32 {
		value, _, _ := metrics.Call(index)
		return int32(value)
	}
	left, top := readMetric(76), readMetric(77)
	width, height := readMetric(78), readMetric(79)
	if width < 1 || height < 1 {
		t.Fatalf("invalid VM screen: %d x %d", width, height)
	}
	var cursor vmPoint
	if ok, _, err := getCursor.Call(uintptr(unsafe.Pointer(&cursor))); ok == 0 {
		t.Fatalf("GetCursorPos failed: %v", err)
	}
	wantX, wantY := left+width/2, top+height/2
	if cursor.X < wantX-8 || cursor.X > wantX+8 || cursor.Y < wantY-8 || cursor.Y > wantY+8 {
		t.Fatalf("RTC pointer command acknowledged but native cursor is (%d,%d), wanted screen center (%d,%d)",
			cursor.X, cursor.Y, wantX, wantY)
	}
}

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
	vmServer := httptest.NewServer(observeVMRoot(t, app, mux))
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
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"media-ready"`)) {
		t.Fatalf("native WebRTC failed before pointer test: %v %s", lines.Err(), stderr.String())
	}
	logVMNavigationRecoveries(t, lines.Bytes())
	prepareVMCursorAwayFromCenter(t)
	if _, err := fmt.Fprintln(stdin, "move"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"active"`)) {
		t.Fatalf("native WebRTC failed before revocation: %v %s", lines.Err(), stderr.String())
	}
	assertVMCursorAtScreenCenter(t)
	gate.revoked.Store(true)
	if _, err := fmt.Fprintln(stdin, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"stopped"`)) {
		t.Fatalf("native WebRTC did not stop after revocation: %v %s", lines.Err(), stderr.String())
	}
}
