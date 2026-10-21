import { BrowserManualPeer } from './browser-webrtc.mjs';

/** Local, owner-consented Windows page. All coordinator traffic and signing
 * remain in the native process; the page receives only its launch token. */
export function createWindowsRemoteHost({ screen, canvas, request, rtcFactory, onStatus,
  schedule = (fn, ms) => globalThis.setTimeout(fn, ms), cancel = id => globalThis.clearTimeout(id) } = {}) {
  if (!screen || !canvas || typeof request !== 'function' || typeof rtcFactory !== 'function' ||
    typeof onStatus !== 'function') throw new TypeError('Windows host bridge unavailable');
  let peer = null;
  let timer = null;
  let acknowledged = 0;
  const stop = (reason = 'local-stop') => {
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
    } catch { stop('signed-signaling-unavailable'); }
  };
  const start = async () => {
    if (peer) throw new Error('Windows host already started');
    if (!screen.naturalWidth || !screen.naturalHeight || !canvas.width || !canvas.height ||
      typeof canvas.captureStream !== 'function') throw new Error('live Windows frame unavailable');
    acknowledged = 0;
    const current = new BrowserManualPeer({
      role: 'host', rtcFactory, iceServers: [],
      requestScreen: () => canvas.captureStream(6),
      checkSession: async () => {
        try { return (await checked('/api/remote/status')).ok; } catch { return false; }
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
    try {
      // The captureStream call occurs in the click gesture before the first
      // asynchronous status check; native owner approval already preceded it.
      await current.approveLocalScreen();
      if (peer === current && !current.closed) void poll(current);
    } catch (error) {
      stop('screen-or-session-refused');
      throw error;
    }
  };
  return Object.freeze({ start, stop, get active() { return Boolean(peer && !peer.closed); } });
}
