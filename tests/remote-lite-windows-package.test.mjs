import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(path, 'utf8');
const main = read('apps/remote-lite-windows/cmd/localhost/main_windows.go');
const bridge = read('apps/remote-lite-windows/winbridge/bridge_windows.go');
const page = read('apps/remote-lite-windows/cmd/localhost/index.html');
const moduleFile = read('apps/remote-lite-windows/go.mod');

test('Windows native app remains an isolated, user-consented local test (not a public server)', () => {
  assert.equal(moduleFile.includes('require ('), false);
  assert.match(main, /net\.Listen\("tcp4", "127\.0\.0\.1:0"\)/);
  assert.match(main, /if !approve\(\)/);
  assert.match(main, /15 \* time\.Minute/);
  assert.match(main, /ConstantTimeCompare/);
  assert.match(main, /X-Goriq-Session/);
  assert.match(main, /s\.enabled = false/);
  assert.match(main, /r\.Host != s\.host/);
  assert.doesNotMatch(main, /Listen\("tcp",\s*":/);
  assert.doesNotMatch(main, /0\.0\.0\.0:/);
});

test('Windows native capture and input have explicit bounds and protected desktop refusal', () => {
  assert.match(bridge, /normalInputDesktop\(\)/);
  assert.match(bridge, /UTF16ToString\(name\) == "Default"/);
  assert.match(bridge, /func \(b \*Bridge\) CaptureJPEG\(\)/);
  assert.match(bridge, /func \(b \*Bridge\) Apply\(c Command\)/);
  assert.match(bridge, /unsafe\.Sizeof\(winInput\{\}\) != 40/);
  assert.match(bridge, /time\.Now\(\)\.Before\(b\.grantedUntil\)/);
  assert.match(bridge, /locked or protected desktop refused/);
  assert.doesNotMatch(bridge, /PowerShell|cmd\.exe|exec\.Command|RegSetValue/i);
});

test('embedded local WebRTC self-test has parsable JavaScript and explicit stop conditions', () => {
  const script = page.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, 'embedded script must exist');
  assert.doesNotThrow(() => new Script(script));
  assert.match(script, /new RTCPeerConnection\(\{iceServers:\[\]\}\)/);
  assert.match(script, /captureStream\(6\)/);
  assert.match(script, /createDataChannel\('manual-local-test-v1'/);
  assert.match(script, /setRemoteDescription/);
  assert.match(script, /videoReady/);
  assert.match(script, /ping/);
  assert.match(script, /rtcExpiry=setTimeout\(.*60000\)/);
  assert.match(script, /document\.visibilityState === 'hidden'|document\.visibilityState==='hidden'/);
  assert.match(script, /confirm\('WebRTC経由/);
  assert.match(script, /stopRtc\('ホスト終了'\)/);
  assert.match(page, /このPC内のみ/);
  assert.match(page, /外出先からの接続/);
});

test('source has no external auto-download, public relay or bundled device secrets', () => {
  for (const code of [main, bridge, page]) {
    assert.doesNotMatch(code, /curl\.exe|powershell -|turn\.cloudflare|https:\/\/[^\s"']+\/api\/admin/iu);
    assert.doesNotMatch(code, /-----BEGIN (?:RSA )?PRIVATE KEY-----/);
  }
});
