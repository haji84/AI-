import assert from 'node:assert/strict';
import test from 'node:test';
import {
  looksLikePublicFunnel,
  inspectPrivateIngress,
  privateServeUrl,
  restartDelayMs,
  tailscaleBackendIsRunning,
  serviceHealthMatches,
} from './jarvis-remote-access-lib.mjs';

test('restart backoff is bounded and exponential', () => {
  assert.equal(restartDelayMs(1), 1_000);
  assert.equal(restartDelayMs(2), 2_000);
  assert.equal(restartDelayMs(3), 4_000);
  assert.equal(restartDelayMs(20), 30_000);
});

const privateConfig = () => ({ TCP: { '443': { HTTPS: true } }, Web: { 'host.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } });

test('private readiness requires successful structured config and exact loopback HTTPS route', () => {
  assert.equal(inspectPrivateIngress(JSON.stringify(privateConfig())).ready, true);
  for (const output of ['', 'spawn tailscale ENOENT', 'null', '[]', '{}', '{"error":"denied"}']) assert.equal(inspectPrivateIngress(output).ready, false);
  assert.equal(inspectPrivateIngress('null').state, 'unconfigured');
  assert.equal(inspectPrivateIngress('{"error":"denied"}').state, 'unknown');
  assert.equal(inspectPrivateIngress('{"Foreground":[]}').state, 'unknown');
  assert.equal(inspectPrivateIngress(JSON.stringify(privateConfig()), { commandSucceeded: false }).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify(privateConfig()), { dashboardPort: 3333 }).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify(privateConfig()), { dnsName: 'other.ts.net' }).ready, false);
  const config = privateConfig(); config.TCP['443'].HTTPS = false;
  assert.equal(inspectPrivateIngress(JSON.stringify(config)).ready, false);
});

test('Funnel host maps, whitespace, foreground configs and malformed flags fail closed', () => {
  assert.equal(looksLikePublicFunnel('{"AllowFunnel": true}'), true);
  for (const extra of [
    { AllowFunnel: { 'host:443': true } },
    { Foreground: { child: { AllowFunnel: { 'host:443': true } } } },
    { AllowFunnel: { 'host:443': 'false' } },
  ]) assert.equal(inspectPrivateIngress(JSON.stringify({ ...privateConfig(), ...extra })).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify({ ...privateConfig(), AllowFunnel: { 'host:443': false } })).ready, true);
});

test('service readiness rejects auth errors, redirects, false health and wrong service', () => {
  assert.equal(serviceHealthMatches('dashboard', 200, { status: 'ok' }), true);
  assert.equal(serviceHealthMatches('broker', 200, { ok: true, service: 'jarvis-broker' }), true);
  for (const code of [301, 401, 404, 500]) assert.equal(serviceHealthMatches('dashboard', code, { status: 'ok' }), false);
  assert.equal(serviceHealthMatches('broker', 200, { ok: false, service: 'jarvis-broker' }), false);
  assert.equal(serviceHealthMatches('remote-gateway', 200, { ok: true, service: 'jarvis-broker' }), false);
});

test('public Funnel markers are rejected while private Serve is accepted', () => {
  assert.equal(looksLikePublicFunnel('Available within your tailnet:\nhttps://host.example.ts.net'), false);
  assert.equal(looksLikePublicFunnel('Available on the internet:\nhttps://host.example.ts.net'), true);
  assert.equal(looksLikePublicFunnel('{"AllowFunnel":true}'), true);
});

test('tailscale status exposes a private HTTPS URL only when DNSName exists', () => {
  const status = { BackendState: 'Running', Self: { DNSName: 'jarvis-host.example.ts.net.' } };
  assert.equal(tailscaleBackendIsRunning(status), true);
  assert.equal(privateServeUrl(status), 'https://jarvis-host.example.ts.net');
  assert.equal(privateServeUrl({ BackendState: 'Running', Self: {} }), null);
});
