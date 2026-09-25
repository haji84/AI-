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
const projectDefinition = sourceAt('../apps/ios-owner/project.yml');
const physicalInstallWorkflow = sourceAt('../.github/workflows/iphone-owner-build-1218.yml');

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

test('physical install selects the signing team from the app provisioning profile', () => {
  assert.doesNotMatch(physicalInstallWorkflow, /TEAM=.*security find-identity/);
  assert.doesNotMatch(physicalInstallWorkflow, /TEAM_ID="\$TEAM"/);
  assert.match(physicalInstallWorkflow, /Entitlements[\s\S]*application-identifier/);
  assert.match(physicalInstallWorkflow, /DeveloperCertificates/);
  assert.match(physicalInstallWorkflow, /hashlib\.sha1/);
  assert.doesNotMatch(physicalInstallWorkflow, /PROVISIONING_PROFILE_SPECIFIER=/);
  assert.doesNotMatch(physicalInstallWorkflow, /-allowProvisioningUpdates/);
  assert.doesNotMatch(physicalInstallWorkflow, /CODE_SIGN_IDENTITY="\$IDENTITY_HASH"/);
  assert.match(physicalInstallWorkflow, /CODE_SIGN_IDENTITY='Apple Development'/);
  assert.match(physicalInstallWorkflow, /CODE_SIGN_STYLE=Automatic/);
});

test('generated Xcode project keeps the approved Personal Team for local device runs', () => {
  assert.match(projectDefinition, /DEVELOPMENT_TEAM: SDTV253RXA/);
  assert.match(projectDefinition, /CODE_SIGN_STYLE: Automatic/);
});

test('physical install failure reports only a redacted diagnostic', () => {
  assert.match(physicalInstallWorkflow, /INSTALL_DIAGNOSTIC/);
  assert.match(physicalInstallWorkflow, /DEVICE_ID_REDACTED/);
  assert.match(physicalInstallWorkflow, /EMAIL_REDACTED/);
  assert.doesNotMatch(physicalInstallWorkflow, /cat .*install\.log/);
});
