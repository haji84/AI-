//go:build windows

// GORIQ Remote Lite Windows: owner-consented local diagnostic/control preview.
// Binds only to loopback. Does not provide remote Internet access or unattended control.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"goriq-remote-lite-windows/winbridge"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var indexHTML []byte // supplied by web_windows.go

func approve() bool {
	user32 := syscall.NewLazyDLL("user32.dll")
	popup := user32.NewProc("MessageBoxW")
	message, _ := syscall.UTF16PtrFromString("GORIQ Remote Lite 開発用プレビュー\n\nこのPC上のブラウザから15分間、画面を表示・マウス・キーボードを操作できるようにします。\nインターネット越しの遠隔接続は有効になりません。\n\nこのPCで許可しますか？")
	title, _ := syscall.UTF16PtrFromString("GORIQ Remote Lite 端末側の許可")
	n, _, _ := popup.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x00000124) // No is the default button
	return n == 6
}

func approveRemote(sessionID string) bool {
	user32 := syscall.NewLazyDLL("user32.dll")
	popup := user32.NewProc("MessageBoxW")
	message, _ := syscall.UTF16PtrFromString("GORIQ Remote Lite 接続要求\n\nセッション: " + sessionID + "\n\nこのPCの画面表示とマウス・キーボードによる手動操作を最長15分許可しますか？\n接続が切れるか期限が切れると停止します。")
	title, _ := syscall.UTF16PtrFromString("GORIQ Remote Lite 端末側の許可")
	n, _, _ := popup.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x00000124) // No is the default button
	return n == 6
}

