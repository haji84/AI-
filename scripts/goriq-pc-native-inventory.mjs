import { execFile } from 'node:child_process';
import { open, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const statuses = new Set(['idle', 'processing', 'synced', 'reconciling', 'ready', 'running', 'blocked', 'error', 'offline']);
const taskNames = ['GAI-ZBook-Runner-OnLogon', 'GAI-ZBook-Watchdog', 'GAI-ZBook-Runner-Supervisor', 'JARVIS Remote Host'];
const taskStates = new Set(['Unknown', 'Disabled', 'Queued', 'Ready', 'Running']);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0 ? value : null;
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}
export function summarizeStatus(value, now = Date.now()) {
  const updatedAt = timestamp(value?.updatedAt ?? value?.checkedAt);
  const age = updatedAt ? now - Date.parse(updatedAt) : null;
  return { readable: true, status: statuses.has(value?.status) ? value.status : 'unknown',
    pid: positiveInteger(value?.pid), updatedAt, fresh: age !== null && age >= 0 && age <= 120000 };
}
async function nativeRead(path, tail = false) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (!tail && info.size > 65536)) throw new Error('UNREADABLE');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(65537);
    const position = tail ? Math.max(0, info.size - 65536) : 0;
    const { bytesRead } = await handle.read(buffer, 0, tail ? 65536 : 65537, position);
    if (bytesRead > 65536) throw new Error('OVERSIZED');
    return buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
  } finally { await handle.close(); }
}
async function nativeMetadata(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return { present: null };
    return { present: true, sizeBytes: info.size, updatedAt: info.mtime.toISOString() };
  } catch (error) { return { present: error?.code === 'ENOENT' ? false : null }; }
}
async function nativeRun(command, args) {
  try { return { ok: true, ...(await execute(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 262144, windowsHide: true })) }; }
  catch { return { ok: false }; }
}
export async function collectNativeInventory({ platform = process.platform, home = homedir(),
  localAppData = process.env.LOCALAPPDATA, uid = process.getuid?.(), now = Date.now(),
  read = nativeRead, metadata = nativeMetadata, run = nativeRun } = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('NATIVE_PC_REQUIRED');
  if (platform === 'win32' && !localAppData) throw new Error('LOCAL_STATE_ROOT_REQUIRED');
  const state = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'GAIWorker') : join(localAppData, 'GAIWorker');
  const json = async path => {
    try { return summarizeStatus(JSON.parse(await read(path)), now); }
    catch { return { readable: false, status: 'unknown', pid: null, updatedAt: null, fresh: false }; }
  };
  const facts = async path => {
    const result = await metadata(path).catch(() => ({ present: null }));
    return { present: result.present === true ? true : result.present === false ? false : null,
      sizeBytes: Number.isSafeInteger(result.sizeBytes) && result.sizeBytes >= 0 ? result.sizeBytes : null,
      updatedAt: timestamp(result.updatedAt) };
  };
  const log = async path => {
    const result = await facts(path);
    let readable = false, errorCodes = [];
    if (result.present === true) {
      try {
        const tail = await read(path, true);
        readable = true;
        errorCodes = ['EADDRINUSE', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX']
          .filter(code => new RegExp('\\b' + code + '\\b').test(tail));
      } catch { /* Missing or private files remain unknown; never emit raw text. */ }
    }
    return { ...result, readable, errorCodes, scope: 'last-64KiB-history-not-current-health' };
  };
  const bridge = platform === 'darwin' ? await json(join(home, '.ai-company', 'chatgpt-bridge-health.json'))
    : { readable: false, status: 'unknown', pid: null, updatedAt: null, fresh: false, note: 'bridge-path-not-established' };
  const watchdog = await json(join(state, platform === 'darwin' ? 'macbook-watchdog-status.json' : 'zbook-watchdog-status.json'));
  let startup;
  if (platform === 'darwin') {
    startup = {};
    for (const [role, label] of [['bridge', 'com.ai-company.chatgpt-bridge'], ['watchdog', 'com.gai.worker-watchdog'], ['supervisor', 'com.gai.runner-supervisor']]) {
      const path = join(home, 'Library', 'LaunchAgents', label + '.plist');
      let runAtLoad = null;
      try { const plist = await read(path); if (/<key>RunAtLoad<\/key>\s*<true\s*\/>/.test(plist)) runAtLoad = true;
        else if (/<key>RunAtLoad<\/key>\s*<false\s*\/>/.test(plist)) runAtLoad = false; } catch {}
      const result = Number.isSafeInteger(uid) && uid >= 0 ? await run('launchctl', ['print', `gui/${uid}/${label}`]) : { ok: false };
      startup[role] = { ...(await facts(path)), runAtLoad, registered: result.ok === true ? true : null,
        running: result.ok === true && /^\s*state = (?:running|waiting|exited)\s*$/m.test(result.stdout ?? '')
          ? /^\s*state = running\s*$/m.test(result.stdout ?? '') : null,
        pid: result.ok === true ? positiveInteger(Number(result.stdout?.match(/^\s*pid = (\d+)\s*$/m)?.[1])) : null };
    }
  } else {
    const script = "$ErrorActionPreference='Stop';@('GAI-ZBook-Runner-OnLogon','GAI-ZBook-Watchdog','GAI-ZBook-Runner-Supervisor','JARVIS Remote Host') | ForEach-Object { $t=Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue; if($t){ [pscustomobject]@{name=$_;state=[string]$t.State;actionCount=@($t.Actions).Count} } } | ConvertTo-Json -Compress";
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    let tasks = [], queryReadable = false;
    try { const raw = JSON.parse(result.stdout?.replace(/^\uFEFF/, '') ?? 'null');
      queryReadable = result.ok === true && (Array.isArray(raw) || (raw !== null && typeof raw === 'object'));
      tasks = queryReadable ? (Array.isArray(raw) ? raw : [raw]) : []; } catch {}
    startup = { tasks: taskNames.map(name => {
      const matches = tasks.filter(task => task?.name === name);
      const task = matches.length === 1 ? matches[0] : undefined;
      return { name, available: queryReadable ? Boolean(task) : null, state: taskStates.has(task?.state) ? task.state : 'Unknown',
        actionCount: Number.isSafeInteger(task?.actionCount) && task.actionCount >= 0 ? task.actionCount : null };
    }) };
  }
  const logs = { watchdog: await log(join(state, platform === 'darwin' ? 'macbook-watchdog.log' : 'zbook-watchdog.log')) };
  if (platform === 'darwin') {
    logs.bridge = await log(join(home, 'Library', 'Logs', 'AICompanyChatGPTBridge.log'));
    logs.bridgeError = await log(join(home, 'Library', 'Logs', 'AICompanyChatGPTBridge.error.log'));
    logs.gatewayError = await log(join(home, 'Library', 'Application Support', 'JARVIS', 'remote-gateway.err.log'));
  }
  return { version: 1, readOnly: true, diagnosticOnly: true, nodeId: platform === 'darwin' ? 'macbook' : 'zbook',
    observedAt: new Date(now).toISOString(), bridge, watchdog, startup, logs,
    bridgeMatchesLaunchdPid: bridge.pid && startup.bridge?.pid ? bridge.pid === startup.bridge.pid : null };
}
