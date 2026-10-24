//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type remoteSignal struct {
	Type          string  `json:"type"`
	SDP           string  `json:"sdp,omitempty"`
	Candidate     string  `json:"candidate,omitempty"`
	SDPMid        *string `json:"sdpMid"`
	SDPMLineIndex *int    `json:"sdpMLineIndex"`
}

func (signal remoteSignal) MarshalJSON() ([]byte, error) {
	return canonicalRemoteSignal(signal)
}

func asciiSignal(value string) bool {
	for _, c := range value {
		if c > 127 || c == 0 {
			return false
		}
	}
	return true
}

// canonicalRemoteSignal matches the coordinator's normalized JSON.stringify
// field order, so a signed SHA-256 binds the exact SDP/ICE payload.
func canonicalRemoteSignal(signal remoteSignal) ([]byte, error) {
	var value any
	switch signal.Type {
	case "offer", "answer":
		if len(signal.SDP) < 3 || len(signal.SDP) > 64*1024 || !strings.HasPrefix(signal.SDP, "v=0") || !asciiSignal(signal.SDP) ||
			signal.Candidate != "" || signal.SDPMid != nil || signal.SDPMLineIndex != nil {
			return nil, errors.New("invalid SDP signal")
		}
		value = struct {
			Type string `json:"type"`
			SDP  string `json:"sdp"`
		}{signal.Type, signal.SDP}
	case "candidate":
		if len(signal.Candidate) < 1 || len(signal.Candidate) > 4096 || !asciiSignal(signal.Candidate) ||
			signal.SDP != "" || (signal.SDPMid != nil && (len(*signal.SDPMid) > 64 || !asciiSignal(*signal.SDPMid))) ||
			(signal.SDPMLineIndex != nil && (*signal.SDPMLineIndex < 0 || *signal.SDPMLineIndex > 100)) {
			return nil, errors.New("invalid ICE signal")
		}
		value = struct {
			Type          string  `json:"type"`
			Candidate     string  `json:"candidate"`
			SDPMid        *string `json:"sdpMid"`
			SDPMLineIndex *int    `json:"sdpMLineIndex"`
		}{signal.Type, signal.Candidate, signal.SDPMid, signal.SDPMLineIndex}
	default:
		return nil, errors.New("invalid signal type")
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	if buffer.Len() > 72*1024 {
		return nil, errors.New("signal oversized")
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func (g *signedStatusGate) signalProof(ctx context.Context, operation, payloadHash string) (map[string]string, error) {
	var challenge struct {
		ChallengeID string `json:"challengeId"`
		Challenge   string `json:"challenge"`
		ExpiresAt   int64  `json:"expiresAt"`
	}
	if err := g.post(ctx, "/v1/device/challenge", map[string]string{
		"deviceId": g.deviceID, "sessionId": g.sessionID, "operation": operation, "payloadHash": payloadHash,
	}, &challenge); err != nil {
		return nil, err
	}
	if !statusChallengeID.MatchString(challenge.ChallengeID) || !statusNonce.MatchString(challenge.Challenge) || challenge.ExpiresAt <= g.now().UnixMilli() {
		return nil, errors.New("signal challenge invalid or expired")
	}
	message := []byte("GORIQ_REMOTE_DEVICE_AUTH_V1\n" + g.deviceID + "\n" + operation + "\n" + g.sessionID + "\n" + challenge.ChallengeID + "\n" + challenge.Challenge + "\n" + payloadHash)
	signature, err := g.sign(message)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return nil, errors.New("device signing failed")
	}
	return map[string]string{
		"deviceId": g.deviceID, "sessionId": g.sessionID, "operation": operation,
		"challengeId": challenge.ChallengeID, "payloadHash": payloadHash,
		"signature": base64.StdEncoding.EncodeToString(signature),
	}, nil
}

func (g *signedStatusGate) SendSignal(parent context.Context, signal remoteSignal) error {
	if g == nil || g.discoveryOnly {
		return errors.New("signed session unavailable")
	}
	canonical, err := canonicalRemoteSignal(signal)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	hash := sha256.Sum256(canonical)
	proof, err := g.signalProof(ctx, "signal-send", hex.EncodeToString(hash[:]))
	if err != nil {
		return err
	}
	var result json.RawMessage
	return g.post(ctx, "/v1/device/signal", map[string]any{
		"deviceId": g.deviceID, "sessionId": g.sessionID, "signal": json.RawMessage(canonical), "proof": proof,
	}, &result)
}

type remoteSignalBatch struct {
	Cursor  uint64         `json:"cursor"`
	Signals []remoteSignal `json:"signals"`
}

func (g *signedStatusGate) ReceiveSignals(parent context.Context, ack uint64) (remoteSignalBatch, error) {
	if g == nil || g.discoveryOnly {
		return remoteSignalBatch{}, errors.New("signed session unavailable")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	proof, err := g.signalProof(ctx, "signal-receive", "")
	if err != nil {
		return remoteSignalBatch{}, err
	}
	var raw struct {
		Cursor  uint64            `json:"cursor"`
		Signals []json.RawMessage `json:"signals"`
	}
	if err := g.postLimited(ctx, "/v1/device/poll", map[string]any{
		"deviceId": g.deviceID, "sessionId": g.sessionID, "proof": proof, "ack": ack,
	}, &raw, 96*1024); err != nil {
		return remoteSignalBatch{}, err
	}
	if len(raw.Signals) > 1 || raw.Cursor < ack || raw.Cursor > ack+1 ||
		(len(raw.Signals) == 1) != (raw.Cursor == ack+1) {
		return remoteSignalBatch{}, errors.New("signal batch invalid")
	}
	signals := make([]remoteSignal, 0, len(raw.Signals))
	for _, entry := range raw.Signals {
		var signal remoteSignal
		if err := decodeStatusJSON(entry, &signal); err != nil {
			return remoteSignalBatch{}, errors.New("signal result invalid")
		}
		if _, err := canonicalRemoteSignal(signal); err != nil {
			return remoteSignalBatch{}, err
		}
		signals = append(signals, signal)
	}
	return remoteSignalBatch{Cursor: raw.Cursor, Signals: signals}, nil
}