func prepareRemoteGate(ctx context.Context, gate *signedStatusGate, approveLocal func() bool, approveSession func(string) bool) (bool, error) {
	if gate == nil {
		return approveLocal(), nil
	}
	if gate.discoveryOnly {
		pending, err := gate.DiscoverPending(ctx)
		if err != nil {
			return false, err
		}
		if pending == nil {
			return false, errors.New("no pending remote connection for this device; start a viewer request, then reopen the Windows host")
		}
		if !approveSession(pending.SessionID) {
			return false, nil
		}
		if err := gate.AcceptPending(ctx, pending); err != nil {
			return false, err
		}
	} else if !approveSession(gate.sessionID) {
		return false, nil
	}
	if err := gate.Check(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func secret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type server struct {
	bridge       desktopBridge
	remoteStatus statusChecker
	token        string
	mu           sync.Mutex
	operationMu  sync.Mutex
	enabled      bool
	expires      time.Time
	cancel       func()
	host         string
}

type desktopBridge interface {
	CaptureJPEG() ([]byte, error)
	Apply(winbridge.Command) error
	Stop() error
}

type statusChecker interface{ Check(context.Context) error }

func newHostServer(bridge desktopBridge, remoteStatus statusChecker, token string, expiry time.Time, host string) *server {
	return &server{bridge: bridge, remoteStatus: remoteStatus, token: token,
		enabled: true, expires: expiry, host: host}
}

// The native status check and the following desktop operation are serialized.
// Once a failed check is observed, no later request can use the bridge.
func (s *server) allowRemote(w http.ResponseWriter, r *http.Request, afterInput bool) bool {
	if s.remoteStatus == nil {
		return true // local-only preview, with local owner consent and token
	}
	if err := s.remoteStatus.Check(r.Context()); err != nil {
		s.mu.Lock()
		s.enabled = false
		s.mu.Unlock()
		if stopErr := s.bridge.Stop(); stopErr != nil {
			http.Error(w, "session stopped; local button or key release unconfirmed", http.StatusConflict)
		} else if afterInput {
			http.Error(w, "input may have applied; session ended; do not retry blindly", http.StatusConflict)
		} else {
			http.Error(w, "signed device session inactive or unavailable", http.StatusForbidden)
		}
		if s.cancel != nil {
			time.AfterFunc(200*time.Millisecond, s.cancel)
		}
		return false
	}
	return true
}

func (s *server) headers(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; base-uri 'none'; form-action 'none'")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
}
func (s *server) guard(w http.ResponseWriter, r *http.Request) bool {
	s.headers(w)
	if r.Host != s.host || (r.RemoteAddr != "" && !isLoopback(r.RemoteAddr)) {
		http.Error(w, "host denied", http.StatusForbidden)
		return false
	}
	if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host {
		http.Error(w, "origin denied", http.StatusForbidden)
		return false
	}
	if r.Header.Get("Cookie") != "" {
		http.Error(w, "cookies denied", http.StatusForbidden)
		return false
	}
	return true
}
func isLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
func (s *server) check(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		http.Error(w, "method denied", http.StatusMethodNotAllowed)
		return false
	}
	if !s.guard(w, r) {
		return false
	}
	s.mu.Lock()
	valid := s.enabled && time.Now().Before(s.expires)
	s.mu.Unlock()
	if !valid {
		if err := s.bridge.Stop(); err != nil {
			http.Error(w, "session ended; local button or key release unconfirmed", http.StatusConflict)
		} else {
			http.Error(w, "session ended", http.StatusForbidden)
		}
		return false
	}
	candidate := r.Header.Get("X-Goriq-Session")
	if len(candidate) != len(s.token) || subtle.ConstantTimeCompare([]byte(candidate), []byte(s.token)) != 1 {
		http.Error(w, "session denied", http.StatusUnauthorized)
		return false
	}
	return true
}
func (s *server) requireSignedRemote(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// A remote endpoint must never inherit the local-preview nil-gate behavior.
		if s.remoteStatus == nil {
			s.headers(w)
			http.Error(w, "signed remote session unavailable", http.StatusServiceUnavailable)
			return
		}
		next(w, r)
	}
}
func (s *server) routes(m *http.ServeMux) {
	for path, content := range map[string][]byte{
		"/browser-webrtc.mjs": browserPeerBytes,
		"/manual-protocol.mjs": manualProtocolBytes,
		"/windows-host.mjs": windowsHostBytes,
	} {
		m.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || r.URL.Path != path {
				http.NotFound(w, r)
				return
			}
			if !s.guard(w, r) {
				return
			}
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			_, _ = w.Write(content)
		})
	}
	m.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		if !s.guard(w, r) {
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	statusRoute := func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, "GET") {
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"mode": "local-preview-only", "secondsRemaining": int(time.Until(s.expires).Seconds()), "internetRemote": false})
	}
	m.HandleFunc("/api/status", statusRoute)
	m.HandleFunc("/api/remote/status", s.requireSignedRemote(statusRoute))
	frameRoute := func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, "GET") {
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		b, err := s.bridge.CaptureJPEG()
		if err != nil {
			http.Error(w, "capture unavailable", http.StatusConflict)
			return
		}
		if !s.check(w, r, "GET") {
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", fmt.Sprint(len(b)))
		_, _ = w.Write(b)
	}
	m.HandleFunc("/api/frame", frameRoute)
	m.HandleFunc("/api/remote/frame", s.requireSignedRemote(frameRoute))
	inputRoute := func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, "POST") {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		defer r.Body.Close()
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var cmd winbridge.Command
		if err := dec.Decode(&cmd); err != nil {
			http.Error(w, "invalid input", 400)
			return
		}
		if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
			http.Error(w, "invalid input trailing data", 400)
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		if err := s.bridge.Apply(cmd); err != nil {
			http.Error(w, "input refused", 409)
			return
		}
		s.mu.Lock()
		localActive := s.enabled && time.Now().Before(s.expires)
		s.mu.Unlock()
		if !localActive {
			if err := s.bridge.Stop(); err != nil {
				http.Error(w, "input may have applied; local button or key release unconfirmed", http.StatusConflict)
			} else {
				http.Error(w, "input may have applied; local consent ended", http.StatusConflict)
			}
			return
		}
		if !s.allowRemote(w, r, true) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	m.HandleFunc("/api/input", inputRoute)
	m.HandleFunc("/api/remote/input", s.requireSignedRemote(inputRoute))
	s.signalRoutes(m)
	m.HandleFunc("/api/end", func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, "POST") {
			return
		}
		s.mu.Lock()
		s.enabled = false
		s.mu.Unlock()
		if err := s.bridge.Stop(); err != nil {
			http.Error(w, "operation stopped; local button or key release could not be confirmed", http.StatusConflict)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		go s.cancel()
	})
}
func main() {
	remoteGate, err := configuredSignedRemoteSession(nil)
	if err != nil {
		log.Fatal("signed remote session configuration refused: ", err)
	}
	allowed, err := prepareRemoteGate(context.Background(), remoteGate, approve, approveRemote)
	if err != nil {
		log.Fatal("signed remote session startup refused: ", err)
	}
	if !allowed {
		fmt.Println("LOCAL_CONSENT_DENIED")
		return
	}
	token, err := secret()
	if err != nil {
		log.Fatal(err)
	}
	bridge := new(winbridge.Bridge)
	end := time.Now().Add(15 * time.Minute)
	if err := bridge.AuthorizeLocalUse(end); err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().String()
	httpServer := &http.Server{ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 12 * time.Second, MaxHeaderBytes: 8192}
	app := newHostServer(bridge, remoteGate, token, end, port)
	app.cancel = func() { _ = httpServer.Close() }
	mux := http.NewServeMux()
	app.routes(mux)
	httpServer.Handler = mux
	// This URL is a locally displayed capability, not an internet-ready share link.
	url := "http://" + port + "/#token=" + token
	if remoteGate != nil {
		url += "&remote=1"
		fmt.Println("GORIQ Remote Lite: signed session local host. Auto-stop in 15 minutes. No Internet peer transport yet.")
	} else {
		fmt.Println("GORIQ Remote Lite: local-only preview. Auto-stop in 15 minutes.")
	}
	fmt.Println("Windows上でこのリンクを開く:", url)
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	time.AfterFunc(time.Until(end), func() {
		app.operationMu.Lock()
		defer app.operationMu.Unlock()
		app.mu.Lock()
		app.enabled = false
		app.mu.Unlock()
		_ = bridge.Stop()
		_ = httpServer.Close()
	})
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Println("server stopped:", err)
	}
	if err := bridge.Stop(); err != nil {
		log.Println("local input release retrying:", err)
		if err := bridge.WaitForRelease(15 * time.Second); err != nil {
			log.Println("local input release still unconfirmed:", err)
		}
	}
}
