export function macAutoRestartEnabled(pmsetOutput) {
  const text = String(pmsetOutput || '');
  return /(^|\n)\s*autorestart\s+1\s*($|\n)/m.test(text);
}

export function macSystemDaemonLoaded(launchctlOutput) {
  const text = String(launchctlOutput || '').toLowerCase();
  return text.includes('ai.jarvis.remote-host') && !text.includes('could not find service');
}

export function windowsStartupTaskReady(task) {
  if (!task || typeof task !== 'object') return false;
  const state = String(task.State || task.state || '').toLowerCase();
  const trigger = String(task.Trigger || task.trigger || '').toLowerCase();
  return ['ready', 'running'].includes(state) && trigger.includes('startup');
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
