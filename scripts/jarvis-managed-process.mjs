import { spawn } from 'node:child_process';
import path from 'node:path';
import { restartDelayMs } from './jarvis-remote-access-lib.mjs';

export function serviceSpecs(root, node = process.execPath, port = '3000', options = {}) {
  const specs = [
    { name: 'broker', command: node, args: [path.join(root, 'scripts/jarvis-broker.ts')] },
    { name: 'remote-gateway', command: node, args: [path.join(root, 'scripts/jarvis-remote-gateway.ts')] },
    { name: 'dashboard', command: node, args: [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)] },
  ];
  if (options.enableEnrollmentPortal === true) {
    specs.push({ name: 'enrollment-portal', command: node, args: [path.join(root, 'scripts/jarvis-fixed-enrollment-portal.ts')] });
  }
  return specs;
}

export function manageProcess(spec, options = {}) {
  const launch = options.spawn ?? spawn;
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  const now = options.now ?? Date.now;
  const report = options.report ?? (() => {});
  const maxFailures = options.maxFailures ?? 20;
  if (!Number.isInteger(maxFailures) || maxFailures < 1) throw new Error('maxFailures must be a positive integer');
  let child = null;
  let timer = null;
  let stopped = false;
  let failures = 0;
  let state = 'starting';

  function start() {
    if (stopped) return;
    timer = null;
    state = 'starting';
    const startedAt = now();
    let handled = false;
    let spawned = false;
    function ended(reason) {
      if (handled || stopped) return;
      handled = true;
      child = null;
      failures = spawned && now() - startedAt >= 60_000 ? 1 : failures + 1;
      if (failures >= maxFailures) {
        state = 'exhausted';
        stopped = true;
        report({ service: spec.name, state, reason, failures });
        options.onExhausted?.(spec.name);
        return;
      }
      state = 'backoff';
      const delay = restartDelayMs(failures);
      report({ service: spec.name, state, reason, failures, delay });
      // Keep the retry alive even when every child failed to spawn.
      timer = schedule(start, delay);
    }
    try {
      child = launch(spec.command, spec.args, { cwd: options.cwd, env: options.env, stdio: options.stdio ?? 'inherit', windowsHide: true });
      child.once('spawn', () => { spawned = true; state = 'running'; report({ service: spec.name, state }); });
      child.once('error', error => ended(`spawn:${error.code ?? 'unknown'}`));
      child.once('exit', (code, signal) => ended(`exit:${code ?? signal ?? 'unknown'}`));
    } catch (error) { ended(`spawn:${error.code ?? 'unknown'}`); }
  }

  start();
  return {
    snapshot: () => ({ state, failures, retryPending: timer !== null }),
    stop() {
      stopped = true;
      state = 'stopped';
      if (timer !== null) { cancel(timer); timer = null; }
      if (child) { child.kill('SIGTERM'); child = null; }
    },
  };
}
