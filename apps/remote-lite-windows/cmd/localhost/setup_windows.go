//go:build windows

package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// Holding this ordinary file handle prevents concurrent setup EXEs from
// replacing a registration journal. Windows releases the handle on process exit.
func lockEnrollmentDirectory(directory string) (func(), error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	path, err := syscall.UTF16PtrFromString(filepath.Join(directory, "enrollment.lock"))
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(path, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, errors.New("another setup is open or the registration directory is unavailable")
	}
	return func() { _ = syscall.CloseHandle(h) }, nil
}

// Setup owns no desktop bridge, session signer endpoint, or capture/input route.
type setupServer struct {
	manager *enrollmentManager
	host    string
	token   string
	expires time.Time
	cancel  func()
}

func (s *setupServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	guard := &server{host: s.host}
	if !guard.guard(w, r) {
		return
	}
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	if !time.Now().Before(s.expires) {
		http.Error(w, "setup expired; reopen the app", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/" && r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(setupHTML)
		return
	}
	method := ""
	switch r.URL.Path {
	case "/api/setup/state":
		method = http.MethodGet
	case "/api/setup/preview", "/api/setup/register", "/api/setup/recover", "/api/setup/confirm", "/api/setup/close":
		method = http.MethodPost
	default:
		http.NotFound(w, r)
		return
	}
	if r.Method != method {
		http.Error(w, "method denied", http.StatusMethodNotAllowed)
		return
	}
	if method == http.MethodPost && r.Header.Get("Origin") != "http://"+s.host {
		http.Error(w, "origin denied", http.StatusForbidden)
		return
	}
	candidate := r.Header.Get("X-Goriq-Session")
	if len(candidate) != len(s.token) || subtle.ConstantTimeCompare([]byte(candidate), []byte(s.token)) != 1 {
		http.Error(w, "setup token denied", http.StatusUnauthorized)
		return
	}
	var input struct {
		Link                          string `json:"link"`
		ConfirmedPreviousUnregistered bool   `json:"confirmedPreviousUnregistered"`
	}
	if method == http.MethodPost {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		body, readErr := io.ReadAll(io.LimitReader(r.Body, 4097))
		if err != nil || mediaType != "application/json" || readErr != nil || len(body) > 4096 || decodeStatusJSON(body, &input) != nil {
			http.Error(w, "invalid setup request", http.StatusBadRequest)
			return
		}
	}
	var result any
	var err error
	switch r.URL.Path {
	case "/api/setup/state":
		result, err = s.manager.View()
	case "/api/setup/preview":
		var origin string
		origin, _, err = parseEnrollmentLink(input.Link)
		result = map[string]string{"origin": origin}
	case "/api/setup/register":
		if input.ConfirmedPreviousUnregistered {
			http.Error(w, "unexpected recovery flag", http.StatusBadRequest)
			return
		}
		result, err = s.manager.Register(r.Context(), input.Link, false)
	case "/api/setup/recover":
		if !input.ConfirmedPreviousUnregistered {
			http.Error(w, "explicit owner confirmation required", http.StatusBadRequest)
			return
		}
		result, err = s.manager.Register(r.Context(), input.Link, true)
	case "/api/setup/confirm":
		if input.Link != "" || input.ConfirmedPreviousUnregistered {
			http.Error(w, "unexpected confirmation data", http.StatusBadRequest)
			return
		}
		result, err = s.manager.Confirm(r.Context())
	case "/api/setup/close":
		if input.Link != "" || input.ConfirmedPreviousUnregistered {
			http.Error(w, "unexpected close data", http.StatusBadRequest)
			return
		}
		result = map[string]bool{"closed": true}
		if s.cancel != nil {
			defer time.AfterFunc(100*time.Millisecond, s.cancel)
		}
	}
	if err != nil {
		// Network URLs, invitations, proofs and encrypted key records must not leak in errors.
		http.Error(w, "登録状態を確認できません。保存済みの鍵を保持して、接続先と所有者側の申請状態を確認してください。結果不明の申請は自動再送しません。", http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(result)
}

func runEnrollmentSetup() error {
	configPath, err := remoteSessionPath()
	if err != nil {
		return err
	}
	directory := filepath.Dir(configPath)
	unlock, err := lockEnrollmentDirectory(directory)
	if err != nil {
		return err
	}
	unlockOnReturn := true
	defer func() {
		if unlockOnReturn {
			unlock()
		}
	}()
	// Another setup may have completed between startup and lock acquisition.
	if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
		return errors.New("registration already exists; reopen the app")
	}
	token, err := secret()
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	app := &setupServer{manager: newEnrollmentManager(directory, nil), host: listener.Addr().String(), token: token, expires: time.Now().Add(15 * time.Minute)}
	host := &http.Server{Handler: app, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 12 * time.Second, MaxHeaderBytes: 8192}
	stopped := make(chan struct{})
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			defer close(stopped)
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			if err := host.Shutdown(ctx); err != nil {
				// A blocked disk/DPAPI operation cannot be canceled by HTTP Close.
				// Keep the OS handle until main returns and the process exits; never
				// admit another EXE while an old writer might still be running.
				unlockOnReturn = false
				_ = host.Close()
			}
		})
	}
	app.cancel = stop
	end := time.AfterFunc(time.Until(app.expires), stop)
	defer end.Stop()
	url := "http://" + app.host + "/#token=" + token
	if err := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start(); err != nil {
		return errors.New("could not open local setup browser")
	}
	err = host.Serve(listener)
	stop()
	<-stopped // retain the directory lock until in-flight setup requests have drained
	if !unlockOnReturn {
		return errors.New("setup shutdown unconfirmed; registration retained")
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
