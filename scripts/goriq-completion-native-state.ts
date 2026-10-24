import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectPcRuntimeState } from '../src/jarvis/pc-runtime-refresh.ts';
import { validateCompletionActivation, prepareCompletionConfiguration, validateCompletionSource } from '../src/jarvis/completion-native-activation.ts';
import { FilePcIdentityStorage } from '../src/jarvis/pc-local-identity.ts';

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  const revision = process.env.GORIQ_PC_APPROVED_REVISION;
  if (process.platform !== 'win32' || !/^[a-f0-9]{40}$/.test(revision ?? '') ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) throw Error('source');
  const approval = validateCompletionActivation(JSON.parse(readFileSync('docs/authorizations/1858-native-activation.json', 'utf8')), input.recovery ? 'recovery' : 'forward');
  if (input.operation === 'source') {
    const response = await fetch('https://api.github.com/repos/haji84/AI-/pulls/1863', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('source-unavailable');
    validateCompletionSource(await response.json(), revision!);
    console.log(JSON.stringify({ issue: 1858, pr: 1863, sourceRevision: revision, exactMergedTask: true }));
    return;
  }
  const config = input.current;
  if (!input.recovery) prepareCompletionConfiguration(config, revision!, approval);
  if (config?.version !== 1 || config.commit !== 'a49c458d69a28c0266be8fcad5b26253e5ed8d75' ||
    config.releaseRoot !== `C:\\Users\\qq113\\JARVIS\\releases\\${config.commit}`) throw Error('baseline');
  const host = config.environment.JARVIS_PRIVATE_WORKER_HOST;
  const db = config.environment.JARVIS_DB_PATH;
  if (typeof host !== 'string' || !host || db !== 'C:\\Users\\qq113\\JARVIS\\production\\data\\broker.sqlite') throw Error('environment');
  const privateAddressAssigned = Object.values(networkInterfaces()).flat().some(a => a?.family === 'IPv4' && a.address === host);
  const state = inspectPcRuntimeState({ brokerPath: db, compassPath: db + '.compass.sqlite' });
  if (input.operation === 'prepare') {
    await new FilePcIdentityStorage(join('C:\\Users\\qq113\\JARVIS\\production\\runtime-refresh', revision!, 'baseline.dpapi')).writeExclusive(JSON.stringify(state.privateSnapshot));
  } else if (input.operation !== 'inspect') throw Error('operation');
  console.log(JSON.stringify({ ...state.metadata, privateAddressAssigned, previousRevision: config.commit, revision, observedAt: new Date().toISOString() }));
}
main().catch(() => { console.error('COMPLETION_NATIVE_STATE_REJECTED'); process.exitCode = 1; });
