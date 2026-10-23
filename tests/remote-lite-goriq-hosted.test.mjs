import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { readGoriqHostedPortalConfig } from '../src/remote-lite/goriq-hosted-config.mjs';
import { startGoriqFriendRemote } from '../scripts/jarvis-friend-remote.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'goriq-friend-'));
  const cleanup = [];
  t.after(async () => { for (const task of cleanup) await task(); rmSync(dir, { recursive: true, force: true }); });
  const portal = join(dir, 'portal.json'), wrapper = join(dir, 'friend.json');
  const config = { origin: 'https://friend.example.test' };
  const hosting = { version: 1, ownerOrigins: ['https://owner.example.test'], portalConfig: portal };
  const save = (w = hosting, p = config) => {
    writeFileSync(portal, JSON.stringify(p)); writeFileSync(wrapper, JSON.stringify(w));
  };
  save();
  return { dir, portal, wrapper, config, hosting, save, cleanup };
}
async function until(check, timeout = 7000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() >= end) throw Error('child condition timed out'); await delay(25); }
}

test('GORIQ hosted config uses the exact child-loaded portal and rejects incomplete authority boundaries', t => {
  const f = fixture(t);
  assert.deepEqual(readGoriqHostedPortalConfig(f.wrapper), { configPath: f.portal, config: f.config });
  for (const wrapper of [null, [], {}, { ...f.hosting, version: 2 }, { ...f.hosting, extra: true },
    { ...f.hosting, portalConfig: 'relative.json' }, { ...f.hosting, ownerOrigins: [] },
    { ...f.hosting, ownerOrigins: ['http://owner.example.test'] },
    { ...f.hosting, ownerOrigins: ['https://owner.example.test/'] },
    { ...f.hosting, ownerOrigins: ['https://user:password@owner.example.test'] },
    { ...f.hosting, ownerOrigins: ['https://owner.example.test', 'https://owner.example.test'] }]) {
    f.save(wrapper);
    assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_/u);
  }
  f.save(); writeFileSync(f.wrapper, ' '.repeat(16385));
  assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_/u);
  f.save(); writeFileSync(f.portal, ' '.repeat(16385));
  assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_/u);
  f.save({ ...f.hosting, portalConfig: f.dir });
  assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_/u);
});

test('host-only cookies require a different hostname, including aliases listed by the owner', t => {
  const f = fixture(t);
  for (const origin of ['https://owner.example.test', 'https://owner.example.test:8443']) {
    f.save(f.hosting, { origin });
    assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_HOSTNAME_CONFLICT/u);
  }
  f.save({ ...f.hosting, ownerOrigins: ['https://owner.example.test', f.config.origin] });
  assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_HOSTNAME_CONFLICT/u);
  for (const origin of ['http://friend.example.test', 'https://friend.example.test/path', 'https://friend.example.test#x']) {
    f.save(f.hosting, { origin });
    assert.throws(() => readGoriqHostedPortalConfig(f.wrapper), /GORIQ_FRIEND_/u);
  }
});

test('the real child rechecks its actual configuration and never implicitly initializes a registry', t => {
  const f = fixture(t);
  readGoriqHostedPortalConfig(f.wrapper); // A parent's earlier check is not the authority.
  f.save(f.hosting, { origin: 'https://owner.example.test:9443' });
  assert.throws(() => execFileSync(process.execPath,
    ['scripts/remote-lite-owner-server.mjs', f.wrapper, '--goriq-friend'],
    { windowsHide: true, stdio: 'pipe', timeout: 5000 }),
  e => e.status === 1 && /GORIQ_FRIEND_HOSTNAME_CONFLICT/u.test(e.stderr.toString()));
  assert.throws(() => execFileSync(process.execPath,
    ['scripts/remote-lite-owner-server.mjs', f.wrapper, '--goriq-friend', '--initialize'],
    { windowsHide: true, stdio: 'pipe', timeout: 5000 }),
  e => e.status === 1 && /Usage:/u.test(e.stderr.toString()));
});

test('missing or invalid friend opt-in never invokes a core shutdown callback', () => {
  const events = [];
  assert.equal(startGoriqFriendRemote({ root: process.cwd(), report: e => events.push(e) }), null);
  assert.deepEqual(events, []);
  for (const configPath of ['', 'relative.json', '--initialize', process.cwd() + '\nsecret']) {
    assert.equal(startGoriqFriendRemote({ root: process.cwd(), configPath, report: e => events.push(e) }), null);
  }
  assert.ok(events.every(e => e.service === 'friend-remote' && e.state === 'disabled'));
  assert.equal(JSON.stringify(events).includes('secret'), false);
});

