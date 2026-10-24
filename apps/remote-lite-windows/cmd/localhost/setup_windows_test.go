//go:build windows

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSetupRejectsForeignRequestsAndHasNoDesktopRoutes(t *testing.T) {
	dir := t.TempDir()
	s := &setupServer{manager: newEnrollmentManager(dir, nil), host: "127.0.0.1:1234", token: strings.Repeat("a", 64), expires: time.Now().Add(time.Minute)}
	for _, test := range []struct {
		path, origin, token string
		want                int
	}{
		{"/api/setup/state", "", s.token, 200},
		{"/api/setup/state", "https://evil.invalid", s.token, 403},
		{"/api/setup/state", "", "wrong", 401},
		{"/api/capture", "", s.token, 404},
		{"/api/remote/input", "", s.token, 404},
	} {
		r := httptest.NewRequest(http.MethodGet, "http://"+s.host+test.path, nil)
		r.RemoteAddr = "127.0.0.1:9999"
		r.Header.Set("X-Goriq-Session", test.token)
		if test.origin != "" {
			r.Header.Set("Origin", test.origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != test.want {
			t.Errorf("%s: got %d want %d", test.path, w.Code, test.want)
		}
	}
	for _, body := range []string{`{"link":"invalid","unexpected":true}`, `{"link":"invalid"}`} {
		r := httptest.NewRequest(http.MethodPost, "http://"+s.host+"/api/setup/register", strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:9999"
		r.Header.Set("X-Goriq-Session", s.token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("mutation without exact origin accepted")
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "enrollment.json")); !os.IsNotExist(err) {
		t.Fatal("denied request created identity")
	}
	for _, body := range []string{`{"link":"invalid","unexpected":true}`, `{"link":"invalid"}`} {
		path := "/api/setup/register"
		if body == `{"link":"invalid"}` {
			path = "/api/setup/recover"
		}
		r := httptest.NewRequest(http.MethodPost, "http://"+s.host+path, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:9999"
		r.Header.Set("Origin", "http://"+s.host)
		r.Header.Set("X-Goriq-Session", s.token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal("unknown fields or unconfirmed recovery accepted")
		}
	}
	s.expires = time.Now().Add(-time.Second)
	r := httptest.NewRequest(http.MethodGet, "http://"+s.host+"/api/setup/state", nil)
	r.RemoteAddr = "127.0.0.1:9999"
	r.Header.Set("X-Goriq-Session", s.token)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("expired setup accepted")
	}
}

func TestSetupDirectoryLockExcludesOtherEXEs(t *testing.T) {
	dir := t.TempDir()
	closeFirst, err := lockEnrollmentDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}
	if closeSecond, err := lockEnrollmentDirectory(dir); err == nil {
		closeSecond()
		closeFirst()
		t.Fatal("second setup acquired same directory")
	}
	closeFirst()
	closeThird, err := lockEnrollmentDirectory(dir)
	if err != nil {
		t.Fatal("closed process lock did not release")
	}
	closeThird()
}
