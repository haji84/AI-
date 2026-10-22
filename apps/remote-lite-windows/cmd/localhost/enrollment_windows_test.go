//go:build windows

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func enrollmentLinkFor(origin string) string {
	return "goriqremote://enroll?server=" + url.QueryEscape(origin) + "&invite=" + strings.Repeat("a", 48)
}

func TestEnrollmentInvitationRequiresExactHTTPSOrigin(t *testing.T) {
	for _, raw := range []string{
		enrollmentLinkFor("http://127.0.0.1:1234"), enrollmentLinkFor("https://example.test/api"),
		enrollmentLinkFor("https://user:pass@example.test"), enrollmentLinkFor("https://example.test?secret=x"),
		enrollmentLinkFor("https://example.test") + "&extra=1", enrollmentLinkFor("https://example.test") + "&invite=" + strings.Repeat("b", 48),
		"goriqremote://other?server=https%3A%2F%2Fexample.test&invite=" + strings.Repeat("a", 48),
	} {
		if _, _, err := parseEnrollmentLink(raw); err == nil {
			t.Fatalf("invalid invitation accepted: %q", raw)
		}
	}
	origin, _, err := parseEnrollmentLink(enrollmentLinkFor("https://example.test/"))
	if err != nil || origin != "https://example.test" {
		t.Fatalf("valid invitation rejected: %q %v", origin, err)
	}
}

func TestEnrollmentPersistsProtectedIdentityAndRequiresOwnerApproval(t *testing.T) {
	dir := t.TempDir()
	var public ed25519.PublicKey
	var deviceID, fingerprint string
	approved := false
	proposals := 0
	requestID := "01234567-89ab-cdef-0123-456789abcdef"
	challenge := strings.Repeat("b", 48)
	fixture := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var request map[string]json.RawMessage
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid request JSON")
			http.Error(w, "invalid", 400)
			return
		}
		var result any
		switch r.URL.Path {
		case "/v1/device/propose":
			proposals++
			var encoded string
			_ = json.Unmarshal(request["publicKeyPem"], &encoded)
			_ = json.Unmarshal(request["deviceId"], &deviceID)
			block, _ := pem.Decode([]byte(encoded))
			if block == nil {
				t.Error("public SPKI absent")
				return
			}
			key, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err != nil {
				t.Error(err)
				return
			}
			public = key.(ed25519.PublicKey)
			hash := sha256.Sum256(block.Bytes)
			fingerprint = hex.EncodeToString(hash[:])
			journal, err := os.ReadFile(filepath.Join(dir, "enrollment.json"))
			if err != nil || !strings.Contains(string(journal), `"phase":"requesting"`) {
				t.Error("request intent must be durable before sending")
			}
			result = map[string]any{"requestId": requestID, "challenge": challenge, "fingerprint": fingerprint, "expiresAt": time.Now().Add(time.Minute).UnixMilli()}
		case "/v1/device/prove":
			var signature string
			_ = json.Unmarshal(request["signature"], &signature)
			decoded, err := base64.StdEncoding.DecodeString(signature)
			message := strings.Join([]string{"GORIQ_REMOTE_DEVICE_ENROLL_V1", requestID, deviceID, fingerprint, challenge}, "\n")
			if err != nil || !ed25519.Verify(public, []byte(message), decoded) {
				t.Error("proof did not match exact enrollment")
				return
			}
			result = map[string]string{"requestId": requestID, "deviceId": deviceID, "fingerprint": fingerprint, "status": "awaiting-owner-approval"}
		case "/v1/device/pending":
			if !approved {
				http.Error(w, "unapproved", 403)
				return
			}
			var proof struct {
				DeviceID  string `json:"deviceId"`
				IssuedAt  int64  `json:"issuedAt"`
				Nonce     string `json:"nonce"`
				Signature string `json:"signature"`
			}
			if err := json.Unmarshal(request["proof"], &proof); err != nil {
				t.Error(err)
				return
			}
			encodedTime, _ := json.Marshal(proof.IssuedAt)
			message := strings.Join([]string{"GORIQ_REMOTE_DEVICE_DISCOVER_V1", deviceID, string(encodedTime), proof.Nonce}, "\n")
			decoded, _ := base64.StdEncoding.DecodeString(proof.Signature)
			if proof.DeviceID != deviceID || !ed25519.Verify(public, []byte(message), decoded) {
				t.Error("invalid signed approval discovery")
				return
			}
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result})
	}))
	defer fixture.Close()
	manager := newEnrollmentManager(dir, fixture.Client())
	view, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), false)
	if err != nil || view.Phase != "awaiting-owner-approval" || view.RequestID != requestID {
		t.Fatalf("register: %+v %v", view, err)
	}
	before, err := os.ReadFile(filepath.Join(dir, "enrollment.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		ProtectedPrivateKey string `json:"protectedPrivateKey"`
	}
	if json.Unmarshal(before, &stored) != nil || stored.ProtectedPrivateKey == "" {
		t.Fatal("encrypted key absent")
	}
	ciphertext, _ := base64.StdEncoding.DecodeString(stored.ProtectedPrivateKey)
	der, err := unprotectCurrentUser(ciphertext)
	if err != nil {
		t.Fatal("DPAPI key did not decrypt")
	}
	defer clear(der)
	if strings.Contains(string(before), base64.StdEncoding.EncodeToString(der)) {
		t.Fatal("plaintext key persisted")
	}
	manager = newEnrollmentManager(dir, fixture.Client()) // simulate a new EXE instance
	restored, err := manager.View()
	if err != nil || restored.DeviceID != deviceID || restored.Fingerprint != fingerprint || restored.RequestID != requestID {
		t.Fatalf("identity did not survive restart: %+v %v", restored, err)
	}
	if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), false); err == nil || proposals != 1 {
		t.Fatal("uncertain/old request was replayed")
	}
	if _, err := manager.Confirm(context.Background()); err == nil {
		t.Fatal("unapproved device activated")
	}
	configPath := filepath.Join(dir, "active-session.json")
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatal("active configuration exists without owner approval")
	}
	approved = true
	view, err = manager.Confirm(context.Background())
	if err != nil || view.Phase != "approved" {
		t.Fatalf("confirm: %+v %v", view, err)
	}
	gate, err := loadSignedRemoteSession(configPath, fixture.Client())
	if err != nil || !gate.discoveryOnly || gate.deviceID != deviceID {
		t.Fatalf("normal startup cannot load approved identity: %v", err)
	}
	if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), true); err == nil {
		t.Fatal("approved device re-enrolled")
	}
}

