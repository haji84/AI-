//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
)

type remoteSignaler interface {
	SendSignal(context.Context, remoteSignal) error
	ReceiveSignals(context.Context, uint64) (remoteSignalBatch, error)
}

// Only the local, token-authenticated page may ask the native signer to
// exchange bounded SDP/ICE for its already accepted device session.
func (s *server) signalRoutes(m *http.ServeMux) {
	m.HandleFunc("/api/remote/signal", s.requireSignedRemote(func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, http.MethodPost) {
			return
		}
		signaler, ok := s.remoteStatus.(remoteSignaler)
		if !ok {
			http.Error(w, "signed signaling unavailable", http.StatusServiceUnavailable)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 72*1024)
		defer r.Body.Close()
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var signal remoteSignal
		if err := decoder.Decode(&signal); err != nil {
			http.Error(w, "invalid signal", http.StatusBadRequest)
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			http.Error(w, "trailing signal data", http.StatusBadRequest)
			return
		}
		if _, err := canonicalRemoteSignal(signal); err != nil {
			http.Error(w, "signal refused", http.StatusBadRequest)
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		if err := signaler.SendSignal(r.Context(), signal); err != nil {
			if !s.allowRemote(w, r, false) {
				return
			}
			http.Error(w, "signal delivery unconfirmed; close peer", http.StatusBadGateway)
			return
		}
		if !s.check(w, r, http.MethodPost) || !s.allowRemote(w, r, false) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	m.HandleFunc("/api/remote/poll", s.requireSignedRemote(func(w http.ResponseWriter, r *http.Request) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		if !s.check(w, r, http.MethodGet) {
			return
		}
		query := r.URL.Query()
		if len(query) != 1 || len(query["ack"]) != 1 {
			http.Error(w, "invalid signal acknowledgement", http.StatusBadRequest)
			return
		}
		ack, parseErr := strconv.ParseUint(query.Get("ack"), 10, 53)
		if parseErr != nil {
			http.Error(w, "invalid signal acknowledgement", http.StatusBadRequest)
			return
		}
		signaler, ok := s.remoteStatus.(remoteSignaler)
		if !ok {
			http.Error(w, "signed signaling unavailable", http.StatusServiceUnavailable)
			return
		}
		if !s.allowRemote(w, r, false) {
			return
		}
		batch, err := signaler.ReceiveSignals(r.Context(), ack)
		if err != nil {
			if !s.allowRemote(w, r, false) {
				return
			}
			http.Error(w, "signal receipt unconfirmed; close peer", http.StatusBadGateway)
			return
		}
		if !s.check(w, r, http.MethodGet) || !s.allowRemote(w, r, false) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(batch)
	}))
}
