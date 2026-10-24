//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"testing"
	"time"
)

func TestSessionICEValidatesBindingExpiryAndCanonicalRelay(t *testing.T) {
	now := time.UnixMilli(1000000)
	valid := func() remoteICEConfig {
		return remoteICEConfig{SessionID: "session-a", DeviceID: "windows-a", Mode: "turn-ephemeral-approved-provider", ExpiresAt: 1060000, ServerTime: 1000000,
			ICEServers: []remoteICEServer{{URLs: []string{"turns:relay.example.net:5349?transport=tcp"},
				Username: "1060:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Credential: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 20))}}}
	}
	if err := valid().validate("session-a", "windows-a", now); err != nil {
		t.Fatal(err)
	}
	direct := remoteICEConfig{SessionID: "session-a", DeviceID: "windows-a", Mode: "direct-only", ExpiresAt: 1060000, ServerTime: 1000000, ICEServers: []remoteICEServer{}}
	if err := direct.validate("session-a", "windows-a", now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*remoteICEConfig){
		func(v *remoteICEConfig) { v.SessionID = "other" },
		func(v *remoteICEConfig) { v.DeviceID = "other" },
		func(v *remoteICEConfig) { v.ExpiresAt = 1000000 },
		func(v *remoteICEConfig) { v.ExpiresAt = 1600001 },
		func(v *remoteICEConfig) { v.ServerTime = 0 },
		func(v *remoteICEConfig) { v.ServerTime = 969999 },
		func(v *remoteICEConfig) { v.Mode = "unknown" },
		func(v *remoteICEConfig) { v.ICEServers = nil },
		func(v *remoteICEConfig) { v.ICEServers[0].URLs = []string{"https://unexpected.example"} },
		func(v *remoteICEConfig) { v.ICEServers[0].URLs = []string{"turn:relay.example.net:0"} },
		func(v *remoteICEConfig) { v.ICEServers[0].Username = "wrong" },
		func(v *remoteICEConfig) { v.ICEServers[0].Credential = "wrong" },
	} {
		value := valid()
		mutate(&value)
		if err := value.validate("session-a", "windows-a", now); err == nil {
			t.Fatal("invalid relay accepted")
		}
	}
	full := valid()
	full.ExpiresAt = 1600000
	full.ICEServers[0].Username = "1600:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for _, skew := range []time.Duration{-time.Second, time.Second} {
		if err := full.validate("session-a", "windows-a", now.Add(skew)); err != nil {
			t.Fatal("valid server duration refused with small clock skew", err)
		}
	}
	var result remoteICEConfig
	if err := decodeStatusJSON([]byte(`{"sessionId":"session-a","deviceId":"windows-a","mode":"direct-only","expiresAt":1060000,"iceServers":[],"privateSecret":"never-return"}`), &result); err == nil {
		t.Fatal("unknown relay fields accepted")
	}
}

func TestSessionICESTUNIsCredentialFreeAndBoundToTheActiveDevice(t *testing.T) {
	now := time.UnixMilli(1000000)
	valid := func() remoteICEConfig {
		return remoteICEConfig{SessionID: "session-a", DeviceID: "windows-a", Mode: "stun-approved-provider", ExpiresAt: 2800000, ServerTime: 1000000,
			ICEServers: []remoteICEServer{{URLs: []string{"stun:stun.cloudflare.com:3478"}}}}
	}
	if err := valid().validate("session-a", "windows-a", now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*remoteICEConfig){
		func(v *remoteICEConfig) { v.DeviceID = "other" },
		func(v *remoteICEConfig) { v.SessionID = "other" },
		func(v *remoteICEConfig) { v.ExpiresAt = 1000000 },
		func(v *remoteICEConfig) { v.ICEServers[0].URLs = []string{"stun:localhost:3478"} },
		func(v *remoteICEConfig) { v.ICEServers[0].URLs = []string{"stun:stun.cloudflare.com:53"} },
		func(v *remoteICEConfig) {
			v.ICEServers[0].URLs = append(v.ICEServers[0].URLs, "turn:other.example:3478")
		},
		func(v *remoteICEConfig) { v.ICEServers[0].Username = "unexpected" },
		func(v *remoteICEConfig) { v.ICEServers[0].Credential = "unexpected" },
	} {
		ice := valid()
		mutate(&ice)
		if err := ice.validate("session-a", "windows-a", now); err == nil {
			t.Fatal("invalid STUN configuration accepted")
		}
	}
}
