import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { isAbsolute } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const worker = fileURLToPath(new URL('./powershell-fixture-batch.ps1', import.meta.url));
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function parsePowerShellFixtureBatch(wire, scenarios) {
  try {
    const value = JSON.parse(wire);
    if (!exactKeys(value, ['version', 'cases']) || value.version !== 1 || !Array.isArray(value.cases)
      || value.cases.length !== scenarios.length) throw Error();
    const rows = new Map();
    for (const row of value.cases) {
      if (!exactKeys(row, ['scenario', 'status', 'stdout', 'stderr']) || !scenarios.includes(row.scenario)
        || rows.has(row.scenario) || !Number.isInteger(row.status)
        || row.status < -2147483648 || row.status > 2147483647
        || !['stdout', 'stderr'].every(key => typeof row[key] === 'string' && Buffer.byteLength(row[key]) <= 128 * 1024)) throw Error();
      rows.set(row.scenario, row);
    }
    return rows;
  } catch { throw Error('PS_FIXTURE_BATCH_INVALID'); }
}

/** Test-only optimization for reviewed, inert scenario fixtures. Runspaces
 * isolate PowerShell variables/functions, not native process or static state.
 * Callers must retain fresh processes for those contracts and for Windows. */
export function createPowerShellFixtureBatch({ shell, fixture, scenarios, parameter = 'Scenario',
  parameters = {}, env = process.env, timeoutMs = 30000 }) {
  if (typeof shell !== 'string' || !isAbsolute(fixture) || !Array.isArray(scenarios)
    || scenarios.length < 1 || scenarios.length > 64 || new Set(scenarios).size !== scenarios.length
    || scenarios.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    || !['Scenario', 'Case'].includes(parameter) || !parameters || typeof parameters !== 'object'
    || Array.isArray(parameters) || Object.entries(parameters).some(([key, value]) =>
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) || key === parameter || typeof value !== 'string')
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw Error('PS_FIXTURE_BATCH_ARGUMENTS');
  const names = [...scenarios];
  const input = JSON.stringify({ fixture, scenarios: names, parameter, parameters });
  const environment = { ...env };
  let records, failure, attempted = false;
  return scenario => {
    if (!names.includes(scenario)) throw Error('PS_FIXTURE_CASE_UNKNOWN');
    if (!attempted) {
      attempted = true;
      try {
        const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', worker], {
          input, env: environment, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024,
          windowsHide: true, detached: process.platform !== 'win32', killSignal: 'SIGKILL',
        });
        if (result.error?.code === 'ETIMEDOUT') {
          // The worker may be in a fixture's native child. Terminate its owned
          // POSIX group as well; never leave a timed-out batch in the next test.
          if (process.platform !== 'win32' && Number.isInteger(result.pid) && result.pid > 0) {
            try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          }
          throw Error('PS_FIXTURE_BATCH_TIMEOUT');
        }
        if (result.error || result.status !== 0 || result.stderr !== '')
          throw Error('PS_FIXTURE_BATCH_PROCESS_FAILED: ' + (result.error?.code ?? result.status) + ' ' + result.stderr);
        records = parsePowerShellFixtureBatch(result.stdout, names);
      } catch (error) { failure = error; }
    }
    if (failure) throw failure; // never hide a failed batch by retrying it
    return records.get(scenario);
  };
}
