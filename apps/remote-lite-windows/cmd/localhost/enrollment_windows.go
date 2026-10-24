//go:build windows

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type enrollmentView struct {
	Phase       string `json:"phase"`
	Origin      string `json:"origin"`
	DeviceID    string `json:"deviceId"`
	Fingerprint string `json:"fingerprint"`
	RequestID   string `json:"requestId"`
}

// The private half is always DPAPI-protected on disk and never returned to the UI.
type enrollmentRecord struct {
	Version             int      `json:"version"`
	Phase               string   `json:"phase"`
	Origin              string   `json:"origin"`
	DeviceID            string   `json:"deviceId"`
	Fingerprint         string   `json:"fingerprint"`
	RequestID           string   `json:"requestId"`
	PreviousRequestIDs  []string `json:"previousRequestIds"`
	ProtectedPrivateKey string   `json:"protectedPrivateKey"`
}

func (r enrollmentRecord) view() enrollmentView {
	return enrollmentView{r.Phase, r.Origin, r.DeviceID, r.Fingerprint, r.RequestID}
}

type enrollmentManager struct {
	mu        sync.Mutex
	directory string
	client    *http.Client
}

func newEnrollmentManager(directory string, client *http.Client) *enrollmentManager {
	return &enrollmentManager{directory: directory, client: client}
}

func enrollmentOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 1024 || u.Scheme != "https" || u.Host == "" || u.Hostname() == "" ||
		u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		u.RawFragment != "" || u.RawPath != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("enrollment requires an HTTPS origin")
	}
	u.Host = strings.ToLower(u.Host)
	u.Path = ""
	return u.String(), nil
}

