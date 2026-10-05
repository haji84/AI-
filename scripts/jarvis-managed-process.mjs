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
  if (options.enablePrivateWorkerIngress === true) {
    specs.push({ name: 'private-worker-ingress', command: node, args: [path.join(root, 'scripts/jarvis-private-worker-ingress.ts')] });
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

/** A network-dependent child waits without exhausting or stopping unrelated local services.
 * Failed launches remain bounded per observed unavailable -> available transition.
 * No address, credential or certificate configuration is changed here.
 */
export function manageNetworkProcess(spec, options = {}) {
  if (typeof options.canStart !== 'function') throw new Error('Network availability probe required');
  const interval = options.probeIntervalMs ?? 5000;
  if (!Number.isInteger(interval) || interval < 1000) throw new Error('Invalid network probe interval');
  const schedule = options.probeSetTimeout ?? setTimeout;
  const cancel = options.probeClearTimeout ?? clearTimeout;
  const report = options.report ?? (() => {});
  let active = null;
  let timer = null;
  let stopped = false;
  let availableBefore = false;
  let waitingReported = false;
  let stoppingChild = false;
  let stopFailureReported = false;

  function check() {
    if (stopped) return;
    timer = null;
    let available = false;
    try { available = options.canStart() === true; } catch {}
    if (active && (stoppingChild || !available)) {
      stoppingChild = true;
      try {
        active.stop();
        active = null;
        stoppingChild = false;
        stopFailureReported = false;
        availableBefore = false;
      } catch {
        if (!stopFailureReported) {
          report({ service: spec.name, state: 'waiting-for-network', reason: 'child-stop-failed' });
          stopFailureReported = true;
        }
        timer = schedule(check, interval);
        return;
      }
    }
    if (!available) {
      if (!waitingReported) report({ service: spec.name, state: 'waiting-for-network' });
      waitingReported = true;
      availableBefore = false;
    } else if (!availableBefore) {
      availableBefore = true;
      waitingReported = false;
      // This child has its own bounded retry budget. Exhaustion is a degraded
      // network capability, not permission to stop Broker/Gateway/Dashboard.
      active = manageProcess(spec, { ...options, onExhausted: undefined });
    }
    if (!stopped) timer = schedule(check, interval);
  }

  check();
  return {
    snapshot: () => stopped
      ? { state: 'stopped', failures: 0, retryPending: false }
      : stoppingChild
        ? { state: 'waiting-for-network', failures: 0, retryPending: false }
        : active?.snapshot() ?? { state: 'waiting-for-network', failures: 0, retryPending: false },
    stop() {
      stopped = true;
      if (timer !== null) { cancel(timer); timer = null; }
      active?.stop();
    },
  };
}
