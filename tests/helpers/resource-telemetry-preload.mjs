/** Only the fake-model Broker fixture preloads this into its own child processes.
 * The common admission policy and lease are real; telemetry is explicitly synthetic.
 * Restricted CI scratch space cannot satisfy native heavy-model disk requirements.
 */
import { registerHooks } from 'node:module';
import { URL } from 'node:url';

const target = new URL('../../src/gai/worker-resource-probe.ts', import.meta.url).href;
const source = `import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
export async function probeWorkerResources() {
  const state = process.env.XDG_STATE_HOME;
  if (!state || !isAbsolute(state)) throw Error('FIXTURE_RESOURCE_STATE_REQUIRED');
  appendFileSync(join(state, 'fixture-resource-probes.jsonl'),
    JSON.stringify({ evidenceKind: 'TEST_DOUBLE_NOT_NATIVE_RESOURCES' }) + '\\n');
  return { checkedAt: new Date().toISOString(), resources: {
    cpuLoadPercent: 10, memoryAvailableMb: 16000, diskAvailableMb: 100000,
    committedMemoryMb: 4000, commitLimitMb: 20000,
  } };
}`;
registerHooks({
  load(url, context, nextLoad) {
    if (url === target) return { format: 'module', source, shortCircuit: true };
    return nextLoad(url, context);
  },
});
