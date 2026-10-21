//go:build windows

package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRemoteConfigurationAbsentOrInvalidFailsClosed(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	gate, err := configuredSignedRemoteSession(nil)
	if err != nil || gate != nil {
		t.Fatalf("missing enrollment must keep the signed route disabled: gate=%v err=%v", gate, err)
	}
	path, err := remoteSessionPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	bad := activeRemoteSession{Version: 1, StatusServiceURL: "https://example.invalid",
		DeviceID: "windows-test", SessionID: "session-test",
		ProtectedPrivateKey: base64.StdEncoding.EncodeToString([]byte("unencrypted-key"))}
	data, err := json.Marshal(bad)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := configuredSignedRemoteSession(nil); err == nil {
		t.Fatal("unencrypted or corrupted device key must refuse product startup")
	}
}
