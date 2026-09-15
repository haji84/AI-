import assert from 'node:assert/strict';
import test from 'node:test';
import {
  looksLikePublicFunnel,
  privateServeUrl,
  restartDelayMs,
  tailscaleBackendIsRunning,
} from './jarvis-remote-access-lib.mjs';

test('restart backoff is bounded and exponential', () => {
  assert.equal(restartDelayMs(1), 1_000);
  assert.equal(restartDelayMs(2), 2_000);
  assert.equal(restartDelayMs(3), 4_000);
  assert.equal(restartDelayMs(20), 30_000);
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
