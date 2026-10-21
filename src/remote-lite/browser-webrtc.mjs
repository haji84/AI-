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
  #onManualAcknowledged;
  #checkSession;
  #onState;
  #channel;
  #stream;
  #screenApprovalPending = false;
  #closed = false;
  #remoteSet = false;
  #pendingCandidates = [];
  #sentSeq = 0;
  #receivedSeq = 0;
  #acknowledgedSeq = 0;
  #inputQueue = [];
  #inputTimes = [];
  #drainingInputs = false;
  #sessionTimer;
  #manualAllowed = false;
  #seenOffer = false;
  #seenAnswer = false;

  constructor({ role, rtcFactory, iceServers = [], sendSignal, onStream = () => {},
    onManualInput = () => {}, onManualAcknowledged = () => {}, onState = () => {},
    requestScreen, checkSession } = {}) {
    if (!allowedRoles.has(role) || typeof rtcFactory !== 'function' ||
      typeof sendSignal !== 'function' || typeof onStream !== 'function' ||
      typeof onManualInput !== 'function' || typeof onManualAcknowledged !== 'function' ||
      typeof onState !== 'function') fault('INVALID_PEER_CONFIG');
    if (role === 'host' && typeof requestScreen !== 'function') fault('SCREEN_CONSENT_CALLBACK_REQUIRED');
    if (role === 'host' && typeof checkSession !== 'function') fault('SESSION_CHECK_REQUIRED');
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
    this.#onManualAcknowledged = onManualAcknowledged;
    this.#checkSession = checkSession;
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

  /** The host callback must check the independently authenticated, unexpired
   * device session. Failure or a lost status service ends capture and input. */
  async verifySession() {
    if (this.#role !== 'host') fault('INVALID_STATE');
    if (this.#closed) return false;
    let timeout;
    try {
      const active = await Promise.race([
        Promise.resolve().then(() => this.#checkSession()),
        new Promise(resolve => { timeout = globalThis.setTimeout(() => resolve(false), 3000); }),
      ]);
      if (this.#closed) return false;
      if (active === true) return true;
    } catch { /* unavailable status is never permission to continue */ }
    finally { globalThis.clearTimeout(timeout); }
    this.close('session-not-active');
    return false;
  }

  #attachChannel(channel) {
    if (this.#closed || this.#channel || !channel || channel.label !== 'goriq-manual-v1') {
      channel?.close?.(); return;
    }
    this.#channel = channel;
    channel.onopen = () => {
      if (this.#closed) return;
      this.#onState('control-channel-open');
    };
    channel.onclose = () => this.close('control-channel-closed');
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
          const receivedAt = Date.now();
          this.#inputTimes = this.#inputTimes.filter(time => receivedAt - time < 1000);
          if (this.#inputTimes.length >= 30) return this.close('manual-input-rate-limited');
          this.#inputTimes.push(receivedAt);
          if (this.#inputQueue.length >= 64) return this.close('manual-input-queue-full');
          this.#inputQueue.push({ sequence: payload.sequence, command: valid, receivedAt });
          void this.#drainInputs();
        } catch { /* invalid input is ignored, never executed */ }
      };
    } else {
      channel.onmessage = event => {
        if (this.#closed || typeof event.data !== 'string' || event.data.length > 256) return;
        try {
          const ack = JSON.parse(event.data);
          if (!ack || Object.keys(ack).sort().join(',') !== 'sequence,type' ||
            ack.type !== 'manual-applied' || !Number.isSafeInteger(ack.sequence) ||
            ack.sequence !== this.#acknowledgedSeq + 1 || ack.sequence > this.#sentSeq) {
            return this.close('manual-ack-invalid');
          }
          this.#acknowledgedSeq = ack.sequence;
          this.#onManualAcknowledged(ack.sequence);
        } catch { this.close('manual-ack-invalid'); }
      };
    }
  }

  async #drainInputs() {
    if (this.#drainingInputs) return;
    this.#drainingInputs = true;
    try {
      while (!this.#closed && this.#inputQueue.length) {
        const { sequence, command, receivedAt } = this.#inputQueue.shift();
        if (Date.now() - receivedAt > 1000) return this.close('manual-input-stale');
        if (!await this.verifySession()) return;
        const applied = await this.#onManualInput(command);
        if (this.#closed) return;
        if (!await this.verifySession()) return;
        if (applied !== true || this.#channel?.readyState !== 'open') {
          this.close('manual-input-not-confirmed');
          return;
        }
        this.#channel.send(JSON.stringify({ type: 'manual-applied', sequence }));
      }
    } catch { this.close('manual-input-failed'); }
    finally { this.#drainingInputs = false; }
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
    if (this.#role !== 'host' || this.#closed || this.#stream || this.#screenApprovalPending) fault('INVALID_STATE');
    this.#screenApprovalPending = true;
    let stream;
    try {
      // Invoke the browser permission prompt in the same user gesture. The
      // resulting track stays local until the signed session is checked.
      stream = await this.requestScreen();
      if (this.#closed) fault('CLOSED');
      if (!await this.verifySession()) fault('SESSION_NOT_ACTIVE');
      const tracks = stream?.getVideoTracks?.();
      if (!Array.isArray(tracks) || tracks.length !== 1 || tracks[0].kind !== 'video' || tracks[0].readyState === 'ended') {
        fault('SCREEN_CONSENT_REQUIRED');
      }
      tracks[0].addEventListener?.('ended', () => this.close('screen-stopped'), { once: true });
      this.#pc.addTrack(tracks[0], stream);
      this.#stream = stream;
      this.#manualAllowed = true;
      this.#sessionTimer = globalThis.setInterval(() => { void this.verifySession(); }, 1000);
      this.#sessionTimer.unref?.();
      this.#onState('screen-approved');
    } catch (error) {
      if (this.#stream) this.close('screen-approval-failed');
      else stream?.getTracks?.().forEach(track => track.stop());
      throw error;
    } finally { this.#screenApprovalPending = false; }
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
    globalThis.clearInterval(this.#sessionTimer);
    this.#manualAllowed = false;
    this.#inputQueue = [];
    this.#channel?.close?.();
    this.#stream?.getTracks?.().forEach(track => track.stop());
    this.#pc?.close();
    this.#onState(reason);
  }
}
