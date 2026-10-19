import { parseManualInput, parseWebRtcSignal } from './manual-protocol.mjs';

export class BrowserPeerError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'BrowserPeerError'; }
}
const fault = code => { throw new BrowserPeerError(code); };
const allowedRoles = new Set(['viewer', 'host']);
const safeState = state => ['new','connecting','connected','disconnected','failed','closed'].includes(state) ? state : 'unknown';

/**
 * An actual browser WebRTC media + manual data-channel adapter, independent of
 * GORIQ. It is NOT a native Windows desktop host and does NOT make screen
 * capture unattended. Browser getDisplayMedia MUST be initiated by a person
 * physically present at the sharing device.
 *
 * The supplied signaling callbacks MUST bind the authenticated owner, device,
 * session ID and signed device SDP through the existing coordinator. Signaling
 * implementations must not accept unverified SDPs or arbitrary ICE servers.
 */
export class BrowserManualPeer {
  #pc;
  #role;
  #sendSignal;
  #onStream;
  #onManualInput;
  #onState;
  #channel;
  #stream;
  #closed = false;
  #remoteSet = false;
  #pendingCandidates = [];
  #sentSeq = 0;
  #receivedSeq = 0;
  #manualAllowed = false;
  #seenOffer = false;
  #seenAnswer = false;

