import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {generateKeyPairSync,privateDecrypt} from 'node:crypto';
import {sealAuthUrl} from '../scripts/jarvis-mac-auth-request.mjs';

test('login handoff exposes only ciphertext, decryptable by the matching owner transport key',()=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 const url='https://login.tailscale.com/a/0123456789abcdef';
 const sealed=sealAuthUrl(JSON.stringify({AuthURL:url}),pair.publicKey);
 assert.ok(sealed&&!sealed.includes(url));
 assert.equal(privateDecrypt({key:pair.privateKey,oaepHash:'sha256'},Buffer.from(sealed,'base64')).toString(),url);
 const other=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>privateDecrypt({key:other.privateKey,oaepHash:'sha256'},Buffer.from(sealed,'base64')));
 assert.equal(sealAuthUrl('https://untrusted.invalid/a/123',pair.publicKey),null);
 assert.equal(sealAuthUrl('no login url',pair.publicKey),null);
});
