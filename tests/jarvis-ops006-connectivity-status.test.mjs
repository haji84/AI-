import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { networkLabel } from '../src/app/jarvis/network-label.ts';

const consoleSource = await readFile(new URL('../src/app/jarvis/JarvisConsole.tsx', import.meta.url), 'utf8');
const preflightSource = await readFile(new URL('../scripts/jarvis-remote-preflight.mjs', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../scripts/jarvis-power-recovery-check.mjs', import.meta.url), 'utf8');

test('OPS-006 normalizes worker connectivity telemetry without inventing reachability', () => {
  assert.equal(networkLabel('wifi'), 'wifi');
  assert.equal(networkLabel('  '), '不明');
  assert.equal(networkLabel(undefined), '-');
  assert.equal(networkLabel({ connected: false, transport: 'wifi', validated: true }), '未接続');
  assert.equal(networkLabel({ connected: true, transport: 'wifi', validated: true }), 'Wi-Fi');
  assert.equal(networkLabel({ connected: true, transport: 'cellular', validated: false }), 'モバイル回線（インターネット未確認）');
  assert.equal(networkLabel({ connected: true, transport: 'unexpected', validated: true }), '不明');
});

test('OPS-006 console keeps JARVIS, Remote Gateway and worker connectivity fail-visible', () => {
  assert.match(consoleSource, /fetch\("\/api\/jarvis\/state", \{ cache: "no-store" \}\)/);
  assert.match(consoleSource, /fetch\("\/api\/jarvis\/remote", \{ cache: "no-store" \}\)/);
  assert.match(consoleSource, /<strong>接続状態<\/strong><span>\{error\}<\/span>/);
  assert.match(consoleSource, /<strong>Remote Gateway<\/strong><span>\{remoteError\}<\/span>/);
  assert.match(consoleSource, /<article><span>Offline<\/span><strong>\{state\?\.stats\.offline \?\? 0\}<\/strong><\/article>/);
  assert.match(consoleSource, /<th>状態<\/th><th>登録<\/th><th>通信<\/th><th>電池<\/th><th>最終接続<\/th>/);
  assert.match(consoleSource, /networkLabel\(node\.telemetry\?\.network\)/);
  assert.match(consoleSource, /fmt\(node\.lastSeenAt\)/);
  assert.match(consoleSource, /window\.setInterval\(\(\) => \{[\s\S]*void refresh\(\);[\s\S]*void refreshRemote\(\);[\s\S]*\}, 5000\)/);
});

test('OPS-006 private remote preflight refuses unknown/public/unhealthy connectivity', () => {
  assert.match(preflightSource, /tailscaleBackendIsRunning\(status\)/);
  assert.match(preflightSource, /\['public', 'unknown'\]\.includes\(before\.state\)/);
  assert.match(preflightSource, /if \(!after\.ready\)/);
  assert.match(preflightSource, /checkHttp\('dashboard', `http:\/\/127\.0\.0\.1:\$\{dashboardPort\}\/api\/health`\)/);
  assert.match(preflightSource, /checkHttp\('broker', 'http:\/\/127\.0\.0\.1:8787\/health'\)/);
  assert.match(preflightSource, /checkHttp\('remote-gateway', 'http:\/\/127\.0\.0\.1:8790\/health'\)/);
  assert.match(preflightSource, /REMOTE_ACCESS_REFUSED/);
  assert.match(preflightSource, /Cellular access and real-worker execution still require physical acceptance/);
});

test('OPS-006 recovery check reports host overlay and private-ingress connectivity separately', () => {
  assert.match(recoverySource, /add\('tailscale-connected', tailscaleBackendIsRunning\(tsStatus\)/);
  assert.match(recoverySource, /add\('private-ingress-only', ingress\.ready, ingress\.reason\)/);
  assert.match(recoverySource, /const verdict = recoveryVerdict\(checks\)/);
  assert.match(recoverySource, /process\.exitCode = verdict\.ok \? 0 : 2/);
});
