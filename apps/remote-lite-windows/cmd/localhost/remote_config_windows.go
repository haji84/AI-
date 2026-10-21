//go:build windows

package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

// This file is populated only after a separately approved device-enrollment
// flow. It is never shipped with the EXE and is never created on first launch.
type activeRemoteSession struct {
	Version              int    `json:"version"`
	StatusServiceURL     string `json:"statusServiceUrl"`
	DeviceID             string `json:"deviceId"`
	SessionID            string `json:"sessionId"`
	ProtectedPrivateKey string `json:"protectedPrivateKey"`
}

type dataBlob struct {
	Size uint32
	Data *byte
}

var (
	crypt32            = syscall.NewLazyDLL("crypt32.dll")
	cryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	localFree          = syscall.NewLazyDLL("kernel32.dll").NewProc("LocalFree")
)

func remoteSessionPath() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" || !filepath.IsAbs(base) {
		return "", errors.New("Windows local app data directory unavailable")
	}
	return filepath.Join(base, "GORIQ Remote Lite", "active-session.json"), nil
}

// DPAPI uses the current Windows user's protection scope. Never request the
// machine-wide scope, which would let other accounts on the PC decrypt it.
func unprotectCurrentUser(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 || len(ciphertext) > 8192 {
		return nil, errors.New("protected device key size denied")
	}
	input := dataBlob{Size: uint32(len(ciphertext)), Data: &ciphertext[0]}
	var output dataBlob
	ok, _, _ := cryptUnprotectData.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0,
		0x00000001, uintptr(unsafe.Pointer(&output))) // CRYPTPROTECT_UI_FORBIDDEN
	runtime.KeepAlive(ciphertext)
	if ok == 0 || output.Data == nil || output.Size == 0 || output.Size > 8192 {
		if output.Data != nil {
			localFree.Call(uintptr(unsafe.Pointer(output.Data)))
		}
		return nil, errors.New("device key cannot be unlocked for this Windows user")
	}
	defer func() {
		clear(unsafe.Slice(output.Data, output.Size))
		localFree.Call(uintptr(unsafe.Pointer(output.Data)))
	}()
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}

func loadSignedRemoteSession(path string, client *http.Client) (*signedStatusGate, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 16*1024+1))
	if err != nil || len(data) > 16*1024 {
		return nil, errors.New("remote session file unavailable or oversized")
	}
	var config activeRemoteSession
	if err := decodeStatusJSON(data, &config); err != nil || config.Version != 1 {
		return nil, errors.New("remote session configuration invalid")
	}
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(config.ProtectedPrivateKey)
	if err != nil {
		return nil, errors.New("protected device key invalid")
	}
	keyDER, err := unprotectCurrentUser(ciphertext)
	if err != nil {
		return nil, err
	}
	defer func() { clear(keyDER) }()
	parsed, err := x509.ParsePKCS8PrivateKey(keyDER)
	if err != nil {
		return nil, errors.New("device key format invalid")
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("device key type invalid")
	}
	key = append(ed25519.PrivateKey(nil), key...)
	gate, err := newSignedStatusGate(config.StatusServiceURL, config.DeviceID, config.SessionID,
		func(message []byte) ([]byte, error) { return ed25519.Sign(key, message), nil }, client)
	if err != nil {
		return nil, fmt.Errorf("remote session configuration invalid: %w", err)
	}
	return gate, nil
}

func configuredSignedRemoteSession(client *http.Client) (*signedStatusGate, error) {
	path, err := remoteSessionPath()
	if err != nil {
		return nil, err
	}
	gate, err := loadSignedRemoteSession(path, client)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return gate, err
}
