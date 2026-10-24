import { BrowserManualPeer } from './browser-webrtc.mjs';

const sessionIce = value => {
  const invalid = () => { throw new Error('Windows relay configuration invalid'); };
  const now = Date.now();
  if (!value || Object.keys(value).some(k => !['sessionId','deviceId','mode','expiresAt','iceServers','serverTime'].includes(k)) ||
      ![value.sessionId,value.deviceId].every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(id)) ||
      !Number.isSafeInteger(value.serverTime) || value.serverTime <= 0 || Math.abs(value.serverTime-now) > 30000 ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.serverTime || value.expiresAt > value.serverTime+3600000 ||
      !Array.isArray(value.iceServers)) invalid();
  if (value.mode === 'direct-only') {
    if (value.iceServers.length) invalid();
  } else if (value.mode === 'stun-approved-provider') {
    if (value.iceServers.length !== 1) invalid();
    const server = value.iceServers[0];
    if (!server || Object.keys(server).sort().join(',') !== 'credential,urls,username' ||
        !Array.isArray(server.urls) || server.urls.length !== 1 || server.urls[0] !== 'stun:stun.cloudflare.com:3478' ||
        server.username !== '' || server.credential !== '') invalid();
  } else {
    if (value.mode !== 'turn-ephemeral-approved-provider' || value.expiresAt > value.serverTime+600000 ||
        value.iceServers.length < 1 || value.iceServers.length > 4) invalid();
    for (const server of value.iceServers) {
      if (!server || Object.keys(server).some(k => !['urls','username','credential'].includes(k)) ||
          !Array.isArray(server.urls) || server.urls.length < 1 || server.urls.length > 4 ||
          !server.urls.every(url => {
            if (typeof url !== 'string' || url.length > 256 || url.includes('..')) return false;
            const match = /^turns?:[A-Za-z0-9.-]+(?::([0-9]{1,5}))?(?:\?transport=(?:udp|tcp))?$/u.exec(url);
            return match && (match[1] === undefined || (Number(match[1]) >= 1 && Number(match[1]) <= 65535));
          }) || typeof server.username !== 'string' || !/^[1-9][0-9]{0,12}:[a-f0-9]{32}$/u.test(server.username) ||
          Number(server.username.split(':')[0])*1000 !== value.expiresAt ||
          typeof server.credential !== 'string' || server.credential.length !== 28) invalid();
      try {
        const decoded = globalThis.atob(server.credential);
        if (decoded.length !== 20 || globalThis.btoa(decoded) !== server.credential) invalid();
      } catch { invalid(); }
    }
  }
  return { ...value, iceServers: value.iceServers.map(server => ({ ...server, urls: [...server.urls] })) };
};

/** Local, owner-consented Windows page. All coordinator traffic and signing
 * remain in the native process; the page receives only its launch token. */
export function createWindowsRemoteHost({ screen, canvas, request, rtcFactory, onStatus,
  elapsedNow = () => globalThis.performance.now(),
  schedule = (fn, ms) => globalThis.setTimeout(fn, ms), cancel = id => globalThis.clearTimeout(id) } = {}) {
  if (!screen || !canvas || typeof request !== 'function' || typeof rtcFactory !== 'function' ||
    typeof onStatus !== 'function' || typeof elapsedNow !== 'function') throw new TypeError('Windows host bridge unavailable');
  let peer = null;
  let timer = null;
  let acknowledged = 0;
  let generation = 0, starting = false;
  const stop = (reason = 'local-stop') => {
    generation++; starting = false;
    if (timer !== null) cancel(timer);
    timer = null;
    const old = peer;
    peer = null;
    old?.close(reason);
    onStatus(reason);
  };
  const checked = async (path, body) => {
    const response = await request(path, body);
    if (!response?.ok) throw new Error('signed Windows request refused');
    return response;
  };
  const poll = async (current) => {
    if (peer !== current || current.closed) return;
    try {
      const response = await checked(`/api/remote/poll?ack=${acknowledged}`);
      const batch = await response.json();
      if (!Number.isSafeInteger(batch?.cursor) || batch.cursor < acknowledged ||
        batch.cursor > acknowledged + 1 || !Array.isArray(batch.signals) || batch.signals.length > 1 ||
        (batch.signals.length === 1) !== (batch.cursor === acknowledged + 1)) {
        throw new Error('signed signal batch invalid');
      }
      for (const signal of batch.signals) await current.receiveSignal(signal);
      if (peer !== current || current.closed) return;
      acknowledged = batch.cursor; // ACK only after RTC accepted the SDP/ICE.
      timer = schedule(() => { void poll(current); }, 250);
    } catch { if (peer === current) stop('signed-signaling-unavailable'); }
  };
  const start = async () => {
    if (peer || starting) throw new Error('Windows host already started');
    if (!screen.naturalWidth || !screen.naturalHeight || !canvas.width || !canvas.height ||
      typeof canvas.captureStream !== 'function') throw new Error('live Windows frame unavailable');
    acknowledged = 0;
    const attempt = ++generation;
    starting = true;
    try {
      const started = elapsedNow();
      const response = await checked('/api/remote/ice');
      const ice = sessionIce(await response.json());
      if (attempt !== generation) throw new Error('Windows startup cancelled');
      const received = elapsedNow(), deadline = started + ice.expiresAt - ice.serverTime;
      if (!Number.isFinite(started) || started < 0 || !Number.isFinite(received) ||
          received < started || received >= deadline) throw new Error('Windows relay request expired');
      const relayLive = () => {
        const elapsed = elapsedNow();
        return ice.mode !== 'turn-ephemeral-approved-provider' ||
          (Number.isFinite(elapsed) && elapsed >= started && elapsed < deadline);
      };
      const current = new BrowserManualPeer({
        role: 'host', rtcFactory, iceServers: ice.iceServers,
        requestScreen: () => canvas.captureStream(6),
        checkSession: async () => {
          try { return relayLive() && (await checked('/api/remote/status')).ok && relayLive(); } catch { return false; }
        },
        sendSignal: async signal => { await checked('/api/remote/signal', signal); },
        onManualInput: async command => (await checked('/api/remote/input', command)).status === 204,
        onState: state => {
          onStatus(state);
          if (current.closed && peer === current) {
            if (timer !== null) cancel(timer);
            timer = null;
            peer = null;
          }
        },
      });
      peer = current;
      starting = false;
      // Native owner approval preceded this request. Status and relay expiry
      // are rechecked before the canvas track can be published.
      await current.approveLocalScreen();
      if (peer === current && !current.closed) void poll(current);
    } catch (error) {
      if (attempt === generation) stop('screen-or-session-refused');
      throw error;
    } finally {
      if (attempt === generation) starting = false;
    }
  };
  return Object.freeze({ start, stop, get active() { return Boolean(starting || (peer && !peer.closed)); } });
}
