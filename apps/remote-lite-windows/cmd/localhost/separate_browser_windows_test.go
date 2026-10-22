//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"goriq-remote-lite-windows/winbridge"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type vmQueuedSignal struct {
	sequence uint64
	signal   remoteSignal
}

type vmSignalQueue struct {
	next      uint64
	delivered uint64
	acked     uint64
	items     []vmQueuedSignal
}

func (q *vmSignalQueue) add(signal remoteSignal) error {
	if len(q.items) >= 64 {
		return errors.New("VM signal queue full")
	}
	q.next++
	q.items = append(q.items, vmQueuedSignal{q.next, signal})
	return nil
}

func (q *vmSignalQueue) poll(ack uint64) (remoteSignalBatch, error) {
	if ack > q.delivered {
		return remoteSignalBatch{}, errors.New("VM signal acknowledgement invalid")
	}
	if ack > q.acked {
		q.acked = ack
	}
	for len(q.items) > 0 && q.items[0].sequence <= q.acked {
		q.items = q.items[1:]
	}
	batch := remoteSignalBatch{Cursor: q.acked, Signals: []remoteSignal{}}
	if len(q.items) > 0 {
		batch.Cursor = q.items[0].sequence
		batch.Signals = append(batch.Signals, q.items[0].signal)
		q.delivered = batch.Cursor
	}
	return batch, nil
}

// The disposable VM gate uses the real signed-status fixture while keeping
// owner/viewer signaling inside this isolated test server. Product routes still
// require the ordinary native token, status checks and local approval.
type vmSeparateSignalGate struct {
	status statusChecker
	mu     sync.Mutex
	viewer vmSignalQueue
	host   vmSignalQueue
}

func (g *vmSeparateSignalGate) Check(ctx context.Context) error { return g.status.Check(ctx) }
func (g *vmSeparateSignalGate) SessionICE(ctx context.Context) (remoteICEConfig, error) {
	if err := g.Check(ctx); err != nil {
		return remoteICEConfig{}, err
	}
	return remoteICEConfig{SessionID: "session-a", DeviceID: "windows-a", Mode: "direct-only",
		ExpiresAt: time.Now().Add(time.Minute).UnixMilli(), ServerTime: time.Now().UnixMilli(), ICEServers: []remoteICEServer{}}, nil
}
func (g *vmSeparateSignalGate) SendSignal(_ context.Context, signal remoteSignal) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.host.add(signal)
}
func (g *vmSeparateSignalGate) ReceiveSignals(_ context.Context, ack uint64) (remoteSignalBatch, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.viewer.poll(ack)
}

