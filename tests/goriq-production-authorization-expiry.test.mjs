import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { assertProductionAuthorizationFresh } from '../scripts/goriq-production-authorization-expiry.mjs';

test('production mutation fails when admitted authorization expires during preparation', () => {
  const expiry = '2026-10-08T10:00:00Z';
  assert.doesNotThrow(() => assertProductionAuthorizationFresh(expiry, Date.parse(expiry) - 1));
  assert.throws(() => assertProductionAuthorizationFresh(expiry, Date.parse(expiry)), /PRODUCTION_AUTHORIZATION_EXPIRED/);
  assert.throws(() => assertProductionAuthorizationFresh(expiry, Date.parse(expiry) + 1), /PRODUCTION_AUTHORIZATION_EXPIRED/);
});

test('workflow binds expiry and checks each production mutation step', async () => {
  const workflow = (await readFile(new URL('../.github/workflows/goriq-jarvis-production-sync.yml', import.meta.url),'utf8')).replaceAll('\r\n','\n');
  for (const name of ['Deploy exact verified main commit to JARVIS Production', 'Update local JARVIS Broker to exact verified main', 'Reconcile Mac persistence and ChatGPT bridge from exact main', 'Sync live JARVIS endpoints into Vercel', 'Redeploy Production with synchronized environment']) {
    const step = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
    assert.ok(step, name);
    assert.ok(step.includes('PRODUCTION_AUTHORIZATION_EXPIRES_AT: ${{ steps.authorization.outputs.expires_at }}'), name);
    assert.ok(step.includes('node scripts/goriq-production-authorization-expiry.mjs || exit 1'), name);
  }
  assert.ok(workflow.includes('assertProductionAuthorizationFresh(process.env.PRODUCTION_AUTHORIZATION_EXPIRES_AT);'));
});

test('production mutation rejects missing or malformed expiry', () => {
  for (const expiry of [undefined, '', 'invalid']) {
    assert.throws(() => assertProductionAuthorizationFresh(expiry), /PRODUCTION_AUTHORIZATION_EXPIRED/);
  }
});
