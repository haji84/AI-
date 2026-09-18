/** Only the Broker's explicit failed screenshot result is recoverable. */
export function isRecoverableCaptureFailure(action: unknown, status: number, body: {code?: unknown}) {
  return action === 'screenshot' && status === 503 && body.code === 'REMOTE_CAPTURE_UNAVAILABLE';
}
export function remoteCaptureGapMs(label = '') { return /\bKYV\d+/i.test(label) ? 1500 : 100; }
