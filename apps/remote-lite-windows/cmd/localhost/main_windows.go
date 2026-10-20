//go:build windows

// GORIQ Remote Lite Windows: owner-consented local diagnostic/control preview.
// Binds only to loopback. Does not provide remote Internet access or unattended control.
package main

import (
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
	n, _, _ := popup.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x00000024)
	return n == 6
}

func secret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

type server struct {
	bridge  *winbridge.Bridge
	token   string
	mu      sync.Mutex
	enabled bool
	expires time.Time
	cancel  func()
	host    string
}

func (s *server) headers(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; base-uri 'none'; form-action 'none'")
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
		http.Error(w, "session ended", http.StatusForbidden)
		return false
	}
	candidate := r.Header.Get("X-Goriq-Session")
	if len(candidate) != len(s.token) || subtle.ConstantTimeCompare([]byte(candidate), []byte(s.token)) != 1 {
		http.Error(w, "session denied", http.StatusUnauthorized)
		return false
	}
	return true
}
func (s *server) routes(m *http.ServeMux) {
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
	m.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if !s.check(w, r, "GET") {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"mode": "local-preview-only", "secondsRemaining": int(time.Until(s.expires).Seconds()), "internetRemote": false})
	})
	m.HandleFunc("/api/frame", func(w http.ResponseWriter, r *http.Request) {
		if !s.check(w, r, "GET") {
			return
		}
		b, err := s.bridge.CaptureJPEG()
		if err != nil {
			http.Error(w, "capture unavailable", http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", fmt.Sprint(len(b)))
		_, _ = w.Write(b)
	})
	m.HandleFunc("/api/input", func(w http.ResponseWriter, r *http.Request) {
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
		if err := s.bridge.Apply(cmd); err != nil {
			http.Error(w, "input refused", 409)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	m.HandleFunc("/api/end", func(w http.ResponseWriter, r *http.Request) {
		if !s.check(w, r, "POST") {
			return
		}
		s.mu.Lock()
		s.enabled = false
		s.mu.Unlock()
		s.bridge.Stop()
		w.WriteHeader(http.StatusNoContent)
		go s.cancel()
	})
}
func main() {
	if !approve() {
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
	app := &server{bridge: bridge, token: token, enabled: true, expires: end, host: port}
	app.cancel = func() { _ = httpServer.Close() }
	mux := http.NewServeMux()
	app.routes(mux)
	httpServer.Handler = mux
	// This URL is a locally displayed capability, not an internet-ready share link.
	url := "http://" + port + "/#token=" + token
	fmt.Println("GORIQ Remote Lite: local-only preview. Auto-stop in 15 minutes.")
	fmt.Println("Windows上でこのリンクを開く:", url)
	_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
	time.AfterFunc(time.Until(end), func() { bridge.Stop(); _ = httpServer.Close() })
	if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Println("server stopped:", err)
	}
	bridge.Stop()
}
