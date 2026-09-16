export function macAutoRestartEnabled(pmsetOutput) {
  const text = String(pmsetOutput || '');
  return /(^|\n)\s*autorestart\s+1\s*($|\n)/m.test(text);
}

export function macSystemDaemonLoaded(launchctlOutput) {
  const text = String(launchctlOutput || '').toLowerCase();
  return text.includes('ai.jarvis.remote-host') && !text.includes('could not find service');
}

export function windowsStartupTaskReadiness(task, expected = {}) {
  const checks = {};
  const add = (name, ok, detail) => { checks[name] = { ok: ok === true, detail }; };
  const settings = task?.Settings ?? {};
  const principal = task?.Principal ?? {};
  add('enabled', ['ready', 'running'].includes(String(task?.State).toLowerCase()) && settings.Enabled === true, 'Task must be enabled and Ready or Running');
  add('boot-trigger', Array.isArray(task?.Triggers) && task.Triggers.some(t => t.Type === 'MSFT_TaskBootTrigger' && t.Enabled === true), 'An enabled Windows boot trigger is required');
  add('identity', principal.IdentityPresent === true && principal.MatchesCurrentIdentity === true, 'Task must run as the inspected owner identity; another service account requires separate review');
  add('logon-type', String(principal.LogonType).toLowerCase() === 'password', 'Noninteractive owner logon is required; Interactive needs login and S4U lacks network/encrypted-file access');
  add('least-privilege', ['limited', 'leastprivilege'].includes(String(principal.RunLevel).toLowerCase()), 'Task must not request elevated execution');

  const normalize = value => typeof value === 'string' && value ? path.win32.normalize(value).toLowerCase() : '';
  const root = normalize(expected.repoRoot);
  const node = normalize(expected.nodePath);
  const action = Array.isArray(task?.Actions) && task.Actions.length === 1 ? task.Actions[0] : null;
  const rawArgument = typeof action?.Arguments === 'string' ? action.Arguments.trim() : '';
  const quoted = rawArgument.startsWith('"') && rawArgument.endsWith('"');
  const argument = quoted ? rawArgument.slice(1, -1) : rawArgument;
  const singleArgument = !argument.includes('"') && (quoted || !/\s/.test(argument));
  const script = root && argument ? normalize(path.win32.resolve(root, argument)) : '';
  const exactAction = Boolean(root && node && action && singleArgument && normalize(action.Execute) === node && normalize(action.WorkingDirectory) === root && script === normalize(path.win32.join(root, 'scripts/jarvis-remote-host.mjs')));
  add('action', exactAction, 'One direct Node action must launch this repository host script in its expected working directory');
  add('battery', settings.DisallowStartIfOnBatteries === false && settings.StopIfGoingOnBatteries === false, 'Task must start and continue on battery power');
  add('offline', settings.RunOnlyIfNetworkAvailable === false, 'Network availability must not be an OS startup condition');
  const interval = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(settings.RestartInterval));
  const seconds = interval ? Number(interval[1] || 0) * 60 + Number(interval[2] || 0) : 0;
  add('restart', settings.StartWhenAvailable === true && Number.isInteger(settings.RestartCount) && settings.RestartCount >= 1 && settings.RestartCount <= 20 && seconds > 0 && seconds <= 300, 'Missed starts and bounded restart count/interval must be configured');
  add('resident', ['PT0S', 'PT0M'].includes(settings.ExecutionTimeLimit) && String(settings.MultipleInstances).toLowerCase() === 'ignorenew', 'Resident execution must have no time limit and reject duplicate instances');
  return { ...recoveryVerdict(checks), checks, physicalRecoveryVerified: false };
}

export function windowsStartupTaskReady(task, expected) {
  return windowsStartupTaskReadiness(task, expected).ok;
}

export function windowsTailscaleServiceReady(service) {
  if (!service || typeof service !== 'object') return false;
  const status = String(service.Status || service.status || '').toLowerCase();
  const startType = String(service.StartType || service.startType || '').toLowerCase();
  return status === 'running' && ['automatic', 'auto'].includes(startType);
}

export function recoveryVerdict(checks) {
  const required = Object.entries(checks || {}).filter(([, value]) => value?.required !== false);
  const failed = required.filter(([, value]) => value?.ok !== true).map(([name]) => name);
  return { ok: failed.length === 0, failed };
}
import path from 'node:path';
