//go:build windows

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSignedStatusGateRequiresDeviceProofAndFreshMatchingStatus(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	active, wrongDevice, expired := true, false, false
	challengeID := "51c18b98-f073-4c32-a8e7-79e5cff81837"
	nonce := strings.Repeat("a", 48)
	requests := 0
	coordinator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/v1/device/challenge" {
			var request struct {
				DeviceID  string `json:"deviceId"`
				SessionID string `json:"sessionId"`
				Operation string `json:"operation"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.DeviceID != "windows-a" || request.SessionID != "session-a" || request.Operation != "session-status" {
				t.Errorf("wrong challenge request: %+v, %v", request, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{
				"challengeId": challengeID, "challenge": nonce, "expiresAt": now.Add(time.Minute).UnixMilli(),
			}})
			return
		}
		if r.URL.Path == "/v1/device/status" {
			var request struct {
				DeviceID  string `json:"deviceId"`
				SessionID string `json:"sessionId"`
				Proof     struct {
					DeviceID    string `json:"deviceId"`
					SessionID   string `json:"sessionId"`
					Operation   string `json:"operation"`
					ChallengeID string `json:"challengeId"`
					Signature   string `json:"signature"`
				} `json:"proof"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			message := strings.Join([]string{"GORIQ_REMOTE_DEVICE_AUTH_V1", "windows-a", "session-status", "session-a", challengeID, nonce, ""}, "\n")
			signature, err := base64.StdEncoding.DecodeString(request.Proof.Signature)
			if err != nil || !ed25519.Verify(public, []byte(message), signature) || request.DeviceID != "windows-a" || request.SessionID != "session-a" || request.Proof.DeviceID != "windows-a" || request.Proof.SessionID != "session-a" || request.Proof.Operation != "session-status" || request.Proof.ChallengeID != challengeID {
				t.Errorf("invalid signed status proof: %+v", request)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			deviceID := "windows-a"
			if wrongDevice {
				deviceID = "windows-b"
			}
			status := "active"
			if !active {
				status = "closed"
			}
			expiresAt := now.Add(time.Minute).UnixMilli()
			if expired {
				expiresAt = now.Add(-time.Second).UnixMilli()
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{
				"sessionId": "session-a", "deviceId": deviceID, "status": status, "expiresAt": expiresAt,
			}})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer coordinator.Close()
	gate, err := newSignedStatusGate(coordinator.URL, "windows-a", "session-a", func(message []byte) ([]byte, error) {
		return ed25519.Sign(private, message), nil
	}, coordinator.Client())
	if err != nil {
		t.Fatal(err)
	}
	gate.now = func() time.Time { return now }
	if err := gate.Check(context.Background()); err != nil || requests != 2 {
		t.Fatalf("active signed status failed: %v, requests=%d", err, requests)
	}
	for _, variant := range []struct {
		name string
		set  func()
	}{
		{"revoked", func() { active = false }},
		{"wrong device", func() { active = true; wrongDevice = true }},
		{"expired", func() { wrongDevice = false; expired = true }},
	} {
		variant.set()
		if err := gate.Check(context.Background()); err == nil {
			t.Fatalf("%s status was accepted", variant.name)
		}
	}
}
