import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function sourceAt(path) {
  try { return readFileSync(new URL(path, import.meta.url), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
const source = sourceAt('../apps/ios-owner/Sources/OwnerCredentialRuntime.swift');
const ui = sourceAt('../apps/ios-owner/Sources/JarvisIOSOwnerApp.swift');

test('Owner credential access is bound to server proof and local user presence', () => {
  assert.match(source, /verifyTrustedDeviceProof\(/);
  assert.match(source, /SecAccessControlCreateWithFlags/);
  assert.match(source, /\.userPresence/);
  assert.match(source, /kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly/);
  assert.match(source, /SecureEnclave\.P256\.Signing\.PrivateKey/);
});

test('Owner secret is masked and does not enter browser storage, URL or diagnostics', () => {
  assert.match(ui, /本番ログインコード/);
  assert.match(ui, /表示/);
  assert.match(ui, /コピー/);
  assert.doesNotMatch(source + ui, /localStorage|sessionStorage|indexedDB|print\(|Logger\.|NSLog|URLQueryItem.*[Cc]ode/);
});
