import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const hash = value => createHash('sha256').update(value).digest();
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
export class OwnerAuthError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'OwnerAuthError'; }
}
const fail = code => { throw new OwnerAuthError(code); };

/** Keys must be 256-bit random values, never human passwords. The operator
 * provisions only SHA-256 digests; no identity provider or account is created. */
export class RemoteOwnerAuth {
  #owners;
  #sessions = new Map();
  #now;
  #end;
  constructor({ owners, now = () => Date.now(), onEnd = () => {} }) {
    if (!Array.isArray(owners) || !owners.length || owners.length > 20 || typeof onEnd !== 'function') throw new TypeError('Owner configuration required');
    const ids = new Set(), hashes = new Set();
    this.#owners = owners.map(o => {
      if (!o || Object.keys(o).sort().join(',') !== 'keyHash,ownerId' ||
        !/^[a-zA-Z0-9._:-]{1,128}$/u.test(o.ownerId) || !hex(o.keyHash) || ids.has(o.ownerId) || hashes.has(o.keyHash)) throw new TypeError('Invalid owner configuration');
      ids.add(o.ownerId); hashes.add(o.keyHash);
      return { ownerId: o.ownerId, digest: Buffer.from(o.keyHash, 'hex') };
    });
    this.#now = now; this.#end = onEnd;
  }
  #drop(token, s) {
    // Remove authority first. Cleanup cannot revive an expired login.
    this.#sessions.delete(token);
    this.#end(s);
  }
  expire() {
    const now = this.#now();
    for (const [token, s] of this.#sessions) if (now >= s.expiresAt || now >= s.idleAt) this.#drop(token, s);
  }
  login(key) {
    this.expire();
    if (!hex(key)) fail('LOGIN_REFUSED');
    const digest = hash(key);
    const owner = this.#owners.find(o => timingSafeEqual(digest, o.digest));
    if (!owner) fail('LOGIN_REFUSED');
    if (this.#sessions.size >= 100) fail('LOGIN_CAPACITY');
    const token = randomBytes(32).toString('hex');
    const s = { ownerId: owner.ownerId, authorization: randomBytes(32).toString('hex'),
      csrf: randomBytes(32).toString('hex'), expiresAt: this.#now() + 12 * 60 * 60_000,
      idleAt: this.#now() + 15 * 60_000, connections: new Map() };
    this.#sessions.set(hash(token).toString('hex'), s);
    return { token, session: s };
  }
  read(cookie, touch = true) {
    this.expire();
    const pieces = typeof cookie === 'string' ? cookie.split(';').map(v => v.trim()) : [];
    const matches = pieces.filter(v => v.startsWith('__Host-remote-lite='));
    if (matches.length !== 1) fail('LOGIN_REQUIRED');
    const token = matches[0].slice('__Host-remote-lite='.length);
    if (!hex(token)) fail('LOGIN_REQUIRED');
    const s = this.#sessions.get(hash(token).toString('hex'));
    if (!s) fail('LOGIN_REQUIRED');
    if (touch) s.idleAt = this.#now() + 15 * 60_000;
    return s;
  }
  authorized({ ownerId, authorization }) {
    // Do not call expire here: onEnd uses a private coordinator principal.
    const now = this.#now();
    return [...this.#sessions.values()].some(s => s.ownerId === ownerId && s.authorization === authorization && now < s.expiresAt && now < s.idleAt);
  }
  logout(cookie) {
    const s = this.read(cookie, false);
    for (const [token, candidate] of this.#sessions) if (candidate === s) this.#drop(token, s);
  }
  close() { for (const [token, s] of this.#sessions) this.#drop(token, s); }
}