func TestEnrollmentLostReplyRetainsIdentityAndRequiresExplicitSameOriginRecovery(t *testing.T) {
	dir := t.TempDir()
	calls := 0
	fixture := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Error(w, "lost", 502) }))
	defer fixture.Close()
	manager := newEnrollmentManager(dir, fixture.Client())
	if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), false); err == nil {
		t.Fatal("failed request accepted")
	}
	view, err := manager.View()
	if err != nil || view.Phase != "requesting" {
		t.Fatalf("uncertainty not saved: %+v %v", view, err)
	}
	if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), false); err == nil || calls != 1 {
		t.Fatal("automatic retry occurred")
	}
	if _, err := manager.Register(context.Background(), enrollmentLinkFor("https://other.invalid"), true); err == nil || calls != 1 {
		t.Fatal("origin replacement allowed")
	}
	if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), true); err == nil || calls != 2 {
		t.Fatal("explicit same-origin retry missing")
	}
	after, err := manager.View()
	if err != nil || after.DeviceID != view.DeviceID || after.Fingerprint != view.Fingerprint {
		t.Fatal("identity regenerated on retry")
	}
	if err := os.WriteFile(filepath.Join(dir, "enrollment.json"), []byte(`{"version":1,"phase":"approved"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.View(); err == nil {
		t.Fatal("corrupt enrollment must be refused")
	}
}

func TestEnrollmentRejectsForeignChallengeAndReceipt(t *testing.T) {
	for _, stage := range []string{"challenge", "receipt"} {
		t.Run(stage, func(t *testing.T) {
			dir := t.TempDir()
			proofCalls := 0
			var fingerprint, deviceID string
			fixture := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				var body map[string]string
				_ = json.NewDecoder(r.Body).Decode(&body)
				var result any
				if r.URL.Path == "/v1/device/propose" {
					deviceID = body["deviceId"]
					block, _ := pem.Decode([]byte(body["publicKeyPem"]))
					if block == nil {
						t.Error("missing SPKI")
						return
					}
					hash := sha256.Sum256(block.Bytes)
					fingerprint = hex.EncodeToString(hash[:])
					if stage == "challenge" {
						fingerprint = strings.Repeat("0", 64)
					}
					result = map[string]any{"requestId": "01234567-89ab-cdef-0123-456789abcdef", "challenge": strings.Repeat("b", 48), "fingerprint": fingerprint, "expiresAt": time.Now().Add(time.Minute).UnixMilli()}
				} else if r.URL.Path == "/v1/device/prove" {
					proofCalls++
					result = map[string]string{"requestId": "01234567-89ab-cdef-0123-456789abcdef", "deviceId": deviceID + "-foreign", "fingerprint": fingerprint, "status": "awaiting-owner-approval"}
				} else {
					t.Error("unexpected request")
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result})
			}))
			defer fixture.Close()
			manager := newEnrollmentManager(dir, fixture.Client())
			if _, err := manager.Register(context.Background(), enrollmentLinkFor(fixture.URL), false); err == nil {
				t.Fatal("foreign proof binding accepted")
			}
			if stage == "challenge" && proofCalls != 0 {
				t.Fatal("signed a foreign challenge")
			}
			if _, err := os.Stat(filepath.Join(dir, "active-session.json")); !os.IsNotExist(err) {
				t.Fatal("foreign receipt activated")
			}
			view, err := manager.View()
			if err != nil || view.Phase != "requesting" {
				t.Fatal("uncertainty was not retained")
			}
		})
	}
}

func TestCanceledEnrollmentDoesNotCreateIdentity(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := newEnrollmentManager(dir, nil).Register(ctx, enrollmentLinkFor("https://example.invalid"), false); err == nil {
		t.Fatal("canceled enrollment accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "enrollment.json")); !os.IsNotExist(err) {
		t.Fatal("canceled request created identity")
	}
}
