export function macAutoRestartEnabled(pmsetOutput) {
  const text = String(pmsetOutput || '');
  return /(^|\n)\s*autorestart\s+1\s*($|\n)/m.test(text);
}

export function macSystemDaemonLoaded(launchctlOutput) {
  const text = String(launchctlOutput || '').toLowerCase();
  return text.includes('ai.jarvis.remote-host') && !text.includes('could not find service');
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  return String(value ?? '').trim().toLowerCase() === 'true';
}

export function windowsStartupTaskReady(task) {
  if (!task || typeof task !== 'object') return false;
  const state = String(task.State || task.state || '').toLowerCase();
  const trigger = String(task.Trigger || task.trigger || '').toLowerCase();
  const userId = String(task.UserId || task.userId || '').trim();
  const logonType = String(task.LogonType || task.logonType || '').toLowerCase();
  const bootTriggered = trigger.includes('startup') || trigger.includes('boottigger') || trigger.includes('boottrigger');
  // JARVIS is a networked service. InteractiveToken requires an existing login,
  // while S4U explicitly lacks network/encrypted-file access. Fail closed and
  // accept only principals that are both noninteractive and network-capable.
  const unattendedNetworkLogon = ['serviceaccount', 'password', 'interactivetokenorpassword'].includes(logonType);
  const startWhenAvailable = boolValue(task.StartWhenAvailable ?? task.startWhenAvailable);
  const disallowStartOnBattery = boolValue(task.DisallowStartIfOnBatteries ?? task.disallowStartIfOnBatteries);
  const stopOnBattery = boolValue(task.StopIfGoingOnBatteries ?? task.stopIfGoingOnBatteries);
  return ['ready', 'running'].includes(state)
    && bootTriggered
    && Boolean(userId)
    && unattendedNetworkLogon
    && startWhenAvailable
    && !disallowStartOnBattery
    && !stopOnBattery;
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
