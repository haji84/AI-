//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The private test TLS proxy trusts only httptest's certificate through its
// injected client. Product code retains normal system trust and never skips TLS.
func TestWindowsEnrollmentActualNodeAndOptionalBrowser(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_NODE_INTEROP") != "1" {
		t.Skip("disposable enrollment integration fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	fixture := exec.CommandContext(ctx, "node", filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-windows-setup-fixture.mjs"))
	stdin, err := fixture.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := fixture.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var fixtureErrors bytes.Buffer
	fixture.Stderr = &fixtureErrors
	if err := fixture.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = fmt.Fprintln(stdin, `{"action":"exit"}`); _ = stdin.Close(); _ = fixture.Wait() })
	lines := bufio.NewScanner(stdout)
	if !lines.Scan() {
		t.Fatal("enrollment authority did not start")
	}
	var ready struct {
		URL        string `json:"url"`
		InviteCode string `json:"inviteCode"`
	}
	if json.Unmarshal(lines.Bytes(), &ready) != nil || !statusNonce.MatchString(ready.InviteCode) {
		t.Fatal("invalid authority readiness")
	}
	target, err := url.Parse(ready.URL)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" {
		t.Fatal("fixture is not loopback")
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	direct := proxy.Director
	proxy.Director = func(r *http.Request) { direct(r); r.Host = target.Host }
	tls := httptest.NewTLSServer(proxy)
	defer tls.Close()
	dir := t.TempDir()
	manager := newEnrollmentManager(dir, tls.Client())
	invitation := "goriqremote://enroll?server=" + url.QueryEscape(tls.URL) + "&invite=" + ready.InviteCode
	var browser *exec.Cmd
	var browserInput io.WriteCloser
	var browserLines *bufio.Scanner
	var browserErrors bytes.Buffer
	var setupClosed chan struct{}
	if os.Getenv("GORIQ_REMOTE_LITE_VM_NATIVE") == "1" {
		token := strings.Repeat("f", 64)
		setupClosed = make(chan struct{})
		app := &setupServer{manager: manager, token: token, expires: time.Now().Add(2 * time.Minute), cancel: func() { close(setupClosed) }}
		local := httptest.NewServer(app)
		defer local.Close()
		app.host = strings.TrimPrefix(local.URL, "http://")
		browser = exec.CommandContext(ctx, "node", filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-windows-setup-browser.mjs"), local.URL+"/#token="+token)
		browserInput, err = browser.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		out, err := browser.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		browser.Stderr = &browserErrors
		if err := browser.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = browserInput.Close()
			_ = browser.Wait()
			for _, line := range strings.Split(browserErrors.String(), "\n") {
				if line == "Setup bootstrap recoveries: 0" || line == "Setup bootstrap recoveries: 1" {
					t.Log(line)
				}
			}
		})
		if err := json.NewEncoder(browserInput).Encode(map[string]string{"invitation": invitation}); err != nil {
			t.Fatal(err)
		}
		browserLines = bufio.NewScanner(out)
		if !browserLines.Scan() || browserLines.Text() != "awaiting-owner" {
			t.Fatalf("normal setup did not reach owner approval: %s", browserErrors.String())
		}
	} else {
		if _, err := manager.Register(ctx, invitation, false); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Confirm(ctx); err == nil {
			t.Fatal("unapproved actual Node identity activated")
		}
	}
	view, err := manager.View()
	if err != nil || view.Phase != "awaiting-owner-approval" {
		t.Fatalf("registration phase: %+v %v", view, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "active-session.json")); !os.IsNotExist(err) {
		t.Fatal("unapproved configuration exists")
	}
	if err := json.NewEncoder(stdin).Encode(map[string]string{"action": "approve", "requestId": view.RequestID, "fingerprint": view.Fingerprint}); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || lines.Text() != "approved" {
		t.Fatal("actual Node did not approve Windows proof")
	}
	if browser != nil {
		_, _ = fmt.Fprintln(browserInput, "approve")
		if !browserLines.Scan() || browserLines.Text() != "approved-and-restored" {
			t.Fatalf("approval UI/reopen failed: %s", browserErrors.String())
		}
	} else if _, err := manager.Confirm(ctx); err != nil {
		t.Fatal(err)
	}
	fresh, err := newEnrollmentManager(dir, tls.Client()).View()
	if err != nil || fresh.Phase != "approved" || fresh.DeviceID != view.DeviceID || fresh.Fingerprint != view.Fingerprint {
		t.Fatal("new setup instance lost approved identity")
	}
	gate, err := loadSignedRemoteSession(filepath.Join(dir, "active-session.json"), tls.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gate.DiscoverPending(ctx); err != nil {
		t.Fatal("normal startup identity was refused by actual Node")
	}
	if err := json.NewEncoder(stdin).Encode(map[string]string{"action": "revoke", "deviceId": view.DeviceID}); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || lines.Text() != "revoked" {
		t.Fatal("actual Node revoke failed")
	}
	if _, err := gate.DiscoverPending(ctx); err == nil {
		t.Fatal("revoked normal startup identity accepted")
	}
	if browser != nil {
		_, _ = fmt.Fprintln(browserInput, "revoke")
		if !browserLines.Scan() || browserLines.Text() != "revoked-and-closed" {
			t.Fatalf("revoked setup confirmation or close failed: %s", browserErrors.String())
		}
		select {
		case <-setupClosed:
		case <-time.After(3 * time.Second):
			t.Fatal("setup close did not stop local server")
		}
	} else if _, err := manager.Confirm(ctx); err == nil {
		t.Fatal("revoked enrollment reconfirmed")
	}
	t.Log("Actual Node verified locally generated Windows DPAPI identity; unapproved/revoked discovery refused; restart identity retained")
}