test('actual friend child receives only OS environment and stops without stopping another service', async t => {
  const f = fixture(t); mkdirSync(join(f.dir, 'scripts'));
  const receipt = join(f.dir, 'child.json');
  writeFileSync(join(f.dir, 'scripts', 'remote-lite-owner-server.mjs'),
    `import{writeFileSync}from'node:fs';const timer=setInterval(()=>{},1000);process.on('message',m=>{if(m.type==='goriq-friend-stop'){clearInterval(timer);process.disconnect();}});writeFileSync(${JSON.stringify(receipt)},JSON.stringify({args:process.argv.slice(2),keys:Object.keys(process.env),mode:process.env.NODE_ENV}));`);
  const core = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  const coreExit = once(core, 'exit');
  const events = [];
  const manager = startGoriqFriendRemote({ root: f.dir, configPath: f.wrapper, stdio: 'ignore', report: e => events.push(e),
    env: { ...process.env, JARVIS_OWNER_SECRET: 'synthetic-owner-secret', GOOGLE_API_KEY: 'synthetic-ai-key',
      JARVIS_OWNER_TOKEN: 'synthetic-admin-token', NODE_OPTIONS: '--require=missing-must-not-be-loaded',
      NODE_TLS_REJECT_UNAUTHORIZED: '0', SSL_CERT_FILE: 'must-not-inherit.pem' } });
  f.cleanup.push(async () => { manager?.stop(); if (manager) await until(() => manager.isStopped()); core.kill(); await coreExit; });
  assert.ok(manager);
  await until(() => existsSync(receipt));
  const result = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.deepEqual(result.args, [f.wrapper, '--goriq-friend']);
  assert.equal(result.mode, 'production');
  assert.equal(result.keys.some(k => /JARVIS|GORIQ|OWNER|GOOGLE|NODE_OPTIONS|NODE_TLS|SSL_CERT/u.test(k)), false);
  manager.stop(); await until(() => manager.isStopped());
  assert.equal(events.some(e => e.state === 'forced-stop-requested'), false);
  assert.equal(manager.snapshot().retryPending, false);
  assert.equal(core.exitCode, null);
});

test('unresponsive owned friend child is forcibly stopped within the parent exit budget', async t => {
  const f = fixture(t); mkdirSync(join(f.dir, 'scripts'));
  const receipt = join(f.dir, 'ready'); const events = [];
  writeFileSync(join(f.dir, 'scripts', 'remote-lite-owner-server.mjs'),
    `import{writeFileSync}from'node:fs';process.on('message',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);writeFileSync(${JSON.stringify(receipt)},'ready');`);
  const manager = startGoriqFriendRemote({ root: f.dir, configPath: f.wrapper, stdio: 'ignore', report: e => events.push(e) });
  f.cleanup.push(async () => { manager.stop(); await until(() => manager.isStopped()); });
  await until(() => existsSync(receipt));
  manager.stop(); manager.stop();
  await until(() => manager.isStopped(), 1900);
  assert.equal(events.filter(e => e.state === 'forced-stop-requested').length, 1);
  assert.equal(manager.snapshot().retryPending, false);
});

test('an actual failed friend child exhausts its own budget and leaves another service alive', async t => {
  const f = fixture(t); mkdirSync(join(f.dir, 'scripts'));
  writeFileSync(join(f.dir, 'scripts', 'remote-lite-owner-server.mjs'), 'process.exit(2);');
  const core = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  const coreExit = once(core, 'exit'); const events = [];
  const manager = startGoriqFriendRemote({ root: f.dir, configPath: f.wrapper, stdio: 'ignore', report: e => events.push(e) });
  f.cleanup.push(async () => { manager?.stop(); core.kill(); await coreExit; });
  // Real ChildProcess emits close after exit; the existing manager then reports
  // stopped. Observe the terminal exhaustion event and actual owned-child exit.
  await until(() => events.some(e => e.state === 'exhausted') && manager.isStopped());
  assert.equal(manager.snapshot().failures, 3);
  assert.equal(manager.snapshot().retryPending, false);
  assert.equal(core.exitCode, null);
  assert.equal(events.filter(e => e.state === 'exhausted').length, 1);
  assert.equal(events.filter(e => e.state === 'running').length, 3);
});