  constructor({ role, rtcFactory, iceServers = [], sendSignal, onStream = () => {},
    onManualInput = () => {}, onState = () => {}, requestScreen } = {}) {
    if (!allowedRoles.has(role) || typeof rtcFactory !== 'function' ||
      typeof sendSignal !== 'function' || typeof onStream !== 'function' ||
      typeof onManualInput !== 'function' || typeof onState !== 'function') fault('INVALID_PEER_CONFIG');
    if (role === 'host' && typeof requestScreen !== 'function') fault('SCREEN_CONSENT_CALLBACK_REQUIRED');
    if (!Array.isArray(iceServers) || iceServers.length > 8) fault('ICE_CONFIG_INVALID');
    for (const item of iceServers) {
      if (!item || typeof item !== 'object' || !Array.isArray(item.urls) || item.urls.length > 4 ||
        item.urls.some(url => typeof url !== 'string' || url.length > 256 ||
          !/^(stun|stuns|turn|turns):/u.test(url))) fault('ICE_CONFIG_INVALID');
      if (Object.keys(item).some(key => !['urls','username','credential'].includes(key))) fault('ICE_CONFIG_INVALID');
    }
    this.#role = role;
    this.#sendSignal = sendSignal;
    this.#onStream = onStream;
    this.#onManualInput = onManualInput;
    this.#onState = onState;
    this.#pc = rtcFactory({ iceServers, bundlePolicy: 'max-bundle' });
    if (!this.#pc || typeof this.#pc.createOffer !== 'function' || typeof this.#pc.close !== 'function') fault('WEBRTC_UNAVAILABLE');
    this.requestScreen = requestScreen;
    this.#pc.onicecandidate = event => {
      if (this.#closed || !event.candidate) return;
      const c = event.candidate;
      const s = parseWebRtcSignal({
        type: 'candidate', candidate: c.candidate,
        sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null,
      });
      void Promise.resolve().then(() => this.#sendSignal(s)).catch(() => this.close('signal-failed'));
    };
    this.#pc.onconnectionstatechange = () => {
      if (this.#closed) return;
      const s = safeState(this.#pc.connectionState);
      this.#onState(s);
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this.close('connection-lost');
    };
    if (role === 'host') {
      this.#pc.ondatachannel = event => this.#attachChannel(event.channel);
    } else {
      this.#pc.ontrack = event => {
        if (!this.#closed && event.track?.kind === 'video') {
          this.#onStream(event.streams?.[0] ?? null);
        }
      };
    }
  }

  get closed() { return this.#closed; }
  get connected() { return !this.#closed && this.#channel?.readyState === 'open' && this.#pc.connectionState === 'connected'; }

  #attachChannel(channel) {
    if (this.#closed || this.#channel || !channel || channel.label !== 'goriq-manual-v1') {
      channel?.close?.(); return;
    }
    this.#channel = channel;
    channel.onopen = () => {
      if (this.#closed) return;
      this.#onState('control-channel-open');
    };
    channel.onclose = () => { this.#manualAllowed = false; this.#onState('control-channel-closed'); };
    channel.onerror = () => this.close('control-channel-failed');
    if (this.#role === 'host') {
      channel.onmessage = event => {
        if (this.#closed || !this.#manualAllowed || typeof event.data !== 'string' || event.data.length > 4096) return;
        try {
          const payload = JSON.parse(event.data);
          if (!payload || typeof payload !== 'object' ||
            Object.keys(payload).some(key => !['sequence', 'command'].includes(key)) ||
            !Number.isSafeInteger(payload.sequence) || payload.sequence !== this.#receivedSeq + 1) return;
          const valid = parseManualInput(payload.command);
          this.#receivedSeq = payload.sequence;
          this.#onManualInput(valid);
        } catch { /* invalid input is ignored, never executed */ }
      };
    }
  }

  /**
   * Viewer starts the offer; the host must first call approveLocalScreen()
   * from an explicit, user-initiated UI interaction.
   */
  async startViewer() {
    if (this.#role !== 'viewer' || this.#closed || this.#seenOffer) fault('INVALID_STATE');
    this.#seenOffer = true;
    this.#attachChannel(this.#pc.createDataChannel('goriq-manual-v1', { ordered: true }));
    this.#pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    await this.#sendSignal(parseWebRtcSignal({ type: 'offer', sdp: this.#pc.localDescription?.sdp || offer.sdp }));
    this.#onState('connecting');
  }

  async approveLocalScreen() {
    if (this.#role !== 'host' || this.#closed || this.#stream) fault('INVALID_STATE');
    // Must be called by the physical host user. A connected remote peer alone
    // cannot invoke this or bypass OS screen-sharing consent.
    const stream = await this.requestScreen();
    const tracks = stream?.getVideoTracks?.();
    if (!Array.isArray(tracks) || tracks.length !== 1 || tracks[0].kind !== 'video' || tracks[0].readyState === 'ended') {
      stream?.getTracks?.().forEach(track => track.stop());
      fault('SCREEN_CONSENT_REQUIRED');
    }
    this.#stream = stream;
    tracks[0].addEventListener?.('ended', () => this.close('screen-stopped'), { once: true });
    this.#pc.addTrack(tracks[0], stream);
    this.#manualAllowed = true;
    this.#onState('screen-approved');
  }

  async receiveSignal(signal) {
    if (this.#closed) fault('CLOSED');
    const valid = parseWebRtcSignal(signal);
    if (valid.type === 'offer') {
      if (this.#role !== 'host' || this.#seenOffer || !this.#stream) fault('HOST_CONSENT_FIRST');
      this.#seenOffer = true;
      await this.#pc.setRemoteDescription({ type: 'offer', sdp: valid.sdp });
      this.#remoteSet = true;
      await this.#flushCandidates();
      const answer = await this.#pc.createAnswer();
      await this.#pc.setLocalDescription(answer);
      await this.#sendSignal(parseWebRtcSignal({ type: 'answer', sdp: this.#pc.localDescription?.sdp || answer.sdp }));
      return;
    }
    if (valid.type === 'answer') {
      if (this.#role !== 'viewer' || !this.#seenOffer || this.#seenAnswer) fault('UNEXPECTED_ANSWER');
      this.#seenAnswer = true;
      await this.#pc.setRemoteDescription({ type: 'answer', sdp: valid.sdp });
      this.#remoteSet = true;
      await this.#flushCandidates();
      return;
    }
    if (!this.#remoteSet) {
      if (this.#pendingCandidates.length >= 64) fault('ICE_QUEUE_FULL');
      this.#pendingCandidates.push(valid);
      return;
    }
    await this.#pc.addIceCandidate(valid);
  }

  async #flushCandidates() {
    const pending = this.#pendingCandidates.splice(0);
    for (const candidate of pending) await this.#pc.addIceCandidate(candidate);
  }

  sendManual(command) {
    if (this.#role !== 'viewer' || !this.connected) fault('NOT_CONNECTED');
    const valid = parseManualInput(command);
    if (this.#channel.bufferedAmount > 65536) fault('CHANNEL_BACKPRESSURE');
    const message = JSON.stringify({ sequence: ++this.#sentSeq, command: valid });
    this.#channel.send(message);
    return this.#sentSeq;
  }

  close(reason = 'user-ended') {
    if (this.#closed) return;
    this.#closed = true;
    this.#manualAllowed = false;
    this.#channel?.close?.();
    this.#stream?.getTracks?.().forEach(track => track.stop());
    this.#pc?.close();
    this.#onState(reason);
  }
}
