import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { assertWindowsServicePaths } from './jarvis-windows-install-paths.mjs';
import { productionConfigPath } from './jarvis-production-config.mjs';

test('native service installation rejects apparent and physical MSIX AppData paths', () => {
  const root = 'C:\\Users\\owner\\JARVIS';
  for (const bad of ['C:\\Users\\owner\\AppData\\Local\\JARVIS',
    'C:\\Users\\owner\\AppData\\Local\\Packages\\OpenAI.Codex\\LocalCache\\Local\\JARVIS',
    'C:\\Program Files\\WindowsApps\\package', 'C:\\Users\\owner\\JARVIS\\..\\AppData\\file']) {
    assert.throws(() => assertWindowsServicePaths(bad, root, {}));
    assert.throws(() => assertWindowsServicePaths(root, bad, {}));
    assert.throws(() => assertWindowsServicePaths(root, root, { JARVIS_PRIVATE_WORKER_KEY_PATH: bad }));
    assert.throws(() => assertWindowsServicePaths(root, root, { JARVIS_REMOTE_ASSIST_RECORDING_DIR: bad }));
  }
  assert.doesNotThrow(() => assertWindowsServicePaths(root, root, { JARVIS_DB_PATH: root+'\\data\\broker.sqlite', JARVIS_OWNER_SECRET: 'opaque-value' }));
});

test('native configuration takes precedence while explicit and legacy installations remain supported', () => {
  const env = { USERPROFILE: path.resolve('owner'), LOCALAPPDATA: path.resolve('legacy') };
  const native = path.join(env.USERPROFILE, 'JARVIS', 'production', 'config.dpapi');
  const legacy = path.join(env.LOCALAPPDATA, 'JARVIS', 'production', 'config.dpapi');
  assert.equal(productionConfigPath(env, p => p === native), native);
  assert.equal(productionConfigPath(env, () => false), legacy);
  assert.equal(productionConfigPath({ ...env, JARVIS_PRODUCTION_CONFIG: 'explicit.dpapi' }, () => true), 'explicit.dpapi');
});