const vmViewerPage = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<video id="remoteVideo" autoplay muted playsinline></video><p id="viewerStatus">loading</p>
<script type="module">
import { BrowserManualPeer } from '/browser-webrtc.mjs';
const video=document.querySelector('#remoteVideo');
const status=document.querySelector('#viewerStatus');
let ack=0;
const peer=new BrowserManualPeer({role:'viewer',rtcFactory:config=>{
  const pc=new RTCPeerConnection(config);
  const create=pc.createDataChannel.bind(pc);
  pc.createDataChannel=(...args)=>{const channel=create(...args);window.vmViewerChannel=channel;return channel};
  return pc;
},iceServers:[],
  sendSignal:async signal=>{const r=await fetch('/vm/viewer/signal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signal)});if(!r.ok)throw Error('signal refused')},
  onStream:stream=>{video.srcObject=stream;video.play().catch(()=>{status.textContent='video failed'})},
  onManualAcknowledged:sequence=>{status.textContent='manual-ack:'+sequence},
  onState:state=>{if(peer.closed){video.srcObject=null;status.textContent=state}},
});
window.vmViewer=peer;
async function poll(){if(peer.closed)return;try{
  const r=await fetch('/vm/viewer/poll?ack='+ack,{cache:'no-store'});if(!r.ok)throw Error('poll refused');
  const batch=await r.json();if(!Number.isSafeInteger(batch.cursor)||batch.cursor<ack||batch.cursor>ack+1||
    !Array.isArray(batch.signals)||batch.signals.length>1||(batch.signals.length===1)!==(batch.cursor===ack+1))throw Error('invalid batch');
  for(const signal of batch.signals)await peer.receiveSignal(signal);
  ack=batch.cursor;setTimeout(poll,250);
}catch{peer.close('signal-failed')}}
peer.startViewer().then(poll).catch(()=>peer.close('offer-failed'));
</script></body></html>`

func TestWindowsVMSeparateChromiumSignedPeer(t *testing.T) {
	if os.Getenv("GORIQ_REMOTE_LITE_VM_NATIVE") != "1" {
		t.Skip("enable on disposable Windows CI VM")
	}
	bridge := new(winbridge.Bridge)
	if err := bridge.AuthorizeLocalUse(time.Now().Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridge.Stop() })
	active := true
	status := &revocableStatusGate{base: signedRouteFixture(t, &active)}
	gate := &vmSeparateSignalGate{status: status}
	token := strings.Repeat("e", 64)
	app := newHostServer(bridge, gate, token, time.Now().Add(2*time.Minute), "")
	mux := http.NewServeMux()
	app.routes(mux)
	mux.HandleFunc("/vm/viewer", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/vm/viewer" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, vmViewerPage)
	})
	mux.HandleFunc("/vm/viewer/signal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method denied", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 72*1024+1))
		var signal remoteSignal
		if err != nil || len(body) > 72*1024 || decodeStatusJSON(body, &signal) != nil ||
			(signal.Type != "offer" && signal.Type != "candidate") {
			http.Error(w, "invalid signal", http.StatusBadRequest)
			return
		}
		if _, err := canonicalRemoteSignal(signal); err != nil {
			http.Error(w, "invalid signal", http.StatusBadRequest)
			return
		}
		gate.mu.Lock()
		err = gate.viewer.add(signal)
		gate.mu.Unlock()
		if err != nil {
			http.Error(w, "signal queue full", http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/vm/viewer/poll", func(w http.ResponseWriter, r *http.Request) {
		ack, err := strconv.ParseUint(r.URL.Query().Get("ack"), 10, 53)
		if r.Method != http.MethodGet || err != nil {
			http.Error(w, "invalid poll", http.StatusBadRequest)
			return
		}
		gate.mu.Lock()
		batch, err := gate.host.poll(ack)
		gate.mu.Unlock()
		if err != nil {
			http.Error(w, "invalid acknowledgement", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(batch)
	})
	vmServer := httptest.NewServer(observeVMRoot(t, app, mux))
	t.Cleanup(vmServer.Close)
	app.host = strings.TrimPrefix(vmServer.URL, "http://")
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	script := filepath.Join("..", "..", "..", "..", "scripts", "remote-lite-windows-separate-browser-vm.mjs")
	command := exec.CommandContext(ctx, "node", script, vmServer.URL+"/#token="+token+"&remote=1", vmServer.URL+"/vm/viewer")
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stdin.Close(); _ = command.Wait() })
	lines := bufio.NewScanner(stdout)
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"media-ready"`)) ||
		!bytes.Contains(lines.Bytes(), []byte(`"pixelsMatched":true`)) {
		t.Fatalf("separate Chromium sessions did not decode native screen: %v %s", lines.Err(), stderr.String())
	}
	logVMNavigationRecoveries(t, lines.Bytes())
	prepareVMCursorAwayFromCenter(t)
	if _, err := fmt.Fprintln(stdin, "move"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"manual-ack"`)) {
		t.Fatalf("separate Chromium input was not acknowledged: %v %s", lines.Err(), stderr.String())
	}
	assertVMCursorAtScreenCenter(t)
	status.revoked.Store(true)
	if _, err := fmt.Fprintln(stdin, "revoke"); err != nil {
		t.Fatal(err)
	}
	if !lines.Scan() || !bytes.Contains(lines.Bytes(), []byte(`"event":"stopped"`)) {
		t.Fatalf("signed revocation did not stop native browser peer: %v %s", lines.Err(), stderr.String())
	}
}
