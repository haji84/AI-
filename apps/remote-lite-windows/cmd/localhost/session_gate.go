//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

const maxStatusResponse = 8192

var (
	statusID          = regexp.MustCompile(`^[a-zA-Z0-9._:-]{1,128}$`)
	statusChallengeID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	statusNonce       = regexp.MustCompile(`^[0-9a-f]{48}$`)
)

// signedStatusGate keeps the device signer inside the native host. It obtains
// a fresh, operation-bound challenge for every status check and never hands
// signing authority to the local browser or a WebRTC peer.
type signedStatusGate struct {
	baseURL   *url.URL
	deviceID  string
	sessionID string
	sign      func([]byte) ([]byte, error)
	client    *http.Client
	now       func() time.Time
}

type pendingRemoteSession struct {
	SessionID string `json:"sessionId"`
	DeviceID  string `json:"deviceId"`
	Status    string `json:"status"`
	ExpiresAt int64  `json:"expiresAt"`
}

func newSignedStatusGate(rawURL, deviceID, sessionID string, sign func([]byte) ([]byte, error), client *http.Client) (*signedStatusGate, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("invalid status service URL")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, errors.New("status service requires HTTPS or loopback")
	}
	if !statusID.MatchString(deviceID) || !statusID.MatchString(sessionID) || sign == nil {
		return nil, errors.New("invalid signed status identity")
	}
	if client == nil {
		client = http.DefaultClient
	}
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	copyClient.Jar = nil
	if copyClient.Timeout == 0 || copyClient.Timeout > 3*time.Second {
		copyClient.Timeout = 3 * time.Second
	}
	return &signedStatusGate{baseURL: u, deviceID: deviceID, sessionID: sessionID, sign: sign, client: &copyClient, now: time.Now}, nil
}

func decodeStatusJSON(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing status response")
	}
	return nil
}

func (g *signedStatusGate) post(ctx context.Context, path string, body any, result any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	u := g.baseURL.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	response, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("status service refused request: HTTP %d", response.StatusCode)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("status service returned non-JSON data")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxStatusResponse+1))
	if err != nil || len(data) > maxStatusResponse {
		return errors.New("status response unavailable or oversized")
	}
	var envelope struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
	}
	if err := decodeStatusJSON(data, &envelope); err != nil || !envelope.OK || len(envelope.Result) == 0 {
		return errors.New("status response invalid")
	}
	if err := decodeStatusJSON(envelope.Result, result); err != nil {
		return errors.New("status result invalid")
	}
	return nil
}

// Check never caches a positive status. A denied or uncertain result must
// prevent the next frame/input; the caller is responsible for stopping media
// and releasing held input when Check fails.
func (g *signedStatusGate) Check(parent context.Context) error {
	if g == nil {
		return errors.New("signed status gate unavailable")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	var challenge struct {
		ChallengeID string `json:"challengeId"`
		Challenge   string `json:"challenge"`
		ExpiresAt   int64  `json:"expiresAt"`
	}
	if err := g.post(ctx, "/v1/device/challenge", map[string]string{
		"deviceId": g.deviceID, "operation": "session-status", "sessionId": g.sessionID,
	}, &challenge); err != nil {
		return err
	}
	if !statusChallengeID.MatchString(challenge.ChallengeID) || !statusNonce.MatchString(challenge.Challenge) || challenge.ExpiresAt <= g.now().UnixMilli() {
		return errors.New("status challenge invalid or expired")
	}
	message := []byte("GORIQ_REMOTE_DEVICE_AUTH_V1\n" + g.deviceID + "\nsession-status\n" + g.sessionID + "\n" + challenge.ChallengeID + "\n" + challenge.Challenge + "\n")
	signature, err := g.sign(message)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("device signing failed")
	}
	var status struct {
		SessionID string `json:"sessionId"`
		DeviceID  string `json:"deviceId"`
		Status    string `json:"status"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if err := g.post(ctx, "/v1/device/status", map[string]any{
		"sessionId": g.sessionID, "deviceId": g.deviceID,
		"proof": map[string]string{
			"deviceId": g.deviceID, "operation": "session-status", "sessionId": g.sessionID,
			"challengeId": challenge.ChallengeID, "signature": base64.StdEncoding.EncodeToString(signature),
		},
	}, &status); err != nil {
		return err
	}
	if status.SessionID != g.sessionID || status.DeviceID != g.deviceID || status.Status != "active" || status.ExpiresAt <= g.now().UnixMilli() {
		return errors.New("device session inactive or mismatched")
	}
	return nil
}

// DiscoverPending asks the coordinator for this registered device's single
// pending request. The response carries no viewer token and grants no capture
// or input authority; a separate locally approved acceptance is still needed.
func (g *signedStatusGate) DiscoverPending(parent context.Context) (*pendingRemoteSession, error) {
	if g == nil {
		return nil, errors.New("signed device identity unavailable")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nil, errors.New("discovery nonce unavailable")
	}
	nonce := hex.EncodeToString(nonceBytes)
	issuedAt := g.now().UnixMilli()
	message := []byte("GORIQ_REMOTE_DEVICE_DISCOVER_V1\n" + g.deviceID + "\n" + strconv.FormatInt(issuedAt, 10) + "\n" + nonce)
	signature, err := g.sign(message)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return nil, errors.New("device signing failed")
	}
	var pending *pendingRemoteSession
	if err := g.post(ctx, "/v1/device/pending", map[string]any{
		"deviceId": g.deviceID,
		"proof": map[string]any{
			"deviceId": g.deviceID, "issuedAt": issuedAt, "nonce": nonce,
			"signature": base64.StdEncoding.EncodeToString(signature),
		},
	}, &pending); err != nil {
		return nil, err
	}
	if pending == nil {
		return nil, nil
	}
	if !statusID.MatchString(pending.SessionID) || pending.DeviceID != g.deviceID || pending.Status != "pending" || pending.ExpiresAt <= g.now().UnixMilli() {
		return nil, errors.New("pending session invalid or mismatched")
	}
	return pending, nil
}
