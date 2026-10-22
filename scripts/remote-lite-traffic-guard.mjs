import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openTrafficBudget, readLinuxTrafficSnapshot } from '../src/remote-lite/traffic-budget.mjs';

// Exported for ordering/failure tests; the CLI always uses real Linux counters and systemd.
export function startTrafficGuard({ meter, read = readLinuxTrafficSnapshot, notify, schedule = setInterval, cancel = clearInterval, failed }) {
  let timer;
  let stopped = false;
  const observe = () => {
    const result = meter.observe(read()); // Durable write must finish before any readiness/heartbeat.
    if (result.status !== 'monitoring') throw new Error('TRAFFIC_BUDGET_EXHAUSTED');
  };
  const abort = error => {
    if (stopped) return;
    stopped = true;
    if (timer) cancel(timer);
    failed(error); // No meter.close(): retain the lock on every unsafe failure.
  };
  try {
    observe();
    notify('--ready');
    timer = schedule(() => {
      try { observe(); notify('WATCHDOG=1'); } catch (error) { abort(error); }
    }, 5000);
  } catch (error) { abort(error); }
  return {
    stop() {
      if (stopped) return;
      if (timer) cancel(timer);
      try { observe(); meter.close(); stopped = true; } catch (error) { abort(error); }
    }
  };
}

function main() {
  const args = process.argv.slice(2);
  const initialize = args.length === 2 && args[1] === '--initialize';
  if (process.platform !== 'linux' || args.length < 1 || args.length > 2 || (args.length === 2 && !initialize)) throw new Error('TRAFFIC_ARGUMENTS_INVALID');
  if (!initialize && (!process.env.NOTIFY_SOCKET || process.env.WATCHDOG_USEC !== '15000000')) throw new Error('TRAFFIC_SYSTEMD_REQUIRED');
  const stat = lstatSync(args[0]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096 || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('TRAFFIC_CONFIG_UNSAFE');
  const config = JSON.parse(readFileSync(args[0], 'utf8'));
  if (Object.keys(config).sort().join(',') !== 'limitBytes,openingBytes,periodEnd,periodStart,stateDirectory' || typeof config.stateDirectory !== 'string') throw new Error('TRAFFIC_CONFIG_INVALID');
  const { stateDirectory, ...policy } = config;
  const meter = openTrafficBudget(stateDirectory, policy, { initialize });
  if (initialize) {
    const result = meter.observe(readLinuxTrafficSnapshot());
    if (result.status !== 'monitoring') throw new Error('TRAFFIC_BUDGET_EXHAUSTED');
    meter.close();
    process.stdout.write('TRAFFIC_INITIALIZED\n');
    return;
  }
  const notify = flag => execFileSync('/usr/bin/systemd-notify', [flag], { timeout: 2000, stdio: 'ignore', shell: false });
  const failed = error => {
    process.stderr.write((/^TRAFFIC_[A-Z_]+$/.test(error.message) ? error.message : 'TRAFFIC_MONITOR_FAILED') + '\n');
    process.exit(1);
  };
  const monitor = startTrafficGuard({ meter, notify, failed });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { monitor.stop(); process.exit(0); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write((/^TRAFFIC_[A-Z_]+$/.test(error.message) ? error.message : 'TRAFFIC_START_FAILED') + '\n');
    process.exitCode = 1;
  }
}