func parseEnrollmentLink(raw string) (string, string, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || u.Scheme != "goriqremote" || u.Host != "enroll" ||
		u.User != nil || u.Opaque != "" || u.Path != "" || u.Fragment != "" {
		return "", "", errors.New("invalid invitation")
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(q) != 2 || len(q["server"]) != 1 || len(q["invite"]) != 1 || !statusNonce.MatchString(q.Get("invite")) {
		return "", "", errors.New("invalid invitation fields")
	}
	origin, err := enrollmentOrigin(q.Get("server"))
	return origin, q.Get("invite"), err
}

func protectCurrentUser(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 || len(plaintext) > 4096 {
		return nil, errors.New("device key size denied")
	}
	input := dataBlob{Size: uint32(len(plaintext)), Data: &plaintext[0]}
	var output dataBlob
	protect := crypt32.NewProc("CryptProtectData")
	ok, _, _ := protect.Call(uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0,
		0x00000001, uintptr(unsafe.Pointer(&output))) // current user, UI forbidden; never LOCAL_MACHINE
	runtime.KeepAlive(plaintext)
	if output.Data != nil {
		defer localFree.Call(uintptr(unsafe.Pointer(output.Data)))
	}
	if ok == 0 || output.Data == nil || output.Size == 0 || output.Size > 8192 {
		return nil, errors.New("device key protection failed")
	}
	return append([]byte(nil), unsafe.Slice(output.Data, output.Size)...), nil
}

func writeEnrollmentFile(path string, value any, replace bool) error {
	data, err := json.Marshal(value)
	if err != nil || len(data) > 16384 {
		return errors.New("enrollment record invalid")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".enrollment-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name) // only this call's disposable temporary file
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if replace {
		return os.Rename(name, path)
	}
	// Windows MoveFile refuses an existing destination: no other registration is overwritten.
	from, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	to, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return syscall.MoveFile(from, to)
}

func (m *enrollmentManager) load() (*enrollmentRecord, ed25519.PrivateKey, error) {
	f, err := os.Open(filepath.Join(m.directory, "enrollment.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 16385))
	var record enrollmentRecord
	if err != nil || len(data) > 16384 || decodeStatusJSON(data, &record) != nil || record.Version != 1 ||
		!statusID.MatchString(record.DeviceID) || len(record.PreviousRequestIDs) > 32 ||
		(record.Phase != "requesting" && record.Phase != "awaiting-owner-approval" && record.Phase != "approved") ||
		(record.RequestID != "" && !statusChallengeID.MatchString(record.RequestID)) ||
		(record.Phase != "requesting" && record.RequestID == "") {
		return nil, nil, errors.New("saved enrollment is invalid; preserve it for recovery")
	}
	origin, err := enrollmentOrigin(record.Origin)
	if err != nil || origin != record.Origin {
		return nil, nil, errors.New("saved enrollment origin invalid")
	}
	seen := map[string]bool{record.RequestID: true}
	for _, id := range record.PreviousRequestIDs {
		if !statusChallengeID.MatchString(id) || seen[id] {
			return nil, nil, errors.New("saved enrollment history invalid")
		}
		seen[id] = true
	}
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(record.ProtectedPrivateKey)
	if err != nil {
		return nil, nil, errors.New("saved device key invalid")
	}
	der, err := unprotectCurrentUser(ciphertext)
	if err != nil {
		return nil, nil, err
	}
	defer clear(der)
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, nil, errors.New("saved device key format invalid")
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return nil, nil, errors.New("saved device key type invalid")
	}
	spki, _ := x509.MarshalPKIXPublicKey(key.Public())
	hash := sha256.Sum256(spki)
	if record.Fingerprint != hex.EncodeToString(hash[:]) {
		clear(key)
		return nil, nil, errors.New("saved key fingerprint mismatch")
	}
	return &record, key, nil
}

func (m *enrollmentManager) View() (enrollmentView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, key, err := m.load()
	defer clear(key)
	if err != nil {
		return enrollmentView{}, err
	}
	if r == nil {
		return enrollmentView{Phase: "new"}, nil
	}
	return r.view(), nil
}

func (m *enrollmentManager) save(r *enrollmentRecord, replace bool) error {
	return writeEnrollmentFile(filepath.Join(m.directory, "enrollment.json"), r, replace)
}

func (m *enrollmentManager) Register(ctx context.Context, link string, recovery bool) (enrollmentView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return enrollmentView{}, err
	}
	origin, invite, err := parseEnrollmentLink(link)
	if err != nil {
		return enrollmentView{}, err
	}
	r, key, err := m.load()
	if err != nil {
		return enrollmentView{}, err
	}
	if r == nil {
		if recovery {
			return enrollmentView{}, errors.New("no previous request to recover")
		}
		if _, err := os.Stat(filepath.Join(m.directory, "active-session.json")); !errors.Is(err, os.ErrNotExist) {
			return enrollmentView{}, errors.New("existing active configuration must be preserved")
		}
		_, key, err = ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return enrollmentView{}, err
		}
		defer clear(key)
		der, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return enrollmentView{}, err
		}
		protected, err := protectCurrentUser(der)
		clear(der)
		if err != nil {
			return enrollmentView{}, err
		}
		spki, _ := x509.MarshalPKIXPublicKey(key.Public())
		hash := sha256.Sum256(spki)
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			return enrollmentView{}, err
		}
		r = &enrollmentRecord{Version: 1, Phase: "requesting", Origin: origin,
			DeviceID: "windows-" + hex.EncodeToString(id), Fingerprint: hex.EncodeToString(hash[:]),
			ProtectedPrivateKey: base64.StdEncoding.EncodeToString(protected)}
		if err := os.MkdirAll(m.directory, 0700); err != nil {
			return enrollmentView{}, err
		}
		if err := m.save(r, false); err != nil {
			return enrollmentView{}, err
		}
	} else {
		defer clear(key)
		if !recovery || r.Phase == "approved" || r.Origin != origin || len(r.PreviousRequestIDs) >= 32 {
			return enrollmentView{}, errors.New("explicit same-origin recovery of an unapproved request required")
		}
		r.Phase = "requesting"
		if err := m.save(r, true); err != nil {
			return enrollmentView{}, err
		}
	}
	gate, err := newSignedStatusGate(origin, r.DeviceID, r.DeviceID, func(p []byte) ([]byte, error) { return ed25519.Sign(key, p), nil }, m.client)
	if err != nil {
		return enrollmentView{}, err
	}
	spki, _ := x509.MarshalPKIXPublicKey(key.Public())
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: spki}))
	start := time.Now()
	var challenge struct {
		RequestID   string `json:"requestId"`
		Challenge   string `json:"challenge"`
		Fingerprint string `json:"fingerprint"`
		ExpiresAt   int64  `json:"expiresAt"`
	}
	if err := gate.post(ctx, "/v1/device/propose", map[string]string{"inviteCode": invite, "deviceId": r.DeviceID, "publicKeyPem": publicPEM}, &challenge); err != nil {
		return r.view(), err
	}
	if !statusChallengeID.MatchString(challenge.RequestID) || !statusNonce.MatchString(challenge.Challenge) ||
		challenge.Fingerprint != r.Fingerprint || challenge.ExpiresAt <= 0 || challenge.ExpiresAt > 9007199254740991 || time.Since(start) >= time.Minute {
		return r.view(), errors.New("enrollment challenge does not match this device")
	}
	if challenge.RequestID == r.RequestID {
		return r.view(), errors.New("enrollment request replay refused")
	}
	for _, id := range r.PreviousRequestIDs {
		if challenge.RequestID == id {
			return r.view(), errors.New("old enrollment request replay refused")
		}
	}
	if err := ctx.Err(); err != nil {
		return r.view(), err
	}
	if r.RequestID != "" {
		r.PreviousRequestIDs = append(r.PreviousRequestIDs, r.RequestID)
	}
	r.RequestID = challenge.RequestID
	if err := m.save(r, true); err != nil {
		return r.view(), err
	}
	message := strings.Join([]string{"GORIQ_REMOTE_DEVICE_ENROLL_V1", r.RequestID, r.DeviceID, r.Fingerprint, challenge.Challenge}, "\n")
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(message)))
	var receipt struct {
		RequestID   string `json:"requestId"`
		DeviceID    string `json:"deviceId"`
		Fingerprint string `json:"fingerprint"`
		Status      string `json:"status"`
	}
	if time.Since(start) >= time.Minute {
		return r.view(), errors.New("enrollment proof expired locally")
	}
	if err := gate.post(ctx, "/v1/device/prove", map[string]string{"requestId": r.RequestID, "signature": signature}, &receipt); err != nil {
		return r.view(), err
	}
	if receipt.RequestID != r.RequestID || receipt.DeviceID != r.DeviceID || receipt.Fingerprint != r.Fingerprint || receipt.Status != "awaiting-owner-approval" {
		return r.view(), errors.New("enrollment receipt does not match this device")
	}
	if err := ctx.Err(); err != nil {
		return r.view(), err
	}
	r.Phase = receipt.Status
	if err := m.save(r, true); err != nil {
		return r.view(), err
	}
	return r.view(), nil
}

