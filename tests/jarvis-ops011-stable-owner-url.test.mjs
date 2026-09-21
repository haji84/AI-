import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { inspectPrivateIngress, privateServeUrl } from '../scripts/jarvis-remote-access-lib.mjs';

test('OPS-011 owner URL is stable across transient address and peer metadata', () => {
  const first = {
    BackendState: 'Running',
    Self: {
      DNSName: 'jarvis-owner.tailnet.ts.net.',
      TailscaleIPs: ['100.64.0.10'],
      Online: true,
    },
    Peer: { a: { Online: true } },
  };
  const second = {
    BackendState: 'Running',
    Self: {
      DNSName: 'jarvis-owner.tailnet.ts.net.',
      TailscaleIPs: ['100.100.42.9'],
      Online: true,
    },
    Peer: { completelyDifferentPeerSet: { Online: false } },
  };

  assert.equal(privateServeUrl(first), 'https://jarvis-owner.tailnet.ts.net');
  assert.equal(privateServeUrl(second), 'https://jarvis-owner.tailnet.ts.net');
  assert.equal(privateServeUrl(first), privateServeUrl(second));
});

test('OPS-011 refuses to invent an owner URL when MagicDNS identity is unavailable', () => {
  assert.equal(privateServeUrl({ BackendState: 'Running', Self: {} }), null);
  assert.equal(privateServeUrl({ BackendState: 'Running', Self: { DNSName: '' } }), null);
  assert.equal(privateServeUrl({ BackendState: 'Stopped', Self: {} }), null);
});

test('OPS-011 private ingress must bind HTTPS to the same stable DNS host and loopback dashboard', () => {
  const config = {
    TCP: { '443': { HTTPS: true } },
    Web: {
      'jarvis-owner.tailnet.ts.net:443': {
        Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } },
      },
    },
  };
  const ready = inspectPrivateIngress(JSON.stringify(config), {
    dnsName: 'jarvis-owner.tailnet.ts.net.',
    dashboardPort: 3000,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.state, 'private');

  assert.equal(inspectPrivateIngress(JSON.stringify(config), {
    dnsName: 'different.tailnet.ts.net.',
    dashboardPort: 3000,
  }).ready, false);
  assert.equal(inspectPrivateIngress(JSON.stringify({ ...config, AllowFunnel: { 'jarvis-owner.tailnet.ts.net:443': true } }), {
    dnsName: 'jarvis-owner.tailnet.ts.net.',
    dashboardPort: 3000,
  }).ready, false);
});

test('OPS-011 remote preflight reports only the canonical private URL after fail-closed ingress checks', async () => {
  const source = await readFile(new URL('../scripts/jarvis-remote-preflight.mjs', import.meta.url), 'utf8');

  assert.match(source, /const privateUrl = privateServeUrl\(status\)/);
  assert.match(source, /if \(!privateUrl\)/);
  assert.match(source, /inspectPrivateIngress\(run\(\['serve', 'status', '--json'\]\), ingressOptions\)/);
  assert.match(source, /if \(\['public', 'unknown'\]\.includes\(before\.state\)\)/);
  assert.match(source, /if \(!after\.ready\)/);
  assert.match(source, /REMOTE_ACCESS_SOFTWARE_READY: \$\{privateUrl\}/);
  assert.doesNotMatch(source, /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/);
  assert.doesNotMatch(source, /funnel\s+--bg|tailscale[^\n]*funnel[^\n]*--bg/i);
});
