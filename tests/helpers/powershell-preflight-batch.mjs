import { Buffer } from 'node:buffer';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createPowerShellFixtureBatch } from './powershell-fixture-batch.mjs';

const fixture = fileURLToPath(new URL('./powershell-preflight-case.ps1', import.meta.url));

// Only reviewed preflight comparison groups use this test helper. Each source
// keeps its original bytes and gets a fresh runspace. Native/Windows contracts
// retain their separate processes at the call site.
export function runPreflightPowerShellBatch({ shell, sources, env = process.env, timeoutMs = 25000 }) {
  if (typeof shell !== 'string' || !shell || !Array.isArray(sources)
    || sources.length < 1 || sources.length > 8
    || sources.some(source => typeof source !== 'string' || !source || Buffer.byteLength(source) > 131072)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000) {
    throw Error('PS_PREFLIGHT_BATCH_ARGUMENTS');
  }
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'preflight-source-batch-')));
  try {
    const scenarios = sources.map((source, index) => {
      const scenario = `case-${index}`;
      writeFileSync(join(root, scenario + '.ps1'), source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return scenario;
    });
    const run = createPowerShellFixtureBatch({ shell, fixture, scenarios, env, timeoutMs,
      parameters: { FixtureRoot: root } });
    return scenarios.map(scenario => run(scenario));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
