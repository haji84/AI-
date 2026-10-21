//go:build windows

package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"goriq-remote-lite-windows/winbridge"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type fakeRemoteDesktop struct {
	frames  int
	inputs  int
	stops   int
	stopErr error
	onFrame func()
	onInput func()
}

func (d *fakeRemoteDesktop) CaptureJPEG() ([]byte, error) {
	d.frames++
	if d.onFrame != nil {
		d.onFrame()
	}
	return []byte{0xff, 0xd8, 0xff, 0xd9}, nil
}
func (d *fakeRemoteDesktop) Apply(winbridge.Command) error {
	d.inputs++
	if d.onInput != nil {
		d.onInput()
	}
	return nil
}
func (d *fakeRemoteDesktop) Stop() error { d.stops++; return d.stopErr }

func signedRouteFixture(t *testing.T, active *bool) *signedStatusGate {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	challengeID := "51c18b98-f073-4c32-a8e7-79e5cff81837"
	nonce := strings.Repeat("b", 48)
	coordinator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/device/challenge":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{
				"challengeId": challengeID, "challenge": nonce, "expiresAt": time.Now().Add(time.Minute).UnixMilli(),
			}})
		case "/v1/device/status":
			var request struct {
				Proof struct {
					Signature string `json:"signature"`
				} `json:"proof"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			signature, err := base64.StdEncoding.DecodeString(request.Proof.Signature)
			message := strings.Join([]string{"GORIQ_REMOTE_DEVICE_AUTH_V1", "windows-a", "session-status", "session-a", challengeID, nonce, ""}, "\n")
			if err != nil || !ed25519.Verify(public, []byte(message), signature) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			status := "active"
			if !*active {
				status = "closed"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{
				"sessionId": "session-a", "deviceId": "windows-a", "status": status,
				"expiresAt": time.Now().Add(time.Minute).UnixMilli(),
			}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(coordinator.Close)
	gate, err := newSignedStatusGate(coordinator.URL, "windows-a", "session-a", func(message []byte) ([]byte, error) {
		return ed25519.Sign(private, message), nil
	}, coordinator.Client())
	if err != nil {
		t.Fatal(err)
	}
	return gate
}

func remoteRequest(t *testing.T, mux http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "http://127.0.0.1:42000"+path, bytes.NewReader(body))
	request.RemoteAddr = "127.0.0.1:51000"
	request.Header.Set("X-Goriq-Session", strings.Repeat("c", 64))
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func TestSignedSessionGuardsNativeFrameAndInputAfterRevocation(t *testing.T) {
	active := true
	bridge := new(fakeRemoteDesktop)
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	mux := http.NewServeMux()
	app.routes(mux)
	if got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil); got.Code != http.StatusOK || bridge.frames != 1 {
		t.Fatalf("active frame denied: HTTP %d, frames=%d", got.Code, bridge.frames)
	}
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`)); got.Code != http.StatusNoContent || bridge.inputs != 1 {
		t.Fatalf("active input denied: HTTP %d, inputs=%d", got.Code, bridge.inputs)
	}
	active = false
	if got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil); got.Code != http.StatusForbidden || bridge.frames != 1 || bridge.stops != 1 {
		t.Fatalf("revoked frame was delivered: HTTP %d, frames=%d, stops=%d", got.Code, bridge.frames, bridge.stops)
	}
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`)); got.Code != http.StatusForbidden || bridge.inputs != 1 {
		t.Fatalf("revoked input was applied: HTTP %d, inputs=%d", got.Code, bridge.inputs)
	}
}

func TestStatusFailureReportsUnconfirmedNativeRelease(t *testing.T) {
	active := false
	bridge := &fakeRemoteDesktop{stopErr: errors.New("button UP rejected")}
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	mux := http.NewServeMux()
	app.routes(mux)
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`)); got.Code != http.StatusConflict || bridge.inputs != 0 || bridge.stops != 1 {
		t.Fatalf("unconfirmed release was hidden: HTTP %d, inputs=%d, stops=%d", got.Code, bridge.inputs, bridge.stops)
	}
}

func TestRevocationDuringCaptureDoesNotDeliverFrame(t *testing.T) {
	active := true
	bridge := &fakeRemoteDesktop{onFrame: func() { active = false }}
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	mux := http.NewServeMux()
	app.routes(mux)
	got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil)
	if got.Code != http.StatusForbidden || bytes.Equal(got.Body.Bytes(), []byte{0xff, 0xd8, 0xff, 0xd9}) || bridge.stops != 1 {
		t.Fatalf("frame leaked across revocation: HTTP %d, body=%q, stops=%d", got.Code, got.Body.String(), bridge.stops)
	}
}

