//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"goriq-remote-lite-windows/winbridge"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// This VM test joins the actual Node coordinator, the ordinary Windows signed
// gate, two independent Chromium sessions, GDI capture and SendInput. The Go
// HTTP proxy is test-only: it keeps the viewer capability and owner bearer out
// of the page and lets a loopback-only coordinator retain its production guard.
func TestWindowsVMSeparateChromiumRealCoordinator(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_VM_NATIVE") != "1" {
		t.Skip("enable on disposable Windows CI VM")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Second)
	defer cancel()
	fixtureScript := filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-go-vm-fixture.mjs")
	fixture := exec.CommandContext(ctx, "node", fixtureScript)
	fixtureInput, err := fixture.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	fixtureOutput, err := fixture.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var fixtureErrors bytes.Buffer
	fixture.Stderr = &fixtureErrors
	if err := fixture.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = fmt.Fprintln(fixtureInput, "exit")
		_ = fixtureInput.Close()
		_ = fixture.Wait()
	})
	fixtureLines := bufio.NewScanner(fixtureOutput)
	if !fixtureLines.Scan() {
		t.Fatalf("Node coordinator did not start: %v %s", fixtureLines.Err(), fixtureErrors.String())
	}
	var ready struct {
		Event         string `json:"event"`
		URL           string `json:"url"`
		DeviceID      string `json:"deviceId"`
		SessionID     string `json:"sessionId"`
		ViewerToken   string `json:"viewerToken"`
		PrivateKeyDer string `json:"privateKeyDer"`
	}
	if err := json.Unmarshal(fixtureLines.Bytes(), &ready); err != nil || ready.Event != "ready" ||
		len(ready.ViewerToken) != 64 {
		t.Fatalf("Node coordinator fixture incomplete: %v %s", err, fixtureErrors.String())
	}
	keyDER, err := base64.StdEncoding.DecodeString(ready.PrivateKeyDer)
	if err != nil {
		t.Fatal(err)
	}
	protected, err := protectVMDeviceKey(keyDER)
	clear(keyDER)
	if err != nil {
		t.Fatal(err)
	}
	config, err := json.Marshal(activeRemoteSession{Version: 2, StatusServiceURL: ready.URL,
		DeviceID: ready.DeviceID, ProtectedPrivateKey: base64.StdEncoding.EncodeToString(protected)})
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
	if err != nil || gate == nil {
		t.Fatalf("Windows signed gate unavailable: %v", err)
	}
	approved, err := prepareRemoteGate(ctx, gate, func() bool {
		t.Fatal("remote approval fell back to local consent")
		return false
	}, func(sessionID string) bool { return sessionID == ready.SessionID })
	if err != nil || !approved {
		t.Fatalf("real Node session was not accepted by signed Windows gate: %v %v", approved, err)
	}
	if err := gate.Check(ctx); err != nil {
		t.Fatalf("signed session not active: %v", err)
	}
	bridge := new(winbridge.Bridge)
	if err := bridge.AuthorizeLocalUse(time.Now().Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Stop() })
	token := strings.Repeat("b", 64)
	app := newHostServer(bridge, gate, token, time.Now().Add(2*time.Minute), "")
	mux := http.NewServeMux()
	app.routes(mux)
	mux.HandleFunc("/vm/viewer", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/vm/viewer" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, vmViewerPage)
	})
	viewerPost := func(r *http.Request, path string, payload any) (json.RawMessage, error) {
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, ready.URL+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		upstream.Header.Set("Content-Type", "application/json")
		upstream.Header.Set("Authorization", "Bearer vm-test-owner")
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Do(upstream)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, errors.New("Node viewer authentication or signal refused")
		}
		var envelope struct {
			OK     bool            `json:"ok"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 96*1024)).Decode(&envelope); err != nil ||
			!envelope.OK || len(envelope.Result) == 0 {
			return nil, errors.New("Node viewer response invalid")
		}
		return envelope.Result, nil
	}
	mux.HandleFunc("/vm/viewer/signal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method denied", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 72*1024+1))
		var signal remoteSignal
		if err != nil || len(body) > 72*1024 || decodeStatusJSON(body, &signal) != nil ||
			(signal.Type != "offer" && signal.Type != "candidate") {
			http.Error(w, "invalid signal", http.StatusBadRequest)
			return
		}
		if _, err := canonicalRemoteSignal(signal); err != nil {
			http.Error(w, "invalid signal", http.StatusBadRequest)
			return
		}
		_, err = viewerPost(r, "/v1/viewer/signal", map[string]any{
			"sessionId": ready.SessionID, "viewerToken": ready.ViewerToken, "signal": signal,
		})
		if err != nil {
			http.Error(w, "Node signal refused", http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/vm/viewer/poll", func(w http.ResponseWriter, r *http.Request) {
		ack, err := strconv.ParseUint(r.URL.Query().Get("ack"), 10, 53)
		if r.Method != http.MethodGet || err != nil {
			http.Error(w, "invalid poll", http.StatusBadRequest)
			return
		}
		result, err := viewerPost(r, "/v1/viewer/poll", map[string]any{
			"sessionId": ready.SessionID, "viewerToken": ready.ViewerToken, "ack": ack,
		})
		if err != nil {
			http.Error(w, "Node poll refused", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(result)
	})
	vmServer := httptest.NewServer(observeVMRoot(t, app, mux))
	t.Cleanup(vmServer.Close)
	app.host = strings.TrimPrefix(vmServer.URL, "http://")
	browserScript := filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-windows-separate-browser-vm.mjs")
	browser := exec.CommandContext(ctx, "node", browserScript,
		vmServer.URL+"/#token="+token+"&remote=1", vmServer.URL+"/vm/viewer")
	browserInput, err := browser.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	browserOutput, err := browser.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var browserErrors bytes.Buffer
	browser.Stderr = &browserErrors
	if err := browser.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = browserInput.Close()
		_ = browser.Wait()
	})
	browserLines := bufio.NewScanner(browserOutput)
	if !browserLines.Scan() || !bytes.Contains(browserLines.Bytes(), []byte(`"event":"media-ready"`)) ||
		!bytes.Contains(browserLines.Bytes(), []byte(`"pixelsMatched":true`)) {
		t.Fatalf("real Node signals did not connect separate browsers: %v %s %s",
			browserLines.Err(), browserErrors.String(), fixtureErrors.String())
	}
	logVMNavigationRecoveries(t, browserLines.Bytes())
	prepareVMCursorAwayFromCenter(t)
	if _, err := fmt.Fprintln(browserInput, "move"); err != nil {
		t.Fatal(err)
	}
	if !browserLines.Scan() || !bytes.Contains(browserLines.Bytes(), []byte(`"event":"manual-ack"`)) {
		t.Fatalf("real Node session did not acknowledge Windows input: %v %s", browserLines.Err(), browserErrors.String())
	}
	assertVMCursorAtScreenCenter(t)
	if _, err := fmt.Fprintln(fixtureInput, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !fixtureLines.Scan() || !bytes.Contains(fixtureLines.Bytes(), []byte(`"event":"revoked"`)) {
		t.Fatalf("real Node coordinator did not revoke device: %v %s", fixtureLines.Err(), fixtureErrors.String())
	}
	if _, err := fmt.Fprintln(browserInput, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !browserLines.Scan() || !bytes.Contains(browserLines.Bytes(), []byte(`"event":"stopped"`)) {
		t.Fatalf("real Node revocation did not stop both browser peers: %v %s", browserLines.Err(), browserErrors.String())
	}
}
