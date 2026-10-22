//go:build windows

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type remoteICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
}

type remoteICEConfig struct {
	SessionID  string            `json:"sessionId"`
	DeviceID   string            `json:"deviceId"`
	Mode       string            `json:"mode"`
	ExpiresAt  int64             `json:"expiresAt"`
	ServerTime int64             `json:"serverTime"`
	ICEServers []remoteICEServer `json:"iceServers"`
}

var turnURL = regexp.MustCompile(`^turns?:[A-Za-z0-9.-]+(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$`)
var turnUsername = regexp.MustCompile(`^[1-9][0-9]{0,12}:[a-f0-9]{32}$`)

func (ice remoteICEConfig) validate(sessionID, deviceID string, now time.Time) error {
	invalid := errors.New("session relay configuration invalid")
	t := now.UnixMilli()
	if ice.SessionID != sessionID || ice.DeviceID != deviceID || !statusID.MatchString(ice.SessionID) ||
		!statusID.MatchString(ice.DeviceID) || t <= 0 || t > 9007199254740991 ||
		ice.ServerTime <= 0 || ice.ServerTime > 9007199254740991 || ice.ServerTime < t-30000 || ice.ServerTime > t+30000 ||
		ice.ExpiresAt <= ice.ServerTime || ice.ExpiresAt > ice.ServerTime+3600000 || ice.ICEServers == nil {
		return invalid
	}
	if ice.Mode == "direct-only" {
		if len(ice.ICEServers) != 0 {
			return invalid
		}
		return nil
	}
	if ice.Mode != "turn-ephemeral-approved-provider" || len(ice.ICEServers) < 1 || len(ice.ICEServers) > 4 || ice.ExpiresAt > ice.ServerTime+600000 {
		return invalid
	}
	for _, server := range ice.ICEServers {
		if len(server.URLs) < 1 || len(server.URLs) > 4 || !turnUsername.MatchString(server.Username) || len(server.Credential) != 28 {
			return invalid
		}
		seconds, err := strconv.ParseInt(strings.SplitN(server.Username, ":", 2)[0], 10, 64)
		if err != nil || seconds*1000 != ice.ExpiresAt {
			return invalid
		}
		decoded, err := base64.StdEncoding.DecodeString(server.Credential)
		if err != nil || len(decoded) != 20 || base64.StdEncoding.EncodeToString(decoded) != server.Credential {
			return invalid
		}
		for _, url := range server.URLs {
			match := turnURL.FindStringSubmatch(url)
			if len(url) > 256 || strings.Contains(url, "..") || match == nil {
				return invalid
			}
			if match[1] != "" {
				port, err := strconv.Atoi(match[1])
				if err != nil || port < 1 || port > 65535 {
					return invalid
				}
			}
		}
	}
	return nil
}

func (g *signedStatusGate) SessionICE(parent context.Context) (remoteICEConfig, error) {
	var ice remoteICEConfig
	if g == nil || g.discoveryOnly {
		return ice, errors.New("signed session unavailable")
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	proof, err := g.signalProof(ctx, "session-ice", "")
	if err != nil {
		return ice, err
	}
	if err := g.post(ctx, "/v1/device/ice", map[string]any{
		"sessionId": g.sessionID, "deviceId": g.deviceID, "proof": proof,
	}, &ice); err != nil {
		return remoteICEConfig{}, err
	}
	if err := ice.validate(g.sessionID, g.deviceID, g.now()); err != nil {
		return remoteICEConfig{}, err
	}
	return ice, nil
}

type remoteICEProvider interface {
	SessionICE(context.Context) (remoteICEConfig, error)
}

func (s *server) iceRoutes(m *http.ServeMux) {
	m.HandleFunc("/api/remote/ice", s.requireSignedRemote(func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, http.MethodGet) {
			return
		}
		if r.URL.RawQuery != "" {
			http.Error(w, "relay query refused", http.StatusBadRequest)
			return
		}
		provider, ok := s.remoteStatus.(remoteICEProvider)
		if !ok {
			http.Error(w, "signed relay configuration unavailable", http.StatusServiceUnavailable)
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		ice, err := provider.SessionICE(r.Context())
		if err != nil {
			if !s.allowRemote(w, r, false) {
				return
			}
			http.Error(w, "relay configuration refused", http.StatusBadGateway)
			return
		}
		if !s.check(w, r, http.MethodGet) || !s.allowRemote(w, r, false) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(ice)
	}))
}
