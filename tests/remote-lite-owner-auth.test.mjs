import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { RemoteOwnerAuth } from '../src/remote-lite/owner-auth.mjs';
test('owner login requires a configured high entropy key and idle/logout removes server authority', () => {
  const key = randomBytes(32).toString('hex');
  let now = 1_000;
  const ended = [];
  const auth = new RemoteOwnerAuth({ owners: [{ ownerId: 'friend', keyHash: createHash('sha256').update(key).digest('hex') }],
    now: () => now, onEnd: s => ended.push(s.ownerId) });
  assert.throws(() => auth.login('password'));
  assert.throws(() => auth.login('a'.repeat(64)));
  const login = auth.login(key);
  const cookie = '__Host-remote-lite=' + login.token;
  assert.equal(auth.read(cookie).ownerId, 'friend');
  assert.equal(auth.authorized(login.session), true);
  assert.throws(() => auth.read(cookie + '; ' + cookie));
  now += 15 * 60_000;
  auth.expire();
  assert.deepEqual(ended, ['friend']);
  assert.equal(auth.authorized(login.session), false);
  assert.throws(() => auth.read(cookie));
  const second = auth.login(key);
  auth.logout('__Host-remote-lite=' + second.token);
  assert.deepEqual(ended, ['friend', 'friend']);
  assert.equal(auth.authorized(second.session), false);
});
