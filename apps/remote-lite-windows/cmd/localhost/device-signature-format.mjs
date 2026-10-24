/** Canonical wire signature formats. EC keys use SHA256withECDSA DER, while
 * existing Windows identities keep their fixed-size Ed25519 signatures. */
export function deviceSignatureFormat(value, expected = null) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  let binary;
  try { binary = globalThis.atob(value); } catch { return null; }
  if (globalThis.btoa(binary) !== value) return null;
  if (expected === 'ed25519') return binary.length === 64 ? 'ed25519' : null;
  let der = binary.length >= 8 && binary.length <= 72 && binary.charCodeAt(0) === 0x30 &&
    binary.charCodeAt(1) === binary.length - 2;
  let offset = 2;
  for (let i = 0; der && i < 2; i++) {
    if (binary.charCodeAt(offset++) !== 0x02) { der = false; break; }
    const length = binary.charCodeAt(offset++);
    const first = binary.charCodeAt(offset);
    if (length < 1 || length > 33 || offset + length > binary.length || (first & 0x80) ||
        (length > 1 && first === 0 && !(binary.charCodeAt(offset + 1) & 0x80))) { der = false; break; }
    offset += length;
  }
  if (der && offset === binary.length) return 'p256';
  return expected === null && binary.length === 64 ? 'ed25519' : null;
}