func (m *enrollmentManager) Confirm(ctx context.Context) (enrollmentView, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return enrollmentView{}, err
	}
	r, key, err := m.load()
	defer clear(key)
	if err != nil {
		return enrollmentView{}, err
	}
	if r == nil || r.RequestID == "" {
		return enrollmentView{}, errors.New("enrollment receipt required")
	}
	gate, err := newSignedStatusGate(r.Origin, r.DeviceID, r.DeviceID, func(p []byte) ([]byte, error) { return ed25519.Sign(key, p), nil }, m.client)
	if err != nil {
		return r.view(), err
	}
	gate.discoveryOnly = true
	if _, err := gate.DiscoverPending(ctx); err != nil {
		return r.view(), err
	}
	if err := ctx.Err(); err != nil {
		return r.view(), err
	}
	// A null pending result still proves the registered identity via signed discovery.
	r.Phase = "approved"
	if err := m.save(r, true); err != nil {
		return r.view(), err
	}
	config := activeRemoteSession{Version: 2, StatusServiceURL: r.Origin, DeviceID: r.DeviceID, ProtectedPrivateKey: r.ProtectedPrivateKey}
	path := filepath.Join(m.directory, "active-session.json")
	f, openErr := os.Open(path)
	if openErr == nil {
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, 16385))
		var existing activeRemoteSession
		if err != nil || len(data) > 16384 || decodeStatusJSON(data, &existing) != nil || existing != config {
			return r.view(), errors.New("different active configuration must be preserved")
		}
	} else if !errors.Is(openErr, os.ErrNotExist) {
		return r.view(), openErr
	} else if err := writeEnrollmentFile(path, config, false); err != nil {
		return r.view(), err
	}
	return r.view(), nil
}