func TestRevocationDuringInputReportsPossibleApplication(t *testing.T) {
	active := true
	bridge := &fakeRemoteDesktop{onInput: func() { active = false }}
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	mux := http.NewServeMux()
	app.routes(mux)
	got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input", []byte(`{"action":"tap","x":0.5,"y":0.5}`))
	if got.Code != http.StatusConflict || !strings.Contains(got.Body.String(), "may have applied") || bridge.inputs != 1 || bridge.stops != 1 {
		t.Fatalf("in-flight input ambiguity hidden: HTTP %d, body=%q, inputs=%d, stops=%d", got.Code, got.Body.String(), bridge.inputs, bridge.stops)
	}
}

func TestRemoteRoutesDenyWhenSignedGateIsMissing(t *testing.T) {
	bridge := new(fakeRemoteDesktop)
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000"}
	mux := http.NewServeMux()
	app.routes(mux)
	for _, path := range []string{"/api/remote/status", "/api/remote/frame", "/api/remote/input", "/api/remote/poll", "/api/remote/signal"} {
		method := http.MethodGet
		var body []byte
		if strings.HasSuffix(path, "/input") || strings.HasSuffix(path, "/signal") {
			method = http.MethodPost
			if strings.HasSuffix(path, "/input") {
				body = []byte(`{"action":"tap","x":0.5,"y":0.5}`)
			} else {
				body = []byte(`{"type":"offer","sdp":"v=0\r\n"}`)
			}
		}
		if got := remoteRequest(t, mux, method, path, body); got.Code != http.StatusServiceUnavailable {
			t.Fatalf("remote route %s accepted without signed gate: HTTP %d", path, got.Code)
		}
	}
	if bridge.frames != 0 || bridge.inputs != 0 {
		t.Fatalf("native bridge used without signed gate: frames=%d inputs=%d", bridge.frames, bridge.inputs)
	}
}

func TestLocalExpiryDuringCaptureDoesNotDeliverFrame(t *testing.T) {
	active := true
	bridge := new(fakeRemoteDesktop)
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	bridge.onFrame = func() { app.expires = time.Now().Add(-time.Second) }
	mux := http.NewServeMux()
	app.routes(mux)
	got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil)
	if got.Code != http.StatusForbidden || bytes.Equal(got.Body.Bytes(), []byte{0xff, 0xd8, 0xff, 0xd9}) {
		t.Fatalf("frame leaked across local expiry: HTTP %d body=%q", got.Code, got.Body.String())
	}
}

// This runs only on a disposable Windows CI VM, where the test session itself
// supplies synthetic local consent. It exercises actual GDI capture and
// SendInput through the signed HTTP route, without changing a user's desktop.
func TestWindowsVMNativeFrameAndInputRevocation(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_VM_NATIVE") != "1" {
		t.Skip("enable on disposable Windows CI VM")
	}
	active := true
	bridge := new(winbridge.Bridge)
	if err := bridge.AuthorizeLocalUse(time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Stop() })
	app := &server{bridge: bridge, token: strings.Repeat("c", 64), enabled: true,
		expires: time.Now().Add(time.Minute), host: "127.0.0.1:42000", remoteStatus: signedRouteFixture(t, &active)}
	mux := http.NewServeMux()
	app.routes(mux)
	frame := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil)
	if frame.Code != http.StatusOK || frame.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("native Windows capture failed: HTTP %d %s", frame.Code, frame.Body.String())
	}
	if _, err := jpeg.DecodeConfig(bytes.NewReader(frame.Body.Bytes())); err != nil {
		t.Fatalf("native Windows capture was not a JPEG: %v", err)
	}
	input := remoteRequest(t, mux, http.MethodPost, "/api/remote/input",
		[]byte(`{"action":"pointer","phase":"move","button":"left","x":0.5,"y":0.5}`))
	if input.Code != http.StatusNoContent {
		t.Fatalf("native Windows SendInput failed: HTTP %d %s", input.Code, input.Body.String())
	}
	active = false
	if got := remoteRequest(t, mux, http.MethodGet, "/api/remote/frame", nil); got.Code != http.StatusForbidden {
		t.Fatalf("native frame allowed after revoke: HTTP %d", got.Code)
	}
	if got := remoteRequest(t, mux, http.MethodPost, "/api/remote/input",
		[]byte(`{"action":"pointer","phase":"move","button":"left","x":0.5,"y":0.5}`)); got.Code != http.StatusForbidden {
		t.Fatalf("native input allowed after revoke: HTTP %d", got.Code)
	}
}
