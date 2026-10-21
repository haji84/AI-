/** Remote Lite manual-input and WebRTC signaling contract.
 * No command, automation or arbitrary code execution surface is exposed here.
 * All values crossing this boundary are untrusted until validated.
 */
const hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finiteIn = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

export class RemoteLiteProtocolError extends Error {
  constructor(code) { super(code); this.name = 'RemoteLiteProtocolError'; this.code = code; }
}
const reject = () => { throw new RemoteLiteProtocolError('INVALID_MANUAL_MESSAGE'); };
const coordinate = (n) => finiteIn(n, 0, 1);

/** Normalized coordinates prevent mismatches between display scale and native screen pixels. */
export function parseManualInput(input) {
  if (!isRecord(input) || typeof input.action !== 'string') return reject();
  switch (input.action) {
    case 'tap':
      if (!hasOnlyKeys(input, ['action', 'x', 'y']) || !coordinate(input.x) || !coordinate(input.y)) return reject();
      return { action: 'tap', x: input.x, y: input.y };
    case 'swipe':
      if (!hasOnlyKeys(input, ['action', 'x1', 'y1', 'x2', 'y2', 'durationMs']) ||
        ![input.x1, input.y1, input.x2, input.y2].every(coordinate) ||
        !Number.isInteger(input.durationMs) || !finiteIn(input.durationMs, 50, 5000)) return reject();
      return { action: 'swipe', x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2, durationMs: input.durationMs };
    case 'text':
      if (!hasOnlyKeys(input, ['action', 'text']) || typeof input.text !== 'string' ||
        input.text.length < 1 || input.text.length > 512 || [...input.text].some(char => { const cp = char.codePointAt(0); return cp < 32 && ![9, 10, 13].includes(cp); })) return reject();
      return { action: 'text', text: input.text };
    case 'key':
      if (!hasOnlyKeys(input, ['action', 'key']) || !['BACK', 'HOME', 'APP_SWITCH', 'ENTER', 'ESCAPE', 'TAB', 'BACKSPACE', 'DELETE', 'ARROW_UP', 'ARROW_DOWN', 'ARROW_LEFT', 'ARROW_RIGHT'].includes(input.key)) return reject();
      return { action: 'key', key: input.key };
    case 'pointer':
      if (!hasOnlyKeys(input, ['action', 'x', 'y', 'phase', 'button']) || !coordinate(input.x) || !coordinate(input.y) ||
        !['move', 'down', 'up'].includes(input.phase) || !['left', 'middle', 'right'].includes(input.button)) return reject();
      return { action: 'pointer', x: input.x, y: input.y, phase: input.phase, button: input.button };
    case 'wheel':
      if (!hasOnlyKeys(input, ['action', 'deltaX', 'deltaY']) || !finiteIn(input.deltaX, -1000, 1000) || !finiteIn(input.deltaY, -1000, 1000)) return reject();
      return { action: 'wheel', deltaX: input.deltaX, deltaY: input.deltaY };
    default:
      return reject();
  }
}

export function parseWebRtcSignal(input) {
  if (!isRecord(input) || !hasOnlyKeys(input, ['type', 'sdp', 'candidate', 'sdpMid', 'sdpMLineIndex'])) return reject();
  if (input.type === 'offer' || input.type === 'answer') {
    if (!hasOnlyKeys(input, ['type', 'sdp']) || typeof input.sdp !== 'string' ||
      input.sdp.length < 1 || input.sdp.length > 64 * 1024 || !input.sdp.startsWith('v=0')) return reject();
    return { type: input.type, sdp: input.sdp };
  }
  if (input.type === 'candidate') {
    if (!hasOnlyKeys(input, ['type', 'candidate', 'sdpMid', 'sdpMLineIndex']) ||
      typeof input.candidate !== 'string' || input.candidate.length < 1 || input.candidate.length > 4096 ||
      !(input.sdpMid === null || (typeof input.sdpMid === 'string' && input.sdpMid.length <= 64)) ||
      !(input.sdpMLineIndex === null || (Number.isInteger(input.sdpMLineIndex) && finiteIn(input.sdpMLineIndex, 0, 100)))) return reject();
    return { type: 'candidate', candidate: input.candidate, sdpMid: input.sdpMid, sdpMLineIndex: input.sdpMLineIndex };
  }
  return reject();
}
